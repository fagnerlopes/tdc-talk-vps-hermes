# TDC Demo: E-commerce HOSTMASTER + Hermes Agent

Demo ao vivo para o TDC mostrando um agente de IA (Hermes) descobrindo e diagnosticando erros de produção via **observabilidade agnóstica** — consultando Loki, sem nenhum alerta hardcoded na aplicação.

O critério de sucesso desta demo não é "o app funciona". É: **as queries LogQL do [AGENTE.md](AGENTE.md) retornam dados**. Todo o resto existe para sustentar isso.

**Duração:** 20 minutos · **Stack:** Next.js · Fastify · Prisma/Postgres · Promtail · Loki · Grafana

## Como funciona

```
Browser  ──POST /api/proxy/v2/checkout──▶  Next (proxy runtime)  ──▶  Fastify API
                                                                          │
                                                        JSON do Pino ─────┤
                                                                          ▼
                                                          volume app_logs (/var/log/app/api.log)
                                                                          │
                                                                     Promtail (tail)
                                                                          │
                                                                          ▼
                                                        Loki  ◀── Hermes consulta via LogQL
                                                          ▲
                                                       Grafana (Explore)
```

O ponto que costuma quebrar em setups assim é a ponte entre a aplicação e o coletor. Aqui ela é explícita: um **volume compartilhado** (`app_logs`) entre `api` e `promtail`. Sem socket do Docker (permissão frágil no Coolify), sem log driver plugin.

## Subir a stack

```bash
cp .env.example .env        # os defaults do compose funcionam, MENOS LOKI_BASIC_AUTH_B64
docker compose up -d
```

**`LOKI_BASIC_AUTH_B64` é obrigatória** — sem ela o container `loki-auth` aborta de
propósito, para o Loki nunca subir aberto por engano. Para desenvolver:

```bash
printf 'LOKI_BASIC_AUTH_B64=%s\n' \
  "$(printf '%s' "hermes:$(openssl passwd -apr1 'senha-local')" | base64 -w0)" >> .env
```

**As portas não são publicadas.** O compose de produção não tem um único `ports:`;
todo acesso externo passa pelo Traefik do Coolify. Para desenvolver localmente,
crie um `docker-compose.override.yml` (já no `.gitignore`) reintroduzindo as portas —
ver [DEPLOY.md](DEPLOY.md#portas--todas-fechadas).

Levar ~30s. O container da API roda `prisma migrate deploy` e o seed idempotente no start (`SEED_ON_BOOT=true`), então **não é preciso rodar seed na mão**.

| Serviço | URL local (com override) | Produção | Para quê |
|---|---|---|---|
| Loja | http://localhost:3000 | https://hostmaster.fagnerlopes.dev | a tela projetada na talk |
| Painel | http://localhost:3000/dashboard | https://hostmaster.fagnerlopes.dev/dashboard | stats, logs e controles — **exige login** |
| API | http://localhost:3001 | https://api.hostmaster.fagnerlopes.dev | endpoints `/v1` e `/v2`, sem autenticação |
| Loki (cru) | http://localhost:3100 | — | sem domínio; só a rede interna fala com ele |
| Loki (auth) | http://localhost:3101 | https://loki.hostmaster.fagnerlopes.dev | é aqui que o Hermes vai — **exige `-u`** |
| Grafana | http://localhost:3300 | https://grafana.hostmaster.fagnerlopes.dev | Explore com datasource Loki — **exige login** (`admin` / `GRAFANA_ADMIN_PASSWORD`) |
| Promtail | http://localhost:9080 | — | `/ready` para liveness, só de dentro |
| Postgres | localhost:5432 | — | `dev_user` / `dev123` / `hermes_demo` |

**Loki não tem UI.** A raiz dele retorna 404 — isso é normal. Para olhar log com os olhos, use o **Grafana**. Para liveness, use `/ready`.

**O painel exige login.** O primeiro admin nasce no seed: defina `ADMIN_EMAIL` e
`ADMIN_PASSWORD`, ou deixe `ADMIN_PASSWORD` vazia e o seed gera 24 caracteres,
imprimindo uma única vez — recuperável com `docker compose logs api`.

## Verificar que está tudo certo

```bash
npm test                  # vitest — hash de senha e politica de sessao
./scripts/smoke.sh        # sai != 0 se algo falhar; "pulados" nao sao falha
./scripts/reset-demo.sh   # volta v1 e v2 ao baseline e asserta o resultado
```

Localmente, aponte o Loki para o proxy autenticado (`3101`):

```bash
LOKI_URL=http://localhost:3101 LOKI_USER=hermes LOKI_PASS='senha-local' ./scripts/smoke.sh
```

Contra produção:

```bash
API_URL=https://api.hostmaster.fagnerlopes.dev WEB_URL=https://hostmaster.fagnerlopes.dev \
LOKI_URL=https://loki.hostmaster.fagnerlopes.dev GRAFANA_URL=https://grafana.hostmaster.fagnerlopes.dev \
LOKI_USER=hermes LOKI_PASS='<senha>' \
ADMIN_EMAIL='<email>' ADMIN_PASSWORD='<senha>' \
GRAFANA_PASSWORD='<senha>' ./scripts/smoke.sh
```

As checagens que dependem de `docker compose` (contagem de containers, `/ready` do
Promtail) são **puladas** quando o alvo é remoto — elas inspecionariam a stack errada.

## Endpoints

`/v1` é o ensaio das 18h; `/v2` é a live das 19h. **O estado é isolado por versão** — testar em `/v1` não move os contadores de `/v2`.

| Rota | Comportamento |
|---|---|
| `GET /vN/health` | `200 {status:"ok"}` · `500 {error:"crashed"}` se em crash |
| `GET /vN/status` | `uptime`, `checkouts`, `failures`, `failureRate`, `observedFailureRate`, `crashed` |
| `GET /vN/products` | catálogo (banco, com fallback estático) |
| `GET /vN/logs?limit=10` | ring buffer em memória que alimenta o painel do dashboard |
| `POST /vN/checkout` | `{productId, userId?, forceFailure?}` — falha ~50% e loga erro estruturado |
| `POST /vN/simulate-crash` | alterna o estado, retorna `{crashed}` |
| `POST /vN/config` | `{failureRate?, maxSuccessStreak?, forceNextOutcome?, reset?}` |

### Controles de determinismo

Existem porque 6 sucessos seguidos têm ~1,6% de chance — improvável, mas uma eternidade no palco.

| Controle | Default | Uso |
|---|---|---|
| `CHECKOUT_FAILURE_RATE` | `0.5` | baseline |
| `CHECKOUT_MAX_SUCCESS_STREAK` | `3` | após 3 sucessos seguidos, o 4º clique **sempre** falha |
| `POST /vN/config {failureRate}` | — | `1.0` no smoke, `0.5` antes da live |
| `POST /vN/config {forceNextOutcome:"fail"}` | — | botão de pânico: garante que o próximo clique falha |
| `forceFailure` no body do checkout | — | falha via curl sem mexer no estado global |

**O caminho forçado produz uma linha de log byte-idêntica à falha natural** — não existe campo `forced`. A investigação do Hermes no palco é genuína.

## Consultar os logs

Sempre com `--data-urlencode`. Um `-d 'query=...'` puro **não** faz URL-encode, e os caracteres `|`, `{`, `}`, `"` e espaço geram HTTP 400 no Loki:

```bash
curl -sG http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode 'query={job="api"} | json | level="error"' \
  --data-urlencode 'limit=20' | jq '.data.result'
```

O stream tem **um label só**: `job="api"`. Nada de `level` ou `endpoint` como label — promovê-los faria o Loki renomear as chaves extraídas para `level_extracted` e **quebraria silenciosamente** a query acima. Todo filtro acontece em tempo de query, depois do `| json`.

## Formato do log

```json
{"level":"error","timestamp":"2026-08-17T22:08:23.456Z","service":"checkout-api","correlationId":"req-a1b2c3d4","endpoint":"/v2/checkout","productId":"MONITOR-240HZ","userId":"user-1","reason":"payment_gateway_timeout","stack":"Error: Payment gateway did not respond within 30000ms\n    at ...","httpStatus":500,"durationMs":1843,"amount":1299,"message":"Falha ao processar pagamento"}
```

Cada checkout gera **exatamente 2 linhas** com o mesmo `correlationId`: início (`info`) e desfecho (`info` ou `error`). O `reason` é sorteado com peso: `payment_gateway_timeout` 70% · `payment_processing_failed` 20% · `insufficient_inventory` 10%.

O `correlationId` também vai para a tabela `orders`, dando ao Hermes um segundo ângulo: cruzar a linha do Loki com o registro no banco.

## Variáveis de ambiente

| Variável | Default | Nota |
|---|---|---|
| `DATABASE_URL` | `postgresql://dev_user:dev123@postgres:5432/hermes_demo` | |
| `LOG_FILE` | `/var/log/app/api.log` | o arquivo que o Promtail lê |
| `LOG_LEVEL` | `info` | |
| `CHECKOUT_FAILURE_RATE` | `0.5` | |
| `CHECKOUT_MAX_SUCCESS_STREAK` | `3` | `0` desliga o corte de streak |
| `SEED_ON_BOOT` | `true` | seed idempotente no start do container |
| `API_INTERNAL_URL` | `http://api:3001` | lido em **runtime** pelo proxy do Next |

`API_INTERNAL_URL` é resolvido em runtime de propósito. Uma `NEXT_PUBLIC_*` seria inlined em build time, e uma URL errada custaria um rebuild de 3–5 min no dia da talk.

## Estrutura

```
apps/api/src/
├── logger.ts             # o arquivo mais importante: todo campo obrigatório nasce aqui
├── log-buffer.ts         # ring buffer do painel "Logs recentes"
├── state.ts              # estado em memória, isolado por versão
├── checkout.ts           # decisão de falha + catálogo de reasons
└── routes/demo-routes.ts # factory registrada 2x (v1, v2)

apps/web/
├── app/api/proxy/[...path]/route.ts   # proxy de runtime para a API
└── components/                        # Sidebar, TopBar, StatsStrip, ProductGrid, RecentLogsPanel

packages/database/        # Prisma + seed idempotente + catálogo puro (sem import de Prisma)
monitoring/               # promtail-config.yaml, loki-config.yaml, provisioning do Grafana
scripts/                  # smoke.sh, reset-demo.sh
```

## Documentação

| Arquivo | Para quê |
|---|---|
| [RUNBOOK-LIVE.md](RUNBOOK-LIVE.md) | **script minuto a minuto da live + botões de pânico** |
| [postman/](postman/) | collection do Postman — consumo manual e plano B dos controles de palco |
| [AGENTE.md](AGENTE.md) | contrato de operação do Hermes (queries LogQL, campos, fluxo) |
| [CHECKLIST-PRE-LIVE.md](CHECKLIST-PRE-LIVE.md) | validação 1h antes |
| [DEPLOY.md](DEPLOY.md) | deploy no Coolify |
| [PRD.md](PRD.md) | requisitos originais |
| [CLAUDE.md](CLAUDE.md) | diretrizes de implementação |

## Troubleshooting

**Não chega log no Loki**
```bash
curl -s localhost:9080/ready                                    # Promtail vivo?
docker compose exec api tail -3 /var/log/app/api.log            # a API está escrevendo?
docker compose exec promtail cat /promtail/positions.yaml       # o Promtail achou o arquivo?
curl -s localhost:3100/loki/api/v1/label/job/values | jq -r '.data[]'   # => api
```

**Query LogQL retorna 400** — falta `--data-urlencode`.

**Nunca rode `docker compose down -v`.** O `-v` apaga `postgres_data` **e** `loki_data`, levando junto todo o histórico que o Hermes iria buscar. `down` sozinho é seguro: a stack volta em ~15s com os dados intactos.

## Status

- [x] Monorepo + workspaces
- [x] Fastify API com Pino (logs JSON)
- [x] Endpoints `/v1` e `/v2` completos
- [x] `POST /checkout` com falha ~50% e erro estruturado
- [x] Dashboard HOSTMASTER com botão "Comprar" e painel de logs
- [x] Prisma + migration + seed idempotente
- [x] docker-compose completo (Postgres, API, Web, Promtail, Loki, Grafana)
- [x] Queries do AGENTE.md validadas contra o Loki (`scripts/smoke.sh`)
- [ ] Deploy no Coolify — ver [DEPLOY.md](DEPLOY.md)
- [ ] Ensaio completo dos 3 atos

## Nota de segurança

Demo pública e efêmera: sem autenticação, `auth_enabled: false` no Loki, credenciais de banco fixas no compose. Todos os dados são fictícios. **Não reaproveitar esta configuração para nada que não seja esta talk.** Sobre expor o Loki na internet, ver [DEPLOY.md](DEPLOY.md).

O `npm audit` reporta 3 vulnerabilidades high transitivas do Next 15 (`postcss`, `sharp`); corrigir exigiria Next 16. Sem impacto para uma demo de uma noite sem upload de imagem nem CSS de terceiros.
