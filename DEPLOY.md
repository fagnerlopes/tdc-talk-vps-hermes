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

## Exposição do Loki (R4) — decidido

**O Hermes roda numa VPS separada do Coolify.** Ou seja, a porta 3100 precisa ser alcançável pela internet — `127.0.0.1:3100:3100` não serve aqui.

O problema: o repositório é público e o Loki roda com `auth_enabled: false`. Quem achar a 3100 aberta **lê e escreve** logs. Escrever é o pior dos dois: um terceiro pode injetar linhas no stream `job="api"` e envenenar a investigação do Hermes no meio da talk.

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
curl -s http://<HOST>:3100/ready

# do seu laptop — deve dar timeout
curl -s -m 5 http://<HOST>:3100/ready
```

### Opção B — basic-auth no Traefik (se o IP do Hermes for dinâmico)

No Coolify, adicione ao serviço `loki` os labels do Traefik com um middleware `basicauth`. **Não** coloque a senha no [AGENTE.md](AGENTE.md) — o repositório é público. Deixe o `AGENTE.md` com placeholders e passe as credenciais ao Hermes por variável de ambiente:

```bash
curl -sG -u "$LOKI_USER:$LOKI_PASS" "https://loki.<dominio>/loki/api/v1/query_range" \
  --data-urlencode 'query={job="api"} | json | level="error"'
```

Gere o hash com `htpasswd -nb hermes '<senha>'` e dobre os `$` para `$$` no valor do label.

### Nos dois casos

- A 3100 fica exposta **só entre o deploy de domingo e a live de segunda**. Depois da live, `docker compose down` ou feche a porta.
- O Grafana (`:3300`) fala com o Loki pela rede interna do compose e não é afetado por nenhuma das duas opções.
- Se em algum momento aparecer no Loki um stream com label diferente de `job="api"`, alguém escreveu de fora. Confira antes de subir ao palco:
  ```bash
  curl -s http://<HOST>:3100/loki/api/v1/labels | jq -c '.data'
  # esperado: ["filename","job","service_name"]
  ```

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
