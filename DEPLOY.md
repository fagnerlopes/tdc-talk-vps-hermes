# Deploy no Coolify

**Status: no ar, com TLS e sem portas cruas.** Smoke test sem falhas contra os domínios.

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
    "web":       { "name": "web",       "domain": "https://hostmaster.fagnerlopes.dev:3000" },
    "api":       { "name": "api",       "domain": "https://api.hostmaster.fagnerlopes.dev:3001" },
    "loki-auth": { "name": "loki-auth", "domain": "https://loki.hostmaster.fagnerlopes.dev:3100" },
    "grafana":   { "name": "grafana",   "domain": "https://grafana.hostmaster.fagnerlopes.dev:3000" }
  }
}'
```

O domínio do Loki aponta para o serviço **`loki-auth`**, não para o `loki` — ver "Proteção do Loki" abaixo.

Quatro detalhes que custam tempo se você não souber:

- **A porta no fim de cada URL é a porta interna do container, não a pública.** É assim que o Traefik sabe para onde rotear. Por isso o Grafana é `:3000` (o que ele escuta) e não `:3300` (o que o compose publicava no host).
- **O campo `name` é obrigatório** e repete a chave do serviço. Sem ele o Coolify 4.3.2 responde `Validation failed` com `docker_compose_domains.web.name field is required`. Sucesso devolve só `{"uuid":"..."}`.
- **O campo volta da API como string JSON**, não como objeto. Para conferir: `api "$COOLIFY/api/v1/applications/$APP" | jq -r '.docker_compose_domains' | jq '.'`
- **Serviço novo só aceita domínio depois de ser deployado uma vez.** O Coolify valida a chave contra o compose que ele já parseou e **descarta em silêncio** o que não reconhece — o PATCH responde `{"uuid":"..."}` como se tivesse dado certo. Ordem: `git push` → deploy → PATCH do domínio → deploy de novo.

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

## Proteção do Loki — resolvida

**O Hermes roda numa VPS separada do Coolify**, então o Loki precisa ser alcançável pela internet. A escolha foi **basic-auth sobre TLS**, e não a allowlist por IP: o IP de saída da VPS do Hermes pode mudar, e com basic-auth a credencial não trafega em claro.

O problema era real, não teórico. Com a stack no ar, um `push` anônimo de um laptop qualquer era aceito com **HTTP 204** — dava para injetar linhas em `job="api"` e envenenar a investigação do Hermes ao vivo. Hoje:

```bash
LOKI=https://loki.hostmaster.fagnerlopes.dev
curl -s -o /dev/null -w '%{http_code}\n' "$LOKI/ready"                    # 401
curl -s -o /dev/null -u hermes:errada -w '%{http_code}\n' "$LOKI/ready"   # 401
curl -s -o /dev/null -u "hermes:$SENHA" -w '%{http_code}\n' "$LOKI/ready" # 200

# o push anônimo que respondia 204:
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$LOKI/loki/api/v1/push" \
  -H 'content-type: application/json' \
  -d '{"streams":[{"stream":{"job":"x"},"values":[["1","y"]]}]}'           # 401
```

### Por que um proxy nginx e não um middleware do Traefik

A primeira tentativa foi um middleware `basicauth` do Traefik via label, como manda o design. **Não funciona no Coolify.** O Coolify substitui variáveis em `environment:`, mas **escapa** `${VAR}` para `$${VAR}` em `labels:`. O middleware recebia a string literal `${LOKI_BASIC_AUTH}` como lista de usuários, o Traefik marcava o roteador como inválido, e todo acesso ao domínio virava **503 `no available server`** — sintoma que parece problema de rede e não de configuração.

Escrever o hash direto no label não é opção: **este repositório é público.**

A solução é o serviço `loki-auth` — um nginx de ~20 linhas que faz o basic-auth e encaminha para `http://loki:3100`. O domínio `loki.hostmaster.fagnerlopes.dev` aponta para **ele**, não para o `loki`. O TLS continua sendo do Traefik.

### O hash vai em base64, e isso não é frescura

`LOKI_BASIC_AUTH_B64` guarda a linha htpasswd **codificada em base64**. O motivo é que o `$` do hash apr1 não sobrevive à interpolação do Compose:

| valor no `.env` | o que chega no container |
|---|---|
| `hermes:$apr1$Nqc9VQaU$EteDq...` | `hermes:$apr1qc9VQaUteDq...` (comeu os `$X`) |
| `hermes:$$apr1$$Nqc9VQaU$$EteDq...` | `hermes:$$apr1$qc9VQaU$teDq...` (outro estrago) |
| base64 | intacto |

Base64 usa só `[A-Za-z0-9+/=]`, atravessa Compose e Coolify sem alteração. Gerar:

```bash
printf '%s' "hermes:$(openssl passwd -apr1 '<senha>')" | base64 -w0
```

O container **aborta no boot** se `LOKI_BASIC_AUTH_B64` estiver ausente ou não decodificar num par `usuario:hash` — falhar alto é melhor que subir um Loki aberto por engano.

### O que NÃO é afetado

Os dois caminhos internos não passam pelo `loki-auth`:

- Promtail → `http://loki:3100` (push)
- Grafana → `http://loki:3100` (datasource)

O basic-auth barra só quem vem de fora. **Se o Grafana parar de ver dados, o problema é outro.**

### Antes de subir ao palco

```bash
curl -sG -u "hermes:$SENHA" "$LOKI/loki/api/v1/label/job/values" | jq -c '.data'
# esperado: ["api"]
# qualquer job além de "api" = alguém escreveu de fora
```

O marcador `teste-de-exposicao`, deixado pelo push anônimo original, saiu da janela padrão de consulta de labels e não aparece mais. Isso é esperado.

## Portas — todas fechadas

Nenhum serviço publica porta no host. O `docker-compose.yml` não tem um único bloco `ports:`; todo acesso externo entra pelo Traefik nas 80/443 e é roteado por domínio.

```bash
for p in 3000 3001 3100 3300 9080 5432; do
  printf '%-6s ' "$p"
  timeout 5 bash -c "</dev/tcp/177.153.35.27/$p" 2>/dev/null && echo ABERTA || echo fechada
done
# esperado: as seis fechadas
```

Isso é o que resolveu, de uma vez, os dois riscos que estavam abertos:

| Porta | Serviço | Risco que existia |
|---|---|---|
| `5432` | Postgres | aceitava conexão com `dev_user`/`dev123` — credenciais **deste repositório público**. Dava para apagar a tabela `products` no meio da demo. |
| `3100` | Loki | leitura e escrita anônimas. Escrever era o pior: dava para injetar linhas em `job="api"` e envenenar a investigação ao vivo. |
| `9080` | Promtail | expunha `/ready` e métricas. Risco baixo, mas nada externo precisa dele. |
| `3300` | Grafana | anônimo com papel Admin, por design. Quem achasse mexia nos dashboards. |
| `3000` / `3001` | Web e API | continuam públicas — agora por domínio e TLS, não por porta crua. |

### `ufw` não fecha porta publicada pelo Docker

O design original previa `ufw deny`. **Não funciona.** O Docker publica porta inserindo regra de DNAT na chain `DOCKER`, avaliada **antes** das regras do `ufw` na chain `filter`. Um `ufw deny 5432/tcp` num serviço com `ports: - "5432:5432"` deixa a porta aberta **e ainda dá a falsa sensação de ter fechado** — é a causa clássica de "fechei no firewall e continua acessível".

O fecho de verdade é remover o `ports:`: declarativo, versionado e reaplicado a cada deploy, sem depender de acesso SSH ao host.

### Desenvolvimento local

Sem `ports:`, `docker compose up` local perde acesso a tudo. Para isso existe o `docker-compose.override.yml`, que reintroduz as portas e está no `.gitignore`:

```bash
git check-ignore -v docker-compose.override.yml   # tem que casar com uma regra
```

**Se esse arquivo chegar ao repositório, o Coolify o aplica no deploy e reabre tudo.** É o único jeito de essa mudança regredir em silêncio.

O `loki-auth` sobe local em `3101` (o `3100` fica com o Loki cru), então o smoke test local roda com `LOKI_URL=http://localhost:3101` para exercitar o mesmo caminho autenticado da produção.

## Depois do deploy

1. ✅ Smoke test do laptop contra as URLs públicas — **23/23**:
   ```bash
   API_URL=https://api.hostmaster.fagnerlopes.dev WEB_URL=https://hostmaster.fagnerlopes.dev \
   LOKI_URL=https://loki.hostmaster.fagnerlopes.dev GRAFANA_URL=https://grafana.hostmaster.fagnerlopes.dev \
   LOKI_USER=hermes LOKI_PASS='<senha>' ./scripts/smoke.sh
   ```
   Esperado: `0 falharam`. O `1 pulado` é o Promtail, que não tem domínio — é esperado.
2. ✅ [AGENTE.md](AGENTE.md), [RUNBOOK-LIVE.md](RUNBOOK-LIVE.md) e [CHECKLIST-PRE-LIVE.md](CHECKLIST-PRE-LIVE.md) com as URLs públicas reais
3. ✅ **Portas cruas fechadas** e Loki atrás de basic-auth — ver as duas seções acima
4. ⬜ Baseline antes da live:
   ```bash
   API_URL=https://api.hostmaster.fagnerlopes.dev ./scripts/reset-demo.sh
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
