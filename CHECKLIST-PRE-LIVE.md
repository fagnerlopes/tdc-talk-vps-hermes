# Checklist Pré-Live — Segunda 18h

Uma hora antes da live. A maior parte disto está automatizada:

```bash
./scripts/smoke.sh          # 23 checagens; sai != 0 se algo falhar
./scripts/reset-demo.sh     # baseline + assert
```

Contra a VPS:
```bash
API_URL=http://<HOST>:3001 WEB_URL=http://<HOST>:3000 \
LOKI_URL=http://<HOST>:3100 PROMTAIL_URL=http://<HOST>:9080 \
GRAFANA_URL=http://<HOST>:3300 ./scripts/smoke.sh
```

O que segue abaixo é a versão manual, para quando você quiser olhar com os próprios olhos.

## Infraestrutura

- [ ] Stack no ar:
  ```bash
  docker compose up -d
  docker compose ps --services --filter status=running
  # Esperado: api, grafana, loki, postgres, promtail, web
  ```
  Use `--services --filter status=running`, não `--format '{{.Service}}'` — versões antigas do compose não entendem o segundo.

- [ ] Banco populado — **o seed roda sozinho no boot** (`SEED_ON_BOOT=true`). Para rodar na mão:
  ```bash
  docker compose exec -T api node packages/database/dist/seed.js
  # Esperado: Seed completed: 5 produtos, 2 usuarios
  ```
  `npm run seed` na raiz faz exatamente isso. **Não** existe `npm run seed` cru na VPS — lá não há `node_modules` nem `DATABASE_URL` no host.

## Endpoints /v1 (ensaio)

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
  # Esperado: entre 3 e 7 respostas 500 (tolerância binomial)
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

- [ ] Promtail vivo:
  ```bash
  curl -s http://localhost:9080/ready     # Ready
  ```

- [ ] A API está escrevendo no arquivo que o Promtail lê:
  ```bash
  docker compose exec api tail -2 /var/log/app/api.log
  ```

- [ ] Loki conhece o stream:
  ```bash
  curl -s http://localhost:3100/loki/api/v1/label/job/values | jq -r '.data[]'
  # Esperado: api
  ```

- [ ] **A query do AGENTE.md retorna dados** — esta é a checagem que decide a talk:
  ```bash
  curl -sG http://localhost:3100/loki/api/v1/query_range \
    --data-urlencode 'query={job="api"} | json | level="error"' \
    --data-urlencode 'limit=20' | jq '[.data.result[].values[]] | length'
  # Esperado: > 0
  ```
  **`--data-urlencode`, sempre.** Com `-d 'query=...'` puro o curl não faz URL-encode e o Loki devolve HTTP 400.

- [ ] Os 8 campos obrigatórios estão na linha:
  ```bash
  curl -sG http://localhost:3100/loki/api/v1/query_range \
    --data-urlencode 'query={job="api"} | json | level="error"' \
    --data-urlencode 'limit=1' \
  | jq -r '.data.result[0].values[0][1] | fromjson | keys | join(",")'
  # Deve conter: level, timestamp, correlationId, service, endpoint, productId, reason, message
  ```

- [ ] Ver os logs com os olhos: **Grafana em http://localhost:3300** → Explore → datasource Loki → `{job="api"}`.
  **O Loki não tem UI.** `http://localhost:3100/` retorna 404 — isso é esperado. Para liveness do Loki use `/ready`.

## Frontend

- [ ] http://localhost:3000 carrega o dashboard HOSTMASTER
- [ ] Sidebar com Home, Produtos, Pedidos, Analytics, Settings
- [ ] 5 cards de produto com botão "Comprar [Nome]"
- [ ] Painel "Logs recentes" à direita
- [ ] Clique em "Comprar":
  - [ ] 200 → toast verde com o `orderId`
  - [ ] 500 → toast vermelho com o `reason` **e o `correlationId`**
  - [ ] "Logs recentes" atualiza em ≤ 2s
  - [ ] Clicar no chip do `correlationId` copia o valor

## Hermes

- [ ] O Hermes alcança a API pública:
  ```bash
  curl -s http://<HOST>:3001/v2/health
  ```
- [ ] O Hermes alcança o Loki público:
  ```bash
  curl -sG http://<HOST>:3100/loki/api/v1/query_range \
    --data-urlencode 'query={job="api"} | json' --data-urlencode 'limit=5'
  ```
- [ ] **[AGENTE.md](AGENTE.md) está com as URLs públicas reais**, não `localhost` — o Hermes roda fora da VPS
- [ ] Bot do Telegram configurado, chat ID correto, mensagem de teste entregue

## Dados

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
  time curl -s http://localhost:3001/v2/health > /dev/null
  ```
- [ ] Log chega ao Loki em < 5s:
  ```bash
  CID=$(curl -s -X POST http://localhost:3001/v2/checkout -H 'content-type: application/json' \
    -d '{"productId":"MONITOR-240HZ","forceFailure":true}' | jq -r .correlationId)
  sleep 4
  curl -sG http://localhost:3100/loki/api/v1/query_range \
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

## Tela e canais

- [ ] OBS / compartilhamento em 1920×1080, áudio OK
- [ ] Dashboard visível sem zoom excessivo
- [ ] Aba do Telegram aberta
- [ ] Aba do **Grafana (:3300)** aberta no Explore — não `:3100`, que não tem UI
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
| Health da API | `curl http://<HOST>:3001/v2/health` |
| Ver logs (humano) | http://\<HOST\>:3300 → Explore |
| Simular erro | clicar em "Comprar" no dashboard |
| **Garantir que o próximo clique falha** | `curl -X POST http://<HOST>:3001/v2/config -H 'content-type: application/json' -d '{"forceNextOutcome":"fail"}'` |
| Derrubar o health | `curl -X POST http://<HOST>:3001/v2/simulate-crash` |
| Voltar ao baseline | `./scripts/reset-demo.sh` |
| Reiniciar a stack | `docker compose down && docker compose up -d` (**sem `-v`**) |
