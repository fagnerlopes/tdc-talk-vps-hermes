# Checklist Pré-Live — Segunda 18h

Uma hora antes da live. A maior parte disto está automatizada:

```bash
./scripts/smoke.sh          # sai != 0 se algo falhar; "pulados" nao sao falha
./scripts/reset-demo.sh     # baseline + assert
```

Contra a VPS:
```bash
API_URL=https://api.hostmaster.fagnerlopes.dev WEB_URL=https://hostmaster.fagnerlopes.dev \
LOKI_URL=https://loki.hostmaster.fagnerlopes.dev GRAFANA_URL=https://grafana.hostmaster.fagnerlopes.dev \
LOKI_USER=hermes LOKI_PASS='<senha>' \
ADMIN_EMAIL='<email>' ADMIN_PASSWORD='<senha>' \
GRAFANA_PASSWORD='<senha>' ./scripts/smoke.sh
```

O que segue abaixo é a versão manual, para quando você quiser olhar com os próprios olhos.

## Infraestrutura

- [ ] Stack no ar:
  ```bash
  docker compose up -d
  docker compose ps --services --filter status=running
  # Esperado 7: api, grafana, loki, loki-auth, postgres, promtail, web
  ```
  **Isto só roda na VPS.** Nenhuma porta é publicada no host, então de fora não há
  como inspecionar containers — o smoke test PULA esta checagem quando o alvo é remoto.
  Use `--services --filter status=running`, não `--format '{{.Service}}'` — versões antigas do compose não entendem o segundo.

- [ ] Banco populado — **o seed roda sozinho no boot** (`SEED_ON_BOOT=true`). Para rodar na mão:
  ```bash
  docker compose exec -T api node packages/database/dist/seed.js
  # Esperado: Seed completed: 5 produtos, 2 usuarios
  ```
  `npm run seed` na raiz faz exatamente isso. **Não** existe `npm run seed` cru na VPS — lá não há `node_modules` nem `DATABASE_URL` no host.

## Endpoints /v1 (ensaio)

Os `curl` abaixo usam `localhost:3001`, o que só funciona **de dentro da VPS** (ou
com a stack local de pé). De fora, troque por `https://api.hostmaster.fagnerlopes.dev`.

- [ ] `GET /v1/health` = 200
  ```bash
  curl -s http://localhost:3001/v1/health | jq .
  # {"status":"ok","version":"v1","timestamp":"..."}
  ```

- [ ] `GET /v1/status` traz métricas
  ```bash
  curl -s http://localhost:3001/v1/status | jq .
  # uptime, checkouts, failures, failureRate, observedFailureRate, crashed
  ```

- [ ] `POST /v1/checkout` falha ~50%
  ```bash
  for i in $(seq 1 10); do
    curl -s -o /dev/null -w '%{http_code} ' -X POST http://localhost:3001/v1/checkout \
      -H 'content-type: application/json' \
      -d '{"productId":"MONITOR-240HZ","userId":"user-1"}'
  done; echo
  # Esperado: entre 2 e 8 respostas 500
  # (a media real e ~5.3, nao 5: o CHECKOUT_MAX_SUCCESS_STREAK=3 forca falha
  #  depois de 3 sucessos seguidos e empurra a taxa para ~53%)
  ```

- [ ] `POST /v1/simulate-crash` funciona
  ```bash
  curl -s -X POST http://localhost:3001/v1/simulate-crash    # {"crashed":true,"version":"v1"}
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/v1/health   # 500
  curl -s -X POST http://localhost:3001/v1/simulate-crash    # {"crashed":false,...}
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/v1/health   # 200
  ```

## Endpoints /v2 (live)

- [ ] Mesmas quatro checagens acima em `/v2`
- [ ] **Os contadores de `/v1` não se moveram** — o estado é isolado por versão:
  ```bash
  curl -s http://localhost:3001/v1/status | jq -c '{checkouts,failures}'
  curl -s http://localhost:3001/v2/status | jq -c '{checkouts,failures}'
  ```

## Logs e Loki

- [ ] Promtail vivo — **só de dentro da VPS**, ele não tem domínio:
  ```bash
  docker compose exec promtail wget -qO- localhost:9080/ready     # Ready
  ```

- [ ] A API está escrevendo no arquivo que o Promtail lê:
  ```bash
  docker compose exec api tail -2 /var/log/app/api.log
  ```

- [ ] Loki conhece o stream — **todo `curl` ao Loki precisa de `-u`**:
  ```bash
  LOKI=https://loki.hostmaster.fagnerlopes.dev
  curl -s -u "$LOKI_USER:$LOKI_PASS" "$LOKI/loki/api/v1/label/job/values" | jq -r '.data[]'
  # Esperado: api  (e SO api — qualquer job a mais = alguem escreveu de fora)
  ```

- [ ] O Loki continua fechado para anônimos:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' "$LOKI/ready"   # 401
  ```

- [ ] **A query do AGENTE.md retorna dados** — esta é a checagem que decide a talk:
  ```bash
  curl -sG -u "$LOKI_USER:$LOKI_PASS" "$LOKI/loki/api/v1/query_range" \
    --data-urlencode 'query={job="api"} | json | level="error"' \
    --data-urlencode 'limit=20' | jq '[.data.result[].values[]] | length'
  # Esperado: > 0
  ```
  **`--data-urlencode`, sempre.** Com `-d 'query=...'` puro o curl não faz URL-encode e o Loki devolve HTTP 400.

- [ ] Os 8 campos obrigatórios estão na linha:
  ```bash
  curl -sG -u "$LOKI_USER:$LOKI_PASS" "$LOKI/loki/api/v1/query_range" \
    --data-urlencode 'query={job="api"} | json | level="error"' \
    --data-urlencode 'limit=1' \
  | jq -r '.data.result[0].values[0][1] | fromjson | keys | join(",")'
  # Deve conter: level, timestamp, correlationId, service, endpoint, productId, reason, message
  ```

- [ ] Ver os logs com os olhos: **Grafana em https://grafana.hostmaster.fagnerlopes.dev** → login como `admin` → Explore → datasource Loki → `{job="api"}`.
  **O Loki não tem UI**, e a raiz dele retorna 404 — isso é esperado. Para liveness use `/ready`.
  O Grafana fala com o Loki pela rede interna e **não** passa pelo basic-auth.

- [ ] O Grafana **não** responde sem login:
  ```bash
  G=https://grafana.hostmaster.fagnerlopes.dev
  curl -s -o /dev/null -w '%{http_code}\n' "$G/api/health"                    # 200 (healthcheck, público de propósito)
  curl -s -o /dev/null -w '%{http_code}\n' "$G/api/datasources"               # 401
  curl -s -o /dev/null -u admin:admin -w '%{http_code}\n' "$G/api/user"       # 401
  curl -s -o /dev/null -u "admin:$SENHA" -w '%{http_code}\n' "$G/api/user"    # 200
  ```

## Frontend

- [ ] `https://hostmaster.fagnerlopes.dev` carrega a **loja**
- [ ] Sidebar com Loja, Painel e Usuários (links reais) + itens decorativos
- [ ] 5 cards de produto com botão "Comprar [Nome]"
- [ ] A loja **não** mostra stats, logs nem controles — é a visão do cliente
- [ ] Clique em "Comprar":
  - [ ] 200 → toast verde com o `orderId`
  - [ ] 500 → toast vermelho **"Não foi possível concluir o pagamento"** + **código de referência**
  - [ ] O `reason` técnico **não** aparece na loja — é o que o Hermes vai descobrir
  - [ ] Clicar no chip do código copia o valor

- [ ] `https://hostmaster.fagnerlopes.dev/dashboard` sem cookie redireciona para `/login`
- [ ] Login com o admin funciona e o painel abre
- [ ] O painel tem stats, "Logs recentes" e o `<details>` de Controles de demo **fechado**
- [ ] "Logs recentes" atualiza em ≤ 2s após um clique na loja
- [ ] `/dashboard/usuarios` lista os admins
- [ ] **Faça login antes da talk** — a sessão dura 12h; expirar no palco custa caro

## Hermes

- [ ] O Hermes alcança a API pública:
  ```bash
  curl -s https://api.hostmaster.fagnerlopes.dev/v2/health
  ```
- [ ] O Hermes alcança o Loki público:
  ```bash
  curl -sG https://loki.hostmaster.fagnerlopes.dev/loki/api/v1/query_range \
    --data-urlencode 'query={job="api"} | json' --data-urlencode 'limit=5'
  ```
- [ ] **[AGENTE.md](AGENTE.md) está com as URLs públicas reais**, não `localhost` — o Hermes roda fora da VPS
- [ ] Bot do Telegram configurado, chat ID correto, mensagem de teste entregue

## Dados

Os comandos `psql` abaixo só rodam **na VPS**: a 5432 foi fechada e não é mais
alcançável de fora.

- [ ] Produtos:
  ```bash
  docker compose exec -T postgres psql -U dev_user -d hermes_demo -c "select id, price from products order by price desc;"
  # Esperado: RTX-4060, MONITOR-240HZ, TECLADO-RGB, HEADSET-GAMER, MOUSEPAD-XL
  ```
- [ ] Usuários:
  ```bash
  docker compose exec -T postgres psql -U dev_user -d hermes_demo -c "select id, email from users;"
  # Esperado: user-1 gamer-pro@example.com, user-2 tech-enthusiast@test.com
  ```

## Performance

- [ ] Health responde em < 1s:
  ```bash
  time curl -s https://api.hostmaster.fagnerlopes.dev/v2/health > /dev/null
  ```
- [ ] Log chega ao Loki em < 5s:
  ```bash
  API=https://api.hostmaster.fagnerlopes.dev
  LOKI=https://loki.hostmaster.fagnerlopes.dev

  CID=$(curl -s -X POST "$API/v2/checkout" -H 'content-type: application/json' \
    -d '{"productId":"MONITOR-240HZ","forceFailure":true}' | jq -r .correlationId)
  sleep 4
  curl -sG -u "$LOKI_USER:$LOKI_PASS" "$LOKI/loki/api/v1/query_range" \
    --data-urlencode "query={job=\"api\"} | json | correlationId=\"$CID\"" \
  | jq '[.data.result[].values[]] | length'
  # Esperado: 2
  ```
- [ ] Dashboard atualiza em < 2s após o clique

## Reset pré-live

- [ ] **Baseline restaurado** — este é o item mais fácil de esquecer e o mais caro:
  ```bash
  ./scripts/reset-demo.sh
  # v1: failureRate=0.5 crashed=false health=200 OK
  # v2: failureRate=0.5 crashed=false health=200 OK
  ```
  Se o `failureRate` ficar em `1.0` depois do smoke test, **todo** clique falha no palco e a premissa "o sistema normalmente funciona" desaba.

- [ ] Logs antigos podem ficar — o Hermes busca por janela de tempo
- [ ] Banco não precisa de limpeza

## Documentação

- [ ] [RUNBOOK-LIVE.md](RUNBOOK-LIVE.md) aberto numa aba
- [ ] [AGENTE.md](AGENTE.md) com URLs públicas
- [ ] [README.md](README.md) e [PRD.md](PRD.md) acessíveis
- [ ] `LOKI_USER`/`LOKI_PASS` e `ADMIN_EMAIL`/`ADMIN_PASSWORD` à mão (gerenciador de senhas)

## Tela e canais

- [ ] OBS / compartilhamento em 1920×1080, áudio OK
- [ ] Dashboard visível sem zoom excessivo
- [ ] Aba do Telegram aberta
- [ ] Aba do **Grafana** aberta no Explore — o Loki não tem UI
- [ ] Aba do **painel** aberta e **já logada** (sessão de 12h)
- [ ] `<details>` "Controles de demo" **fechado**
- [ ] Terminal aberto com os `curl` de emergência à mão

## Plano B

- [ ] Stack reinicia em < 2 min (medido: ~15s):
  ```bash
  time (docker compose down && docker compose up -d && \
        until curl -sf localhost:3001/v2/health > /dev/null; do sleep 1; done)
  ```
  **Nunca use `-v`.** `docker compose down -v` apaga `postgres_data` **e** `loki_data`, levando junto todo o histórico que o Hermes iria buscar.

- [ ] O Hermes pode ser demonstrado sozinho, consultando logs já existentes no Loki
- [ ] Se o Promtail parar, os logs continuam em `docker compose logs api` e no painel do dashboard

## 15 minutos antes

```bash
echo "=== Verificação final ==="
./scripts/smoke.sh && ./scripts/reset-demo.sh
echo "=== Pronto. Boa live ==="
```

## Referência rápida durante a live

| Ação | Comando / URL |
|---|---|
| Dashboard | http://\<HOST\>:3000 |
| Health da API | `curl https://api.hostmaster.fagnerlopes.dev/v2/health` |
| Ver logs (humano) | http://\<HOST\>:3300 → Explore |
| Simular erro | clicar em "Comprar" no dashboard |
| **Garantir que o próximo clique falha** | `curl -X POST https://api.hostmaster.fagnerlopes.dev/v2/config -H 'content-type: application/json' -d '{"forceNextOutcome":"fail"}'` |
| Derrubar o health | `curl -X POST https://api.hostmaster.fagnerlopes.dev/v2/simulate-crash` |
| Voltar ao baseline | `./scripts/reset-demo.sh` |
| Reiniciar a stack | `docker compose down && docker compose up -d` (**sem `-v`**) |
