# Deploy no Coolify

VPS: `vps70013.publiccloud.com.br` · Coolify em `:8000`

## Pré-requisito: liberar a API do Coolify

Neste momento a API responde:

```
$ curl -H "Authorization: Bearer <TOKEN>" http://vps70013.publiccloud.com.br:8000/api/v1/version
{"success":true,"message":"You are not allowed to access the API."}
```

O token **autentica** (sem ele a resposta é `401 Unauthenticated`; com ele, `403`). O bloqueio é do middleware de API do Coolify. Na UI, em **Settings → API**:

1. Ativar **API enabled**
2. Em **Allowed IPs**, deixar vazio (libera todos) ou adicionar o IP de onde os comandos vão sair

Sem isso, faça o deploy pela UI seguindo a seção "Deploy pela UI" abaixo.

## Deploy pela API REST

```bash
export COOLIFY=http://vps70013.publiccloud.com.br:8000
export TOKEN='<api-token>'
api() { curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }

api "$COOLIFY/api/v1/version"                    # sanidade
api "$COOLIFY/api/v1/servers"  | jq -r '.[] | "\(.uuid)  \(.name)"'
api "$COOLIFY/api/v1/projects" | jq -r '.[] | "\(.uuid)  \(.name)"'
```

Guarde `server_uuid` e `project_uuid`, descubra o `environment_name` (normalmente `production`) e crie a aplicação:

```bash
api -X POST "$COOLIFY/api/v1/applications/dockercompose" -d '{
  "project_uuid": "<project-uuid>",
  "server_uuid": "<server-uuid>",
  "environment_name": "production",
  "git_repository": "https://github.com/fagnerlopes/tdc-talk-vps-hermes",
  "git_branch": "main",
  "docker_compose_location": "/docker-compose.yml",
  "name": "tdc-hermes-demo",
  "instant_deploy": false
}'
```

Depois, as variáveis de ambiente (uma chamada por variável, em `/api/v1/applications/<uuid>/envs`):

| Chave | Valor |
|---|---|
| `DATABASE_URL` | `postgresql://dev_user:dev123@postgres:5432/hermes_demo` |
| `LOG_FILE` | `/var/log/app/api.log` |
| `LOG_LEVEL` | `info` |
| `CHECKOUT_FAILURE_RATE` | `0.5` |
| `CHECKOUT_MAX_SUCCESS_STREAK` | `3` |
| `SEED_ON_BOOT` | `true` |
| `API_INTERNAL_URL` | `http://api:3001` |

E dispare:

```bash
api -X POST "$COOLIFY/api/v1/deploy?uuid=<app-uuid>&force=false"
```

## Deploy pela UI

1. **+ New → Docker Compose Empty** (ou **Public Repository**, apontando para `https://github.com/fagnerlopes/tdc-talk-vps-hermes`, branch `main`, compose em `/docker-compose.yml`)
2. Em **Environment Variables**, adicionar a tabela acima
3. Em **Domains**, apontar o domínio para o serviço `web` (porta 3000)
4. Publicar as portas `3001` (API — o Hermes) e `3300` (Grafana)
5. Decidir a exposição do Loki — ver abaixo
6. **Deploy**

O primeiro build leva **4–8 min** numa VPS pequena (duas imagens Node). Faça isso no **domingo**, não na segunda. Na segunda às 18h deve ser só `up` + smoke test.

## Exposição do Loki (R4)

O repositório é público e o Loki roda com `auth_enabled: false`. Quem achar a porta 3100 **lê e escreve** logs.

| Onde o Hermes roda | O que fazer |
|---|---|
| **Na própria VPS** | não publicar a 3100 na internet. No `docker-compose.yml`, trocar `"3100:3100"` por `"127.0.0.1:3100:3100"`. O Hermes acessa via `localhost`, e o Grafana (que fala com o Loki pela rede interna do compose) continua funcionando. |
| **Fora da VPS** | expor a 3100 atrás de basic-auth no Traefik do Coolify, e colocar as credenciais no [AGENTE.md](AGENTE.md). |

Não deixe o Loki aberto na internet de um dia para o outro. Depois da live, derrube a stack ou feche a porta.

## Depois do deploy

1. Rodar o smoke test do laptop, contra as URLs públicas:
   ```bash
   API_URL=http://<HOST>:3001 WEB_URL=https://<dominio> \
   LOKI_URL=http://<HOST>:3100 PROMTAIL_URL=http://<HOST>:9080 \
   GRAFANA_URL=http://<HOST>:3300 ./scripts/smoke.sh
   ```
2. **Atualizar o [AGENTE.md](AGENTE.md) com as URLs públicas reais.** O Hermes roda fora da VPS e não enxerga `localhost` — este passo não é opcional.
3. Atualizar o `<HOST>` no [RUNBOOK-LIVE.md](RUNBOOK-LIVE.md).
4. `./scripts/reset-demo.sh` para deixar no baseline.

## Riscos conhecidos no ambiente do Coolify

**Bind mount relativo de `./monitoring/*.yaml`** é a falha de compose mais reportada no Coolify. Se o `loki` ou o `promtail` subir reclamando de config ausente, troque `image:` por `build:` usando os Dockerfiles já commitados:

```yaml
loki:
  build: { context: ./monitoring, dockerfile: Dockerfile.loki }
  volumes: [loki_data:/loki]

promtail:
  build: { context: ./monitoring, dockerfile: Dockerfile.promtail }
  volumes: [app_logs:/var/log/app:ro, promtail_positions:/promtail]
```

**Versão do compose.** O compose local é 2.3.3 e já não aceita `docker compose ps --format '{{.Service}}'`. Não assuma paridade entre laptop e VPS — teste os comandos operacionais **na VPS**.

**Memória no build do Next.** `output: standalone` já reduz o consumo, e o build foi validado localmente. Se ainda assim estourar, faça `docker compose build web` sozinho antes de subir o resto.
