# Deploy no Coolify

**Status: no ar.** Deploy `tcxbdswnjdftburh9ym1y7iy` concluído, smoke test 23/23 contra a VPS.

| | |
|---|---|
| VPS | `vps70013.publiccloud.com.br` (`177.153.35.27`) |
| Coolify | `http://vps70013.publiccloud.com.br:8000` |
| Projeto | `tdc-hermes-demo` — `hacknwt4zpfg0zqrwdqqdgqv` |
| Environment | `production` — `wjehcipdv6aiz9kiaymbgp7p` |
| Server | `localhost` — `bqhc6vorheb0dwc3h756opbx` |
| Aplicação | `hostmaster-demo` — `rye22uhkjq7j4qauczrb3jlo` |

### URLs públicas

| Serviço | URL |
|---|---|
| Loja | https://hostmaster.fagnerlopes.dev |
| Painel | https://hostmaster.fagnerlopes.dev/dashboard |
| API | https://api.hostmaster.fagnerlopes.dev |
| Loki | https://loki.hostmaster.fagnerlopes.dev |
| Grafana | https://grafana.hostmaster.fagnerlopes.dev |

O Promtail **não tem domínio** — nada externo precisa dele. O `/ready` só é alcançável de dentro do host:

```bash
docker compose exec promtail wget -qO- localhost:9080/ready
```

## Domínios e TLS

Quatro registros A em `fagnerlopes.dev` (DNS na Vercel) apontando para `177.153.35.27`. O apex continua servindo o site pessoal na Vercel e não foi tocado. Os certificados são emitidos pelo Traefik do Coolify via HTTP-01, e as 80/443 já estavam abertas.

O mapeamento vive no campo `docker_compose_domains` da aplicação:

```bash
api -X PATCH "$COOLIFY/api/v1/applications/$APP" -d '{
  "docker_compose_domains": {
    "web":     { "name": "web",     "domain": "https://hostmaster.fagnerlopes.dev:3000" },
    "api":     { "name": "api",     "domain": "https://api.hostmaster.fagnerlopes.dev:3001" },
    "loki":    { "name": "loki",    "domain": "https://loki.hostmaster.fagnerlopes.dev:3100" },
    "grafana": { "name": "grafana", "domain": "https://grafana.hostmaster.fagnerlopes.dev:3000" }
  }
}'
```

Três detalhes que custam tempo se você não souber:

- **A porta no fim de cada URL é a porta interna do container, não a pública.** É assim que o Traefik sabe para onde rotear. Por isso o Grafana é `:3000` (o que ele escuta) e não `:3300` (o que o compose publicava no host).
- **O campo `name` é obrigatório** e repete a chave do serviço. Sem ele o Coolify 4.3.2 responde `Validation failed` com `docker_compose_domains.web.name field is required`. Sucesso devolve só `{"uuid":"..."}`.
- **O campo volta da API como string JSON**, não como objeto. Para conferir: `api "$COOLIFY/api/v1/applications/$APP" | jq -r '.docker_compose_domains' | jq '.'`

Existe um bug conhecido ([#4326](https://github.com/coollabsio/coolify/issues/4326)) em que o PATCH responde sucesso e o domínio não persiste. Sempre leia de volta antes de disparar o deploy.

**`/ready` do Loki responde 503 logo depois do deploy** — `Ingester not ready: waiting for 15s after being ready`. É a carência de partida do próprio Loki, não problema de roteamento: a resposta é idêntica pelo domínio e pela porta crua, e a API de query já funciona antes disso. Espere e repita.

O FQDN sslip que o Coolify gerou (`rye22uhkjq7j4qauczrb3jlo.177.153.35.27.sslip.io`) continua retornando **404** e pode ser ignorado.

## Refazer o deploy pela API REST

```bash
export COOLIFY=http://vps70013.publiccloud.com.br:8000
export TOKEN='<api-token>'   # Coolify > Security > API Tokens
api() { curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }

api "$COOLIFY/api/v1/version"
api -X POST "$COOLIFY/api/v1/deploy?uuid=rye22uhkjq7j4qauczrb3jlo&force=false"
```

Acompanhar:
```bash
api "$COOLIFY/api/v1/deployments/<deployment-uuid>" | jq -r '.status'
api "$COOLIFY/api/v1/deployments/<deployment-uuid>" | jq -r '.logs' | jq -r '.[].output'
```

**A API do Coolify precisa estar habilitada** em Settings → API (`API access: Enabled`). Desabilitada, todo endpoint responde `403 {"message":"You are not allowed to access the API."}` mesmo com token válido — sem token o erro é `401`, o que distingue os dois casos.

### Como a aplicação foi criada (referência)

```bash
api -X POST "$COOLIFY/api/v1/projects" \
  -d '{"name":"tdc-hermes-demo","description":"Demo TDC - HOSTMASTER + Hermes Agent"}'
# a descrição não aceita ":" — a validação do Coolify rejeita

api -X POST "$COOLIFY/api/v1/applications/public" -d '{
  "project_uuid": "hacknwt4zpfg0zqrwdqqdgqv",
  "server_uuid": "bqhc6vorheb0dwc3h756opbx",
  "environment_name": "production",
  "environment_uuid": "wjehcipdv6aiz9kiaymbgp7p",
  "name": "hostmaster-demo",
  "git_repository": "https://github.com/fagnerlopes/tdc-talk-vps-hermes",
  "git_branch": "main",
  "build_pack": "dockercompose",
  "docker_compose_location": "/docker-compose.yml",
  "instant_deploy": false
}'
```

### Variáveis de ambiente

Não foi preciso criar nenhuma na mão: o Coolify parseia o `docker-compose.yml` e extrai os `${VAR:-default}` com os defaults corretos. Conferir com `api "$COOLIFY/api/v1/applications/rye22uhkjq7j4qauczrb3jlo/envs"` — devem aparecer 20 entradas (10 chaves × runtime + preview):

| Chave | Valor |
|---|---|
| `DATABASE_URL` | `postgresql://dev_user:dev123@postgres:5432/hermes_demo` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `dev_user` / `dev123` / `hermes_demo` |
| `LOG_FILE` | `/var/log/app/api.log` |
| `LOG_LEVEL` | `info` |
| `CHECKOUT_FAILURE_RATE` | `0.5` |
| `CHECKOUT_MAX_SUCCESS_STREAK` | `3` |
| `SEED_ON_BOOT` | `true` |
| `API_INTERNAL_URL` | `http://api:3001` |

Ao criar env var pela API, **não** envie `is_build_time` — o Coolify 4.3.2 rejeita o campo com `"This field is not allowed."`.

O build completo leva ~5 min (duas imagens Node). Na segunda às 18h deve ser só smoke test.

## Exposição do Loki (R4) — ABERTA AGORA, precisa ser fechada

**O Hermes roda numa VPS separada do Coolify.** Ou seja, a porta 3100 precisa ser alcançável pela internet — `127.0.0.1:3100:3100` não serve aqui.

O problema não é teórico. Com a stack no ar, um `push` anônimo de um laptop qualquer foi aceito:

```
$ curl -X POST http://vps70013.publiccloud.com.br:3100/loki/api/v1/push \
    -H 'content-type: application/json' \
    -d '{"streams":[{"stream":{"job":"teste-de-exposicao"},"values":[["<ts>","linha injetada de fora"]]}]}'
HTTP 204

$ curl -s http://vps70013.publiccloud.com.br:3100/loki/api/v1/label/job/values | jq -c '.data'
["api","teste-de-exposicao"]
```

O repositório é público e o Loki roda com `auth_enabled: false`. Quem achar a 3100 **lê e escreve** logs. Escrever é o pior dos dois: dá para injetar linhas em `job="api"` e envenenar a investigação do Hermes ao vivo.

O stream `teste-de-exposicao` acima ficou no Loki. É inofensivo — as queries da demo filtram `{job="api"}` — mas serve de marcador: se ele ainda estiver lá, a porta continua aberta.

### Opção A — allowlist por IP (recomendada)

Não exige credencial nenhuma no repositório público e não muda uma vírgula nas queries do Hermes.

Na VPS do Coolify, descubra o IP de saída da VPS do Hermes e libere só ele:

```bash
# na VPS do Hermes:
curl -s https://api.ipify.org; echo

# na VPS do Coolify, como root:
ufw allow from <IP-DA-VPS-DO-HERMES> to any port 3100 proto tcp
ufw deny 3100/tcp
ufw status numbered
```

A ordem importa: a regra específica de `allow` precisa vir **antes** do `deny`. Confirme com `ufw status numbered` e, se preciso, reordene com `ufw insert 1 ...`.

Valide dos dois lados:
```bash
# da VPS do Hermes — deve responder
curl -s http://vps70013.publiccloud.com.br:3100/ready

# do seu laptop — deve dar timeout
curl -s -m 5 http://vps70013.publiccloud.com.br:3100/ready
```

### Opção B — basic-auth no Traefik (se o IP do Hermes for dinâmico)

No Coolify, adicione ao serviço `loki` os labels do Traefik com um middleware `basicauth`. **Não** coloque a senha no [AGENTE.md](AGENTE.md) — o repositório é público. Deixe o `AGENTE.md` com placeholders e passe as credenciais ao Hermes por variável de ambiente:

```bash
curl -sG -u "$LOKI_USER:$LOKI_PASS" "https://loki.vps70013.publiccloud.com.br/loki/api/v1/query_range" \
  --data-urlencode 'query={job="api"} | json | level="error"'
```

Gere o hash com `htpasswd -nb hermes '<senha>'` e dobre os `$` para `$$` no valor do label.

### Nos dois casos

- A 3100 fica exposta **só até a live de segunda**. Depois, `docker compose down` ou feche a porta.
- O Grafana (`:3300`) fala com o Loki pela rede interna do compose e não é afetado por nenhuma das duas opções.
- Antes de subir ao palco, confira se ninguém escreveu de fora:
  ```bash
  curl -s http://vps70013.publiccloud.com.br:3100/loki/api/v1/label/job/values | jq -c '.data'
  # esperado depois de fechar a porta: ["api","teste-de-exposicao"]
  # qualquer job novo além desses dois = alguém escreveu de fora
  ```

### As outras portas abertas

O Coolify publicou as seis portas do compose no host. Além da 3100:

| Porta | Serviço | Risco |
|---|---|---|
| `5432` | Postgres | **aberta com `dev_user`/`dev123`**, credenciais que estão neste repositório público. Dá para apagar a tabela `products` no meio da demo. Feche junto com a 3100 — nada externo precisa dela. |
| `9080` | Promtail | só expõe `/ready` e métricas. Baixo risco, mas o smoke test é o único consumidor externo. |
| `3300` | Grafana | anônimo com papel Admin, por design (abrir no Explore sem login no palco). Quem achar consegue mexer nos dashboards. |
| `3000` / `3001` | Web e API | precisam ser públicas — são o palco e o canal do Hermes. |

```bash
# na VPS do Coolify, como root — fecha o que não precisa ser público
ufw deny 5432/tcp
ufw deny 9080/tcp
```

## Depois do deploy

1. ✅ Smoke test do laptop contra as URLs públicas — **23/23**:
   ```bash
   API_URL=http://vps70013.publiccloud.com.br:3001 WEB_URL=http://vps70013.publiccloud.com.br:3000 \
   LOKI_URL=http://vps70013.publiccloud.com.br:3100 PROMTAIL_URL=http://vps70013.publiccloud.com.br:9080 \
   GRAFANA_URL=http://vps70013.publiccloud.com.br:3300 ./scripts/smoke.sh
   ```
2. ✅ [AGENTE.md](AGENTE.md), [RUNBOOK-LIVE.md](RUNBOOK-LIVE.md) e [CHECKLIST-PRE-LIVE.md](CHECKLIST-PRE-LIVE.md) com as URLs públicas reais
3. ⬜ **Fechar a porta 3100** — ver a seção do R4 acima. Pendente e urgente.
4. ⬜ Baseline antes da live:
   ```bash
   API_URL=http://vps70013.publiccloud.com.br:3001 ./scripts/reset-demo.sh
   ```

## Riscos conhecidos no ambiente do Coolify

**Bind mount relativo de arquivo — já resolvido, não desfaça.** O primeiro deploy (`psksw8yjogxq4dmlobgwkhi0`) morreu assim:

```
error mounting "/data/coolify/applications/<app-uuid>/monitoring/loki-config.yaml"
to rootfs at "/etc/loki/local-config.yaml": not a directory
```

O Coolify roda o compose a partir de `/artifacts/<deploy-uuid>/` mas reescreve os binds relativos para `/data/coolify/applications/<app-uuid>/...`, onde os arquivos não estão. O Docker então cria um **diretório vazio** no lugar do arquivo e o container morre.

Por isso `loki`, `promtail` e `grafana` usam `build:` com os Dockerfiles em `monitoring/`, levando o config dentro da imagem. **Não volte para `image:` + bind mount** — vai quebrar de novo.

Duas coisas que continuam funcionando normalmente no Coolify e não precisam de contorno:
- **build context relativo** (`context: .` e `context: ./monitoring`) — as imagens `api` e `web` compilaram sem problema já no deploy que falhou
- **volumes nomeados** (`loki_data`, `app_logs`, …)

**Versão do compose.** O compose local é 2.3.3 e já não aceita `docker compose ps --format '{{.Service}}'`. Não assuma paridade entre laptop e VPS — teste os comandos operacionais **na VPS**.

**Memória no build do Next.** `output: standalone` já reduz o consumo, e o build foi validado localmente. Se ainda assim estourar, faça `docker compose build web` sozinho antes de subir o resto.
