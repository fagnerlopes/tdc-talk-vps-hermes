# Separação loja/dashboard, autenticação e domínio próprio — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a exposição da stack na internet (domínios + TLS + portas cruas + basic-auth no Loki), separar a loja pública do painel do operador, e proteger o painel com autenticação de sessão real.

**Architecture:** Três frentes. (1) **Infra**: os quatro subdomínios de `fagnerlopes.dev` entram no Coolify como `docker_compose_domains`, o Traefik emite os certificados, o Loki ganha um middleware `basicauth` e as seis portas publicadas somem do `docker-compose.yml`. (2) **Frontend**: `/` vira a loja (só produtos, erro no vocabulário do cliente) e `/dashboard` vira o painel do operador (stats, logs, controles de demo num `<details>` fechado). (3) **Auth**: `AdminUser` + `Session` no Postgres, hash `scrypt` do `node:crypto`, cookie opaco `httpOnly`, barreira em `app/dashboard/layout.tsx`.

**Tech Stack:** Next.js 15 (App Router, `output: standalone`), Fastify 5, Prisma 6 + PostgreSQL 16, Tailwind 4, Vitest, Docker Compose, Coolify 4.3.2 + Traefik, Loki/Promtail/Grafana.

**Spec:** [docs/superpowers/specs/2026-08-15-auth-e-dominio-design.md](../specs/2026-08-15-auth-e-dominio-design.md)

---

## ⚠️ Estado: EXECUTADO — o que mudou em relação a este plano

Tudo abaixo está no ar e verificado. **Três coisas saíram diferentes do planejado**, e
quem reler este documento precisa saber antes de seguir os passos ao pé da letra.

**1. O basic-auth do Loki não é um middleware do Traefik.** É um serviço novo,
`loki-auth` (nginx), e o domínio `loki.hostmaster.fagnerlopes.dev` aponta para ele.
Motivo: o Coolify **escapa** `${VAR}` para `$${VAR}` em `labels:` (ele substitui em
`environment:`, mas não em `labels:`). O middleware recebia a string literal como
lista de usuários, o Traefik invalidava o roteador, e tudo virava **503 `no available
server`**. Como o repositório é público, o hash não podia ir literal no label. Toda a
Task 2 deste plano descreve o caminho que **não** funcionou — o que vale é
`monitoring/loki-auth.conf` e a seção "Proteção do Loki" do [DEPLOY.md](../../../DEPLOY.md).

**2. A credencial vai em base64 (`LOKI_BASIC_AUTH_B64`), não em texto.** O `$` do hash
apr1 não sobrevive à interpolação do Compose — nem cru, nem escapado com `$$`. Os dois
jeitos corrompem o hash de formas diferentes. Base64 atravessa intacto.

**3. `docker_compose_domains` exige um campo `name`** repetindo a chave do serviço, e
**um serviço novo só aceita domínio depois de ter sido deployado uma vez** — o Coolify
descarta em silêncio a chave que não reconhece, respondendo `{"uuid":"..."}` como se
tivesse funcionado.

Duas correções menores feitas durante a execução:

- A faixa de tolerância da taxa de falha no `smoke.sh` passou de 3-7 para **2-8**. O
  `CHECKOUT_MAX_SUCCESS_STREAK=3` empurra a taxa real para ~53%, e a faixa antiga
  disparava falso alarme em ~7% das execuções.
- As checagens que usam `docker compose` agora são **puladas quando o alvo é remoto**.
  Antes, rodar contra a VPS a partir do repositório com uma stack local de pé fazia
  elas passarem olhando para os containers errados.

E uma ação de segurança não prevista: a credencial do Loki foi **rotacionada** ao fim,
porque um fragmento real do hash (salt + início) chegou a ser commitado num comentário
de documentação, num repositório público.

---

## Global Constraints

Copiadas literalmente da seção "Restrições invioláveis" da spec. Valem para **toda** task deste plano.

- **A API e o Loki continuam sem autenticação para o Hermes.** A auth é assunto exclusivo do app Next. Se encostar nos endpoints `/vN/*`, a demo morre. O basic-auth do Loki é a única exceção, e é no Traefik, não na aplicação.
- **A falha forçada continua produzindo log byte-idêntico à natural.** Nenhum controle novo pode introduzir um campo `forced`.
- **`{job="api"} | json | level="error"` continua funcionando.** Toda mudança passa pelo `smoke.sh` antes de ser considerada pronta.
- **Nenhum segredo entra no repositório.** Ele é público. Senha de admin, hash htpasswd e credencial do Loki vivem em env var do Coolify, nunca em arquivo versionado.
- **Ordem obrigatória: TLS antes da senha definitiva.** Qualquer credencial criada sobre HTTP puro deve ser considerada queimada.
- **`docker compose down -v` é proibido.** O `-v` apaga `postgres_data` e `loki_data`.
- Idioma: código e identificadores em inglês/sem acento (segue o padrão do repo); comentários, documentação e texto de interface em português.

### Coordenadas do ambiente (já provisionado)

| | |
|---|---|
| VPS | `vps70013.publiccloud.com.br` / `177.153.35.27` |
| Coolify | `http://vps70013.publiccloud.com.br:8000` |
| Token da API | *(nunca versionar — em variável de ambiente; ver PROMPT-HERMES-COOLIFY.md)* |
| Aplicação | `rye22uhkjq7j4qauczrb3jlo` (`hostmaster-demo`) |
| Projeto | `hacknwt4zpfg0zqrwdqqdgqv` · Server `bqhc6vorheb0dwc3h756opbx` |

Helper usado em várias tasks:

```bash
export COOLIFY=http://vps70013.publiccloud.com.br:8000
export TOKEN='<token do Coolify — nunca versionar; ver PROMPT-HERMES-COOLIFY.md>'
export APP=rye22uhkjq7j4qauczrb3jlo
api() { curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }
```

### Correção de premissa da spec — leia antes da Task 3

A spec (§5) diz "fechar no firewall: 3000, 3001, 3100, 3300, 5432 e 9080" e o [DEPLOY.md](../../../DEPLOY.md) traz `ufw deny 3100/tcp`. **Isso não funciona.** O Docker publica portas inserindo regras na chain `DOCKER` do `nftables`/`iptables`, que é avaliada **antes** das regras do `ufw` na chain `filter`. Um `ufw deny 5432/tcp` num host com `ports: - "5432:5432"` deixa a porta aberta e dá a falsa impressão de que foi fechada. É a causa clássica de "fechei no ufw e continua acessível".

O fecho confiável é **remover o bloco `ports:` do `docker-compose.yml`** — declarativo, versionado, aplicado pelo próprio deploy do Coolify e imune a redeploy. É o que a Task 3 faz. Não há acesso SSH ao host neste ambiente, o que reforça a escolha.

### Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `docker-compose.yml` | remover `ports:`, labels do Traefik no `loki`, `DATABASE_URL` no `web` | 2, 3, 8 |
| `packages/database/src/password.ts` | `scrypt` — hash, verify, gerador de senha. **Sem import de Prisma** | 6 |
| `packages/database/src/session.ts` | TTL e expiração de sessão (funções puras). **Sem import de Prisma** | 6 |
| `packages/database/test/password.test.ts` | testes de hash | 6 |
| `packages/database/test/session.test.ts` | testes de expiração | 6 |
| `packages/database/prisma/schema.prisma` | `AdminUser` + `Session` | 7 |
| `packages/database/src/seed.ts` | cria o primeiro admin | 7 |
| `apps/web/lib/session-cookie.ts` | nome do cookie. **Zero imports** — o middleware roda no Edge | 8 |
| `apps/web/lib/session.ts` | `createSession`, `getSession`, `requireSession`, `destroySession` | 8 |
| `apps/web/middleware.ts` | atalho barato: cookie ausente → `/login`. **Não é a barreira** | 8 |
| `apps/web/app/dashboard/layout.tsx` | **a barreira**: `requireSession()` + shell | 8 |
| `apps/web/app/login/page.tsx` + `components/LoginForm.tsx` | tela de login | 8 |
| `apps/web/app/api/auth/login/route.ts` / `logout/route.ts` | sessão + cookie | 8 |
| `apps/web/app/dashboard/usuarios/page.tsx` + `components/UserAdmin.tsx` | CRUD de admins | 9 |
| `apps/web/app/api/dashboard/users/route.ts` / `[id]/route.ts` | revalidam a sessão no servidor | 9 |
| `apps/web/components/AppShell.tsx` | sidebar + topbar + main, compartilhado por loja e painel | 4 |
| `apps/web/components/DemoControls.tsx` | `<details>` fechado com os controles de palco | 4 |
| `apps/web/app/page.tsx` | loja pública | 4 |
| `apps/web/app/dashboard/page.tsx` | stats + logs + controles | 4 |
| `apps/web/app/robots.ts` | `Disallow: /` | 5 |
| `scripts/smoke.sh` | novas checagens + `-u` no Loki + promtail pulável | 10 |

---

## Ordem e linha de corte

A spec (§8) fasea assim: 1) split + controles, 2) noindex, 3) domínios/TLS/portas, 4) basic-auth no Loki, **— corte —**, 5) auth, 6) usuários, 7) testes.

**Este plano inverte 1–2 com 3–4**, porque a exposição está aberta agora e é o item urgente. E **move o basic-auth do Loki para antes do fechamento das portas**: com o domínio de pé e as portas ainda abertas, o Loki fica acessível por dois caminhos; fechando as portas primeiro, o domínio ficaria aberto ao mundo sem credencial no intervalo entre os dois deploys. Autenticar antes de fechar elimina a janela.

Ordem executada:

| Task | Fase da spec | Acima/abaixo do corte |
|---|---|---|
| 1. Domínios e TLS no Coolify | 3a | acima |
| 2. Basic-auth no Loki | 4 | acima |
| 3. Fechar as seis portas cruas | 3b | acima |
| 4. Split loja/dashboard + controles de demo | 1 | acima |
| 5. noindex | 2 | acima |
| — | — | **linha de corte para segunda** |
| 6. `password.ts` + `session.ts` + testes | 6a/7 | abaixo |
| 7. Schema, migration e primeiro admin | 6b | abaixo |
| 8. Login, sessão e proteção do `/dashboard` | 6c | abaixo |
| 9. `/dashboard/usuarios` | 7 | abaixo |
| 10. `smoke.sh` ampliado + varredura de docs | 8 | abaixo |

Se a Task 8 estourar, o fallback é o basic-auth do Traefik em `hostmaster.fagnerlopes.dev/dashboard`: protege o painel sem tela de login e a demo acontece igual (procedimento no fim da Task 8).

---

## Task 1: Domínios e TLS no Coolify

Os quatro registros A já existem e resolvem para `177.153.35.27`. Falta só dizer ao Coolify qual serviço do compose atende cada nome.

**Files:**
- Modify: `DEPLOY.md` (seção nova "Domínios e TLS")
- Nenhum arquivo de código. Toda a mudança é estado no Coolify.

**Interfaces:**
- Consumes: nada.
- Produces: quatro URLs HTTPS que as tasks 2, 3 e 10 usam —
  `https://hostmaster.fagnerlopes.dev` (web),
  `https://api.hostmaster.fagnerlopes.dev` (api),
  `https://loki.hostmaster.fagnerlopes.dev` (loki),
  `https://grafana.hostmaster.fagnerlopes.dev` (grafana).

**Contexto que você precisa saber:** o Coolify guarda o mapeamento num campo JSON chamado `docker_compose_domains`, no formato `{"<serviço>": {"domain": "https://host:<porta-interna>"}}`. **A porta no fim da URL não é a porta pública** — é a porta em que o container escuta, e é assim que o Traefik sabe para onde encaminhar. O `grafana` escuta na 3000 dentro do container (o `3300` do compose é só o mapeamento para o host), então vai `:3000`, não `:3300`.

- [ ] **Step 1: Registrar o estado atual, para poder voltar atrás**

```bash
export COOLIFY=http://vps70013.publiccloud.com.br:8000
export TOKEN='<token do Coolify — nunca versionar; ver PROMPT-HERMES-COOLIFY.md>'
export APP=rye22uhkjq7j4qauczrb3jlo
api() { curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }

api "$COOLIFY/api/v1/applications/$APP" > /tmp/app-antes.json
jq '{fqdn, docker_compose_domains, status}' /tmp/app-antes.json
```

Esperado: `fqdn: null`, `docker_compose_domains: null`, `status` contendo `running`.

- [ ] **Step 2: Confirmar que o DNS dos quatro nomes já aponta para a VPS**

```bash
for h in hostmaster api.hostmaster loki.hostmaster grafana.hostmaster; do
  printf '%-32s ' "$h.fagnerlopes.dev"
  getent ahostsv4 "$h.fagnerlopes.dev" | awk '{print $1}' | sort -u | tr '\n' ' '; echo
done
```

Esperado: os quatro devolvem `177.153.35.27`. Se algum não resolver, **pare** — o desafio HTTP-01 do Let's Encrypt vai falhar e o Traefik entra em backoff.

- [ ] **Step 3: Atribuir os quatro domínios**

```bash
api -X PATCH "$COOLIFY/api/v1/applications/$APP" -d '{
  "docker_compose_domains": {
    "web":     { "name": "web",     "domain": "https://hostmaster.fagnerlopes.dev:3000" },
    "api":     { "name": "api",     "domain": "https://api.hostmaster.fagnerlopes.dev:3001" },
    "loki":    { "name": "loki",    "domain": "https://loki.hostmaster.fagnerlopes.dev:3100" },
    "grafana": { "name": "grafana", "domain": "https://grafana.hostmaster.fagnerlopes.dev:3000" }
  }
}' | jq '.'
```

**O campo `name` é obrigatório e repete a chave do serviço.** Sem ele o Coolify 4.3.2
responde `{"message":"Validation failed.","errors":{"docker_compose_domains.web.name":
["The docker_compose_domains.web.name field is required."]}}`. Sucesso devolve só
`{"uuid":"..."}`.

- [ ] **Step 4: Verificar que persistiu — este passo não é opcional**

Existe um bug conhecido no Coolify ([#4326](https://github.com/coollabsio/coolify/issues/4326)) em que o PATCH responde sucesso e o domínio não persiste. Leia de volta:

```bash
api "$COOLIFY/api/v1/applications/$APP" | jq -r '.docker_compose_domains' | jq '.'
```

O campo volta como **string JSON**, não como objeto — por isso o `jq -r` antes do `jq`.

Esperado: as quatro chaves com os domínios do Step 3 (o `name` não é ecoado de volta,
só o `domain`). Se vier `null` ou faltando chave, **não siga** — configure pela UI do Coolify (`http://vps70013.publiccloud.com.br:8000` → aplicação `hostmaster-demo` → aba de cada serviço do compose → campo **Domains**) e repita este Step.

- [ ] **Step 5: Disparar o deploy**

```bash
DEPLOY=$(api -X POST "$COOLIFY/api/v1/deploy?uuid=$APP&force=false" | jq -r '.deployments[0].deployment_uuid')
echo "deployment: $DEPLOY"
```

- [ ] **Step 6: Acompanhar até terminar**

```bash
until [ "$(api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status')" != "in_progress" ]; do sleep 15; done
api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status'
```

Esperado: `finished`. Leva ~5 min (duas imagens Node). Se der `failed`:

```bash
api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.logs' | jq -r '.[].output' | tail -60
```

- [ ] **Step 7: Esperar os certificados e verificar os quatro domínios**

O Let's Encrypt leva de 10 a 60 segundos por domínio depois que o container sobe.

```bash
for u in https://hostmaster.fagnerlopes.dev \
         https://api.hostmaster.fagnerlopes.dev/v2/health \
         https://loki.hostmaster.fagnerlopes.dev/ready \
         https://grafana.hostmaster.fagnerlopes.dev/api/health; do
  printf '%-52s ' "$u"
  curl -s -o /dev/null -w '%{http_code} tls=%{ssl_verify_result}\n' -m 20 "$u"
done
```

Esperado: os quatro com HTTP `200` e `tls=0` (`ssl_verify_result=0` significa cadeia válida). Se algum devolver `404`, o Traefik não casou o roteador — reveja o `docker_compose_domains` no Step 4. Se der erro de TLS, espere 60s e repita; se persistir, veja os logs do Traefik pela UI do Coolify.

- [ ] **Step 8: Confirmar que o redirect HTTP→HTTPS está de pé**

```bash
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://hostmaster.fagnerlopes.dev
```

Esperado: `301` ou `308` para `https://hostmaster.fagnerlopes.dev/`.

- [ ] **Step 9: Rodar o smoke test contra os domínios novos**

As portas cruas ainda estão abertas, então o `PROMTAIL_URL` continua funcionando nesta task.

```bash
API_URL=https://api.hostmaster.fagnerlopes.dev \
WEB_URL=https://hostmaster.fagnerlopes.dev \
LOKI_URL=https://loki.hostmaster.fagnerlopes.dev \
PROMTAIL_URL=http://vps70013.publiccloud.com.br:9080 \
GRAFANA_URL=https://grafana.hostmaster.fagnerlopes.dev \
./scripts/smoke.sh
```

Esperado: `23 passaram, 0 falharam`. Se o gate crítico (seção 7) falhar, **pare e conserte** antes de seguir.

- [ ] **Step 10: Documentar no DEPLOY.md**

Substitua a tabela "URLs públicas" do [DEPLOY.md](../../../DEPLOY.md) por:

```markdown
### URLs públicas

| Serviço | URL |
|---|---|
| Loja | https://hostmaster.fagnerlopes.dev |
| Painel | https://hostmaster.fagnerlopes.dev/dashboard |
| API | https://api.hostmaster.fagnerlopes.dev |
| Loki | https://loki.hostmaster.fagnerlopes.dev |
| Grafana | https://grafana.hostmaster.fagnerlopes.dev |

O Promtail **não tem domínio** — nada externo precisa dele. O `/ready` só é
alcançável de dentro do host (`docker compose exec promtail wget -qO- localhost:9080/ready`).

Os domínios ficam no campo `docker_compose_domains` da aplicação. A porta no fim
de cada URL é a porta **interna** do container, não a pública — é assim que o
Traefik sabe para onde rotear. Por isso o Grafana é `:3000` e não `:3300`.

```bash
api "$COOLIFY/api/v1/applications/$APP" | jq '.docker_compose_domains'
```

O FQDN sslip que o Coolify gerou continua retornando 404 e pode ser ignorado.
```

- [ ] **Step 11: Commit**

```bash
git add DEPLOY.md
git commit -m "docs(deploy): quatro dominios com TLS no Coolify"
```

---

## Task 2: Basic-auth no Loki

Com o domínio de pé, `https://loki.hostmaster.fagnerlopes.dev` está aberto ao mundo — inclusive para `push`. Fechar isso vem antes de fechar as portas, senão a janela de exposição só muda de endereço.

**Files:**
- Modify: `docker-compose.yml` (serviço `loki`, bloco `labels:`)
- Modify: `.env.example`
- Modify: `AGENTE.md` (bloco de acesso ao Loki)
- Modify: `postman/HOSTMASTER-TDC.postman_collection.json` (auth no `/ready` da pasta 5)
- Modify: `DEPLOY.md`

**Interfaces:**
- Consumes: os domínios da Task 1.
- Produces: `LOKI_USER` / `LOKI_PASS` — variáveis de ambiente consumidas pelo `smoke.sh` (Task 10), pela collection do Postman e pelo Hermes. A env var `LOKI_BASIC_AUTH` no Coolify, no formato htpasswd.

**Contexto:** dois caminhos internos **não** passam pelo Traefik e portanto não são afetados: o Promtail faz push em `http://loki:3100` e o Grafana lê o datasource em `http://loki:3100`. O basic-auth barra só quem vem de fora. Isso costuma ser fonte de confusão — se depois da mudança o Grafana parar de ver dados, o problema é outro.

- [ ] **Step 1: Descobrir o nome real do roteador Traefik gerado pelo Coolify**

Este é o risco de implementação que a spec (§5) manda verificar cedo: o middleware precisa ser anexado a um roteador cujo nome o Coolify escolheu, não nós. O campo `docker_compose` da aplicação traz o compose **já processado**, com os labels gerados.

```bash
api "$COOLIFY/api/v1/applications/$APP" \
  | jq -r '.docker_compose' \
  | grep -E 'traefik\.http\.routers\.[^.]*\.(rule|entryPoints|tls)' \
  | grep -i loki
```

Anote os nomes dos roteadores que aparecem para o Loki. O padrão do Coolify é `https-<hash>-<serviço>` e `http-<hash>-<serviço>`; **use exatamente o que saiu no comando**, não o padrão presumido.

Se o comando não devolver nada, tente ver o compose inteiro e localizar a seção do loki:

```bash
api "$COOLIFY/api/v1/applications/$APP" | jq -r '.docker_compose' | sed -n '/^  loki:/,/^  [a-z]/p'
```

- [ ] **Step 2: Gerar a credencial**

Escolha um usuário (`hermes`) e uma senha forte. A senha **só pode ser criada agora**, com TLS de pé — senha criada sobre HTTP puro é considerada queimada (Global Constraints).

```bash
LOKI_PASS_PLAIN="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
echo "senha (guarde no gerenciador de senhas, NAO commite): $LOKI_PASS_PLAIN"

# htpasswd vem do apache2-utils; se nao tiver, use o openssl abaixo
htpasswd -nbB hermes "$LOKI_PASS_PLAIN" 2>/dev/null \
  || echo "hermes:$(openssl passwd -apr1 "$LOKI_PASS_PLAIN")"
```

Guarde as duas coisas: a senha em claro (vai para o Hermes e para o seu gerenciador) e o hash `usuario:$apr1$...` (vai para o Coolify).

- [ ] **Step 3: Adicionar os labels ao serviço `loki` no `docker-compose.yml`**

Substitua o bloco do serviço `loki` por (trocando `<ROUTER-HTTPS>` pelo nome que saiu no Step 1):

```yaml
  loki:
    build:
      context: ./monitoring
      dockerfile: Dockerfile.loki
    restart: unless-stopped
    command: -config.file=/etc/loki/local-config.yaml
    ports:
      - "3100:3100"
    volumes:
      # volume NOMEADO, nao bind mount — ver comentario em loki-config.yaml
      - loki_data:/loki
    # Basic-auth NO TRAEFIK, nao na aplicacao: o Loki continua com
    # auth_enabled: false e o Hermes so precisa de `curl -u`. Os dois caminhos
    # INTERNOS (promtail -> http://loki:3100 e grafana -> http://loki:3100) nao
    # passam pelo Traefik e NAO sao afetados — se o Grafana parar de ver dados
    # depois disto, o problema e outro.
    #
    # O nome do roteador e gerado pelo Coolify a partir do dominio. Confira com:
    #   api "$COOLIFY/api/v1/applications/$APP" | jq -r '.docker_compose' | grep -i 'routers.*loki'
    labels:
      - "traefik.enable=true"
      - "traefik.http.middlewares.loki-auth.basicauth.users=${LOKI_BASIC_AUTH}"
      - "traefik.http.routers.<ROUTER-HTTPS>.middlewares=loki-auth"
```

**Sobre o `$` do hash:** o hash htpasswd contém `$`, que o Compose interpreta como interpolação. Como aqui ele chega por **variável de ambiente** (`${LOKI_BASIC_AUTH}`), o valor não é reinterpolado e **não** precisa de `$$`. O `$$` só seria necessário se o hash estivesse escrito literalmente no arquivo — que é justamente o que não fazemos, porque o repositório é público.

- [ ] **Step 4: Documentar a variável no `.env.example`**

Acrescente ao fim de [.env.example](../../../.env.example):

```bash
# Loki — basic-auth no Traefik (so em producao; local nao usa)
# Gerar com:  htpasswd -nbB hermes '<senha>'
# NUNCA commitar o valor real: este repositorio e publico.
LOKI_BASIC_AUTH=
```

- [ ] **Step 5: Criar a env var no Coolify**

```bash
api -X POST "$COOLIFY/api/v1/applications/$APP/envs" \
  -d "$(jq -nc --arg v 'hermes:$apr1$COLE$O$HASH$AQUI' '{key:"LOKI_BASIC_AUTH", value:$v}')"
```

Não envie `is_build_time` — o Coolify 4.3.2 rejeita o campo com `"This field is not allowed."`. Confirme:

```bash
api "$COOLIFY/api/v1/applications/$APP/envs" | jq -r '.[] | select(.key=="LOKI_BASIC_AUTH") | .key'
```

- [ ] **Step 6: Commit e push (o Coolify puxa do git)**

```bash
git add docker-compose.yml .env.example
git commit -m "feat(loki): basic-auth no Traefik para acesso externo"
git push
```

- [ ] **Step 7: Deploy e espera**

```bash
DEPLOY=$(api -X POST "$COOLIFY/api/v1/deploy?uuid=$APP&force=false" | jq -r '.deployments[0].deployment_uuid')
until [ "$(api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status')" != "in_progress" ]; do sleep 15; done
api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status'
```

- [ ] **Step 8: Verificar que o basic-auth pegou — quatro checagens**

```bash
LOKI=https://loki.hostmaster.fagnerlopes.dev

# 1. sem credencial: 401
curl -s -o /dev/null -w 'sem auth       -> %{http_code} (esperado 401)\n' "$LOKI/ready"

# 2. credencial errada: 401
curl -s -o /dev/null -u hermes:errada -w 'auth errada    -> %{http_code} (esperado 401)\n' "$LOKI/ready"

# 3. credencial certa: 200
curl -s -o /dev/null -u "hermes:$LOKI_PASS_PLAIN" -w 'auth correta   -> %{http_code} (esperado 200)\n' "$LOKI/ready"

# 4. PUSH ANONIMO BARRADO — este e o que motivou tudo
curl -s -o /dev/null -w 'push anonimo   -> %{http_code} (esperado 401, NAO 204)\n' \
  -X POST "$LOKI/loki/api/v1/push" -H 'content-type: application/json' \
  -d '{"streams":[{"stream":{"job":"teste-pos-auth"},"values":[["'"$(date +%s)000000000"'","deve ser barrado"]]}]}'
```

Se a checagem 4 devolver `204`, o middleware **não** foi aplicado ao roteador certo. Volte ao Step 1 e confira o nome do roteador.

- [ ] **Step 9: Confirmar que o Promtail e o Grafana continuam funcionando**

```bash
# o Grafana le o Loki pela rede interna — precisa continuar vendo o datasource
curl -s "https://grafana.hostmaster.fagnerlopes.dev/api/datasources" | jq -r '.[0].type'   # loki

# gerar uma linha e confirmar que o Promtail ainda entrega
curl -s -X POST https://api.hostmaster.fagnerlopes.dev/v2/checkout \
  -H 'content-type: application/json' \
  -d '{"productId":"MONITOR-240HZ","userId":"user-1","forceFailure":true}' | jq -r .correlationId
sleep 5
curl -sG -u "hermes:$LOKI_PASS_PLAIN" "$LOKI/loki/api/v1/label/job/values" | jq -c '.data'
```

Esperado no último: `["api","teste-de-exposicao"]`. O `teste-de-exposicao` é o marcador deixado pelo push anônimo original — ele fica. **Qualquer job novo além desses dois significa que alguém escreveu de fora.** Se `teste-pos-auth` aparecer, o Step 8 falhou de verdade.

- [ ] **Step 10: Atualizar o AGENTE.md**

Em [AGENTE.md](../../../AGENTE.md), substitua o bloco de citação da seção "Ambiente de acesso" e a tabela por:

```markdown
> URLs de produção, já no ar, todas sobre HTTPS. O Hermes roda numa **VPS separada**
> da que hospeda a aplicação — ele não enxerga `localhost`.
>
> **O Loki exige basic-auth.** Todo `curl` ao Loki precisa de `-u "$LOKI_USER:$LOKI_PASS"`.
> As credenciais chegam ao Hermes por variável de ambiente e **não estão neste
> repositório**, que é público. A API da aplicação continua aberta, por design.

| Recurso | URL | Descrição |
|---|---|---|
| **API da aplicação** | `https://api.hostmaster.fagnerlopes.dev` | endpoints `/v1` e `/v2`, sem autenticação |
| **Loki** | `https://loki.hostmaster.fagnerlopes.dev` | query de logs — **exige `-u "$LOKI_USER:$LOKI_PASS"`** |
| **Grafana** | `https://grafana.hostmaster.fagnerlopes.dev` | Explore, sem login (uso humano, não do agente) |
| **Telegram** | canal privado | recebe comandos e envia alertas |

O PostgreSQL **não é mais acessível de fora** — a porta 5432 foi fechada. Para cruzar
`correlationId` com a tabela `orders`, use o `/v2/logs` da API ou peça acesso ao host.
```

Depois, no corpo do arquivo, troque **todas** as ocorrências de `http://vps70013.publiccloud.com.br:3001` por `https://api.hostmaster.fagnerlopes.dev` e `http://vps70013.publiccloud.com.br:3100` por `https://loki.hostmaster.fagnerlopes.dev`, e acrescente `-u "$LOKI_USER:$LOKI_PASS"` a todo `curl` que fala com o Loki. O exemplo canônico passa a ser:

```bash
LOKI=https://loki.hostmaster.fagnerlopes.dev

curl -sG -u "$LOKI_USER:$LOKI_PASS" "$LOKI/loki/api/v1/query_range" \
  --data-urlencode 'query={job="api"} | json | level="error"' \
  --data-urlencode "start=$(date -u -d '5 minutes ago' +%s)000000000" \
  --data-urlencode "end=$(date -u +%s)000000000" \
  --data-urlencode 'limit=100' | jq '.data.result'
```

Verifique que não sobrou nenhuma:

```bash
grep -n 'vps70013.publiccloud.com.br:3[0-9]' AGENTE.md   # esperado: nenhuma linha
grep -nc 'loki_url\|LOKI' AGENTE.md
```

- [ ] **Step 11: Corrigir a pasta 5 da collection do Postman**

A pasta 4 já tem `auth: basic` com `{{loki_user}}`/`{{loki_pass}}`, mas a request **"Loki está pronto"** vive na pasta 5, sem auth — vai passar a devolver 401. Adicione o mesmo bloco de auth àquela request:

```bash
jq '(.item[] | select(.name | startswith("5.")) | .item[] | select(.name == "Loki está pronto") | .request) |= (. + {
  auth: { type: "basic", basic: [
    { key: "username", value: "{{loki_user}}", type: "string" },
    { key: "password", value: "{{loki_pass}}", type: "string" }
  ] }
})' postman/HOSTMASTER-TDC.postman_collection.json > /tmp/collection.json \
  && mv /tmp/collection.json postman/HOSTMASTER-TDC.postman_collection.json

jq -r '.item[] | select(.name|startswith("5.")) | .item[] | "\(.name): \(.request.auth.type // "none")"' \
  postman/HOSTMASTER-TDC.postman_collection.json
```

Esperado: `Loki está pronto: basic`, os demais `none`.

- [ ] **Step 12: Validar a collection com newman**

O environment `HOSTMASTER-vps-tls` já tem `loki_user: hermes` e `loki_pass` vazio. Passe a senha por `--env-var` (não commite):

```bash
npx newman@6 run postman/HOSTMASTER-TDC.postman_collection.json \
  -e postman/HOSTMASTER-vps-tls.postman_environment.json \
  --env-var "loki_pass=$LOKI_PASS_PLAIN"
```

Esperado: 25 requests, 0 falhas.

- [ ] **Step 13: Atualizar o DEPLOY.md**

Substitua a seção "Exposição do Loki (R4) — ABERTA AGORA, precisa ser fechada" por uma seção "Proteção do Loki — resolvida" que registre: a escolha por basic-auth no Traefik (e não pela allowlist de IP, porque o IP de saída da VPS do Hermes pode mudar), o nome do roteador descoberto no Step 1, o fato de Promtail e Grafana não serem afetados, e o comando de verificação do Step 8. **Não escreva a senha nem o hash.**

- [ ] **Step 14: Commit**

```bash
git add AGENTE.md DEPLOY.md postman/HOSTMASTER-TDC.postman_collection.json
git commit -m "docs(loki): basic-auth nas instrucoes do Hermes e na collection"
git push
```

---

## Task 3: Fechar as seis portas cruas

**Files:**
- Modify: `docker-compose.yml` (remover `ports:` de `postgres`, `api`, `web`, `loki`, `promtail`, `grafana`)
- Modify: `scripts/smoke.sh` (checagem do Promtail vira pulável)
- Modify: `DEPLOY.md`
- Modify: `postman/HOSTMASTER-vps-portas.postman_environment.json` (marcar como obsoleto)

**Interfaces:**
- Consumes: domínios da Task 1, basic-auth da Task 2.
- Produces: `PROMTAIL_URL` deixa de ser alcançável de fora; o `smoke.sh` passa a ter um terceiro estado (`PULADO`), contabilizado em `SKIP`.

**Contexto:** ver "Correção de premissa da spec" nas Global Constraints. Remover `ports:` é o que fecha de verdade; `ufw` não fecha porta publicada pelo Docker.

- [ ] **Step 1: Confirmar o estado ANTES (para provar depois que fechou)**

```bash
for p in 3000 3001 3100 3300 9080 5432; do
  printf '%-6s ' "$p"
  timeout 5 bash -c "</dev/tcp/177.153.35.27/$p" 2>/dev/null && echo ABERTA || echo fechada
done
```

Esperado agora: as seis `ABERTA`.

- [ ] **Step 2: Remover os blocos `ports:` do `docker-compose.yml`**

Remova exatamente estes seis blocos:

```yaml
    ports:
      - "5432:5432"     # postgres
    ports:
      - "3001:3001"     # api
    ports:
      - "3000:3000"     # web
    ports:
      - "3100:3100"     # loki
    ports:
      - "9080:9080"     # promtail
    ports:
      - "3300:3000"     # grafana
```

E acrescente, logo abaixo da linha `services:`, o comentário que impede a regressão:

```yaml
# NENHUM servico publica porta no host. O acesso externo passa SO pelo Traefik do
# Coolify, nos dominios *.hostmaster.fagnerlopes.dev (campo docker_compose_domains
# da aplicacao). Isso e o que fecha o Postgres (dev_user/dev123 estao neste repo
# publico) e o push anonimo no Loki.
#
# NAO tente fechar com `ufw deny`: o Docker publica porta inserindo regra na chain
# DOCKER, avaliada ANTES das regras do ufw. `ufw deny 5432/tcp` num servico com
# `ports:` deixa a porta aberta e da falsa sensacao de seguranca.
#
# Para desenvolver localmente sem Traefik, use `docker-compose.override.yml`
# (gitignored) reintroduzindo os `ports:` que voce precisar.
```

- [ ] **Step 3: Criar o override local e garantir que ele fica fora do git**

Sem os `ports:`, `docker compose up` local perde acesso a tudo. O override resolve, e **não** pode ir para o repositório — senão o Coolify o aplica e reabre as portas.

Crie `docker-compose.override.yml`:

```yaml
# Uso LOCAL apenas. Nao versionado — ver .gitignore.
# Reintroduz as portas que o compose de producao nao publica, para desenvolver
# sem Traefik. Se este arquivo chegar ao repositorio, o Coolify o aplica no
# deploy e reabre exatamente as portas que a Task 3 fechou.
services:
  postgres:
    ports: ["5432:5432"]
  api:
    ports: ["3001:3001"]
  web:
    ports: ["3000:3000"]
  loki:
    ports: ["3100:3100"]
  promtail:
    ports: ["9080:9080"]
  grafana:
    ports: ["3300:3000"]
```

Acrescente ao [.gitignore](../../../.gitignore):

```
# Reabre as portas para dev local. NUNCA versionar: o Coolify aplicaria no deploy.
docker-compose.override.yml
```

- [ ] **Step 4: Verificar que o override está mesmo ignorado**

```bash
git check-ignore -v docker-compose.override.yml
```

Esperado: uma linha apontando para a regra do `.gitignore`. Se não imprimir nada, o arquivo **vai** ser commitado — conserte antes de seguir.

- [ ] **Step 5: Tornar a checagem do Promtail pulável no `smoke.sh`**

O Promtail não ganha domínio (nada externo precisa dele), então `/ready` deixa de ser alcançável de fora. Pular em silêncio seria pior que não checar — por isso um terceiro estado, visível no resultado.

Acrescente o contador junto de `PASS`/`FAIL`:

```bash
PASS=0
FAIL=0
SKIP=0
```

e a função, junto de `ok`/`bad`:

```bash
skip() { printf '  \033[33mPULADO\033[0m %s\n' "$1"; SKIP=$((SKIP + 1)); }
```

Substitua a linha do Promtail na seção 6 por:

```bash
# O Promtail nao tem dominio: apos o fechamento das portas, /ready so e
# alcancavel de dentro do host. Tres tentativas, em ordem de disponibilidade.
if [ -n "${PROMTAIL_URL:-}" ] && [ "$(curl -s -m 5 "${PROMTAIL_URL}/ready" 2>/dev/null)" = "Ready" ]; then
  ok "promtail /ready (via PROMTAIL_URL)"
elif [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1 \
     && docker compose exec -T promtail wget -qO- localhost:9080/ready 2>/dev/null | grep -q Ready; then
  ok "promtail /ready (via docker compose exec)"
else
  skip "promtail /ready — sem acesso externo nem ao host; checar na VPS com: docker compose exec promtail wget -qO- localhost:9080/ready"
fi
```

E o rodapé:

```bash
head_ "Resultado"
printf '  %d passaram, %d falharam, %d pulados\n\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 6: Ensaiar localmente antes de mandar para produção**

Este passo existe porque, se o roteamento pelo Traefik falhar depois de remover os `ports:`, a stack fica **inacessível**. Melhor descobrir no laptop.

```bash
docker compose down
docker compose up -d --build
docker compose ps --services --filter status=running | grep -c .   # esperado: 6
./scripts/smoke.sh
```

Com o `docker-compose.override.yml` presente, o smoke local deve dar `0 falharam` e `0 pulados`. Isso prova que os serviços sobem sem depender dos `ports:` do arquivo principal.

- [ ] **Step 7: Commit e push**

```bash
git add docker-compose.yml .gitignore scripts/smoke.sh
git status --short   # confirme que docker-compose.override.yml NAO aparece
git commit -m "fix(seguranca): nenhuma porta publicada no host; acesso so pelo Traefik"
git push
```

- [ ] **Step 8: Deploy**

```bash
DEPLOY=$(api -X POST "$COOLIFY/api/v1/deploy?uuid=$APP&force=false" | jq -r '.deployments[0].deployment_uuid')
until [ "$(api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status')" != "in_progress" ]; do sleep 15; done
api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status'
```

- [ ] **Step 9: Confirmar que as seis portas fecharam**

```bash
for p in 3000 3001 3100 3300 9080 5432; do
  printf '%-6s ' "$p"
  timeout 5 bash -c "</dev/tcp/177.153.35.27/$p" 2>/dev/null && echo "ABERTA — FALHOU" || echo "fechada OK"
done
```

Esperado: as seis `fechada OK`. As 80 e 443 continuam abertas — são o Traefik.

- [ ] **Step 10: Confirmar que o Postgres morreu de fora de vez**

```bash
timeout 8 bash -c "</dev/tcp/177.153.35.27/5432" 2>/dev/null \
  && echo "AINDA ABERTA — investigue" \
  || echo "5432 inalcancavel — dev_user/dev123 nao servem mais para nada de fora"
```

- [ ] **Step 11: Smoke test pelos domínios, sem PROMTAIL_URL**

```bash
API_URL=https://api.hostmaster.fagnerlopes.dev \
WEB_URL=https://hostmaster.fagnerlopes.dev \
LOKI_URL=https://loki.hostmaster.fagnerlopes.dev \
LOKI_USER=hermes LOKI_PASS="$LOKI_PASS_PLAIN" \
GRAFANA_URL=https://grafana.hostmaster.fagnerlopes.dev \
./scripts/smoke.sh
```

> O suporte a `LOKI_USER`/`LOKI_PASS` dentro do `smoke.sh` entra na Task 10. Até lá, as
> checagens do Loki (seções 6 a 9) vão falhar com 401 — **isso é esperado nesta task**.
> O que precisa passar aqui são as seções 1–5 e 10, mais o `PULADO` do Promtail.
> Se você preferir não conviver com falhas vermelhas, execute a Task 10 Step 3 agora;
> ela é independente do resto daquela task.

- [ ] **Step 12: Marcar o environment de portas cruas como obsoleto**

```bash
jq '.name = "HOSTMASTER — VPS (portas cruas) [OBSOLETO — portas fechadas em 2026-08-15]"' \
  postman/HOSTMASTER-vps-portas.postman_environment.json > /tmp/env.json \
  && mv /tmp/env.json postman/HOSTMASTER-vps-portas.postman_environment.json
```

E em [postman/README.md](../../../postman/README.md), na tabela de environments, troque a linha correspondente por:

```markdown
| `HOSTMASTER — VPS (portas cruas)` | **obsoleto** — as portas foram fechadas; mantido só como histórico |
| `HOSTMASTER — VPS (dominios TLS)` | **produção** — é este que você quer |
```

- [ ] **Step 13: Registrar no DEPLOY.md**

Substitua a seção "As outras portas abertas" por:

```markdown
## Portas — todas fechadas

Nenhum serviço publica porta no host. `docker-compose.yml` não tem um único bloco
`ports:`; todo acesso externo entra pelo Traefik nas 80/443 e é roteado por domínio.

```bash
for p in 3000 3001 3100 3300 9080 5432; do
  printf '%-6s ' "$p"; timeout 5 bash -c "</dev/tcp/177.153.35.27/$p" 2>/dev/null && echo ABERTA || echo fechada
done
# esperado: as seis fechadas
```

**Não tente fechar porta publicada pelo Docker com `ufw`.** O Docker insere as
regras de DNAT na chain `DOCKER`, avaliada antes das regras do `ufw` na chain
`filter`. `ufw deny 5432/tcp` num serviço com `ports: - "5432:5432"` deixa a porta
aberta e ainda dá a falsa impressão de ter fechado. O fecho de verdade é remover o
`ports:` — declarativo, versionado e reaplicado a cada deploy.

Para desenvolver localmente sem Traefik existe o `docker-compose.override.yml`,
que reintroduz as portas e está no `.gitignore`. **Se ele chegar ao repositório, o
Coolify o aplica no deploy e reabre tudo.** Confira com `git check-ignore -v docker-compose.override.yml`.
```

E na lista "Depois do deploy", marque o item 3 como concluído.

- [ ] **Step 14: Commit**

```bash
git add DEPLOY.md postman/README.md postman/HOSTMASTER-vps-portas.postman_environment.json
git commit -m "docs: portas fechadas; environment de portas cruas marcado obsoleto"
git push
```

---

## Task 4: Split loja/dashboard + controles de demo

**Files:**
- Create: `apps/web/components/AppShell.tsx`
- Create: `apps/web/components/DemoControls.tsx`
- Create: `apps/web/app/dashboard/page.tsx`
- Create: `apps/web/app/dashboard/layout.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/Sidebar.tsx`
- Modify: `apps/web/components/TopBar.tsx`
- Modify: `apps/web/components/ProductGrid.tsx`

**Interfaces:**
- Consumes: `proxy()`, `DEMO_VERSION`, `requestRefresh()`, `formatBRL()` de [apps/web/lib/api.ts](../../../apps/web/lib/api.ts) — inalterados.
- Produces:
  - `AppShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode })` — server component.
  - `DemoControls()` — client component, sem props.
  - Rota `/dashboard` com o texto **"Logs recentes"** no HTML (o `smoke.sh` da Task 10 procura por ele).
  - Rota `/` com o texto **"Comprar"** no HTML (idem).
  - `apps/web/app/dashboard/layout.tsx` é onde a Task 8 insere `requireSession()`.

- [ ] **Step 1: Criar o `AppShell`**

Crie `apps/web/components/AppShell.tsx`:

```tsx
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * Chrome compartilhado entre a loja e o painel.
 *
 * A separacao entre as duas telas e de CONTEUDO, nao de moldura: a sidebar com
 * os links "Loja" e "Painel" e o que permite ir de uma cena a outra no palco.
 * A loja nao tem stats, logs nem controles; o painel nao tem cards de produto.
 */
export function AppShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar eyebrow={eyebrow} title={title} />

        <main className="flex flex-1 flex-col gap-6 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Dar props ao `TopBar`**

Em `apps/web/components/TopBar.tsx`, troque a assinatura e o bloco de título:

```tsx
export function TopBar({ eyebrow, title }: { eyebrow: string; title: string }) {
```

e, dentro do `<header>`:

```tsx
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50 lg:text-3xl">
          {title}
        </h1>
      </div>
```

O resto do componente (o polling de `/vN/health` e o dot de status) fica exatamente como está.

- [ ] **Step 3: Transformar "Loja" e "Painel" em links reais na Sidebar**

Substitua o conteúdo de `apps/web/components/Sidebar.tsx` por:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// "Loja", "Painel" e "Usuarios" navegam de verdade — sao as tres telas que
// existem. Os demais continuam decorativos, como sempre foram: um painel
// administrativo real tem mais itens, e a moldura precisa parecer plausivel.
const LINKS = [
  { label: 'Loja', href: '/' },
  { label: 'Painel', href: '/dashboard' },
  { label: 'Usuarios', href: '/dashboard/usuarios' },
];

const DECORATIVE = ['Produtos', 'Pedidos', 'Analytics', 'Settings'];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-800 bg-[#0d1526] lg:flex">
      <div className="flex h-20 items-center gap-3 border-b border-slate-800 px-6">
        <span className="grid h-9 w-9 place-items-center rounded bg-amber-500 font-mono text-lg font-bold text-slate-950">
          H
        </span>
        <span className="text-lg font-semibold tracking-tight text-slate-100">HOSTMASTER</span>
      </div>

      <nav className="flex flex-col gap-1 p-4">
        <p className="px-3 pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
          Navegacao
        </p>

        {LINKS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded border-l-2 border-amber-500 bg-slate-800/60 px-3 py-2.5 text-base font-medium text-slate-100'
                  : 'rounded border-l-2 border-transparent px-3 py-2.5 text-base text-slate-400 transition hover:bg-slate-800/40 hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none'
              }
            >
              {item.label}
            </Link>
          );
        })}

        <p className="px-3 pt-4 pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
          Painel
        </p>

        {DECORATIVE.map((label) => (
          <span
            key={label}
            aria-disabled="true"
            className="cursor-default rounded border-l-2 border-transparent px-3 py-2.5 text-base text-slate-500"
          >
            {label}
          </span>
        ))}
      </nav>

      <div className="mt-auto border-t border-slate-800 p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">Regiao</p>
        <p className="mt-1 text-sm text-slate-300">br-south-1 · vps</p>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Reescrever `/` como loja**

Substitua o conteúdo de `apps/web/app/page.tsx` por:

```tsx
import { PRODUCTS, type CatalogProduct } from '@hermes/database/catalog';

import { AppShell } from '../components/AppShell';
import { ProductGrid } from '../components/ProductGrid';

// Obrigatorio: sem isto o Next tenta buscar /v2/products em build time, quando
// o container da API nem existe, e o build do Docker morre com ECONNREFUSED.
export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://api:3001';

async function getProducts(): Promise<CatalogProduct[]> {
  try {
    const response = await fetch(`${API_INTERNAL_URL}/v2/products`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as { products: CatalogProduct[] };
    if (Array.isArray(payload.products) && payload.products.length > 0) return payload.products;
  } catch {
    // A pagina precisa renderizar mesmo com a API fora do ar no meio da demo.
  }
  return PRODUCTS;
}

export default async function Loja() {
  const products = await getProducts();

  return (
    <AppShell eyebrow="Loja · Gaming & Informatica" title="Produtos em destaque">
      <ProductGrid products={products} />
    </AppShell>
  );
}
```

- [ ] **Step 5: Trocar a mensagem de erro da loja pelo vocabulário do cliente**

Na `ProductGrid`, o `reason` técnico não pode aparecer — é justamente o que o Hermes vai descobrir. Em `apps/web/components/ProductGrid.tsx`, substitua o bloco `else` do `buy()`:

```tsx
      } else {
        // O cliente NAO ve o `reason` tecnico (payment_gateway_timeout) — e o que
        // o Hermes vai descobrir no Loki. Lojas de verdade mostram um codigo de
        // suporte, entao o correlationId na tela e realista, e preserva o beat de
        // ler o id em voz alta antes de perguntar ao agente.
        addToast({
          kind: 'error',
          title: 'Nao foi possivel concluir o pagamento',
          detail: `${product.name} · tente novamente em alguns instantes`,
          correlationId: payload.correlationId,
        });
      }
```

E no bloco de renderização do toast, troque o rótulo do chip:

```tsx
            {toast.correlationId ? (
              <p className="mt-2.5 flex items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  codigo de referencia
                </span>
                <CorrelationChip
                  id={toast.correlationId}
                  tone={toast.kind === 'error' ? 'error' : 'neutral'}
                />
              </p>
            ) : null}
```

Troque também o eyebrow técnico do cabeçalho da seção, que não faz sentido numa loja:

```tsx
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-slate-100">Produtos</h2>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
          entrega para todo o Brasil
        </p>
      </div>
```

- [ ] **Step 6: Criar os controles de demo**

Crie `apps/web/components/DemoControls.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { proxy, requestRefresh } from '../lib/api';

type Target = 'v2' | 'v1';

/**
 * Controles de palco. Deliberadamente discretos.
 *
 * RISCO ASSUMIDO: um botao "forcar erro" visivel na tela projetada conta para a
 * plateia que a falha e encenada. Por isso: <details> FECHADO por padrao, cinza,
 * sem destaque. Nao abra durante o Ato 2.
 *
 * Nenhum endpoint novo — tudo passa por /vN/config, /vN/simulate-crash e
 * /vN/checkout, pelo proxy que ja existia. E nada aqui marca a falha como
 * forcada: a linha de log sai byte-identica a de uma falha natural.
 *
 * Estes botoes tem um plano B: a pasta 3 da collection do Postman cobre
 * exatamente as mesmas operacoes. Ao mexer aqui, atualize la.
 */
export function DemoControls() {
  const [target, setTarget] = useState<Target>('v2');
  const [feedback, setFeedback] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function send(path: string, body: Record<string, unknown> | null, label: string) {
    setBusy(true);
    try {
      const response = await fetch(proxy(`/${target}${path}`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      setFeedback(`${label} · ${target} · HTTP ${response.status} · ${JSON.stringify(payload)}`);
    } catch (error) {
      setFeedback(`${label} · falhou: ${String(error)}`);
    } finally {
      setBusy(false);
      requestRefresh();
    }
  }

  const button =
    'rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-left text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <details className="rounded-lg border border-slate-800 bg-[#101828]">
      <summary className="cursor-pointer px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 select-none">
        Controles de demo
      </summary>

      <div className="flex flex-col gap-4 border-t border-slate-800 p-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Alvo
          </span>
          {(['v2', 'v1'] as Target[]).map((version) => (
            <button
              key={version}
              type="button"
              onClick={() => setTarget(version)}
              className={
                target === version
                  ? 'rounded border border-slate-500 bg-slate-700 px-2.5 py-1 font-mono text-xs text-slate-100'
                  : 'rounded border border-slate-700 px-2.5 py-1 font-mono text-xs text-slate-400 hover:text-slate-200'
              }
            >
              {version}
            </button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { forceNextOutcome: 'fail' }, 'Forcar falha')}
          >
            Forcar falha no proximo clique
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { forceNextOutcome: 'success' }, 'Forcar sucesso')}
          >
            Forcar sucesso no proximo clique
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() =>
              void send(
                '/checkout',
                { productId: 'MONITOR-240HZ', userId: 'user-1', forceFailure: true },
                'Checkout com falha',
              )
            }
          >
            Disparar checkout com falha agora
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/simulate-crash', null, 'Alternar disponibilidade')}
          >
            Derrubar / restabelecer servico
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { failureRate: 0 }, 'Taxa 0%')}
          >
            Taxa de falha 0%
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { failureRate: 0.5 }, 'Taxa 50%')}
          >
            Taxa de falha 50%
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { failureRate: 1 }, 'Taxa 100%')}
          >
            Taxa de falha 100%
          </button>

          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={() => void send('/config', { reset: true }, 'Reset')}
          >
            Resetar baseline
          </button>
        </div>

        {feedback ? (
          <p className="rounded border border-slate-800 bg-slate-900/60 p-2 font-mono text-xs break-all text-slate-400">
            {feedback}
          </p>
        ) : null}
      </div>
    </details>
  );
}
```

- [ ] **Step 7: Criar o layout do dashboard**

Crie `apps/web/app/dashboard/layout.tsx`:

```tsx
import { AppShell } from '../../components/AppShell';

// A Task 8 insere `requireSession()` aqui. ESTE layout e a barreira de
// autenticacao — toda rota sob /dashboard/* passa por ele. O middleware.ts faz
// so o atalho barato (cookie ausente -> /login) e NAO protege nada, porque roda
// no Edge e nao alcanca o Prisma.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell eyebrow="Operacao · producao" title="Painel administrativo">
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 8: Criar o dashboard**

Crie `apps/web/app/dashboard/page.tsx`:

```tsx
import { DemoControls } from '../../components/DemoControls';
import { RecentLogsPanel } from '../../components/RecentLogsPanel';
import { StatsStrip } from '../../components/StatsStrip';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  return (
    <>
      <StatsStrip />
      <RecentLogsPanel />
      <DemoControls />
    </>
  );
}
```

- [ ] **Step 9: Subir e conferir com os próprios olhos**

```bash
docker compose up -d --build web
sleep 5
curl -s http://localhost:3000/          | grep -c 'Comprar'        # esperado: >= 1
curl -s http://localhost:3000/          | grep -c 'Logs recentes'  # esperado: 0
curl -s http://localhost:3000/dashboard | grep -c 'Logs recentes'  # esperado: >= 1
curl -s http://localhost:3000/dashboard | grep -c 'Comprar '       # esperado: 0
curl -s http://localhost:3000/dashboard | grep -c 'Controles de demo'  # esperado: >= 1
```

Abra `http://localhost:3000` no navegador e confirme:
- a loja tem cards de produto e **nenhum** stat, log ou controle;
- clicar em "Comprar" e receber 500 mostra "Nao foi possivel concluir o pagamento" e um **codigo de referencia** — sem `payment_gateway_timeout` em lugar nenhum da tela;
- `/dashboard` tem stats, "Logs recentes" e o `<details>` **fechado**;
- a sidebar navega entre as duas.

- [ ] **Step 10: Confirmar que a linha de log continua idêntica**

O controle "Disparar checkout com falha agora" não pode ter introduzido campo novo:

```bash
docker compose exec -T api tail -1 /var/log/app/api.log | jq -r 'keys | join(",")'
```

Esperado: **nenhuma** chave `forced`. As chaves devem ser as mesmas de sempre (`level,timestamp,service,correlationId,endpoint,productId,userId,reason,stack,httpStatus,durationMs,amount,message` conforme o caso).

- [ ] **Step 11: Confirmar que a pasta 3 do Postman cobre os mesmos controles**

A collection é o plano B do palco: se a sessão do dashboard falhar na hora da talk, tudo o que estes botões fazem precisa estar lá.

```bash
jq -r '.item[] | select(.name|startswith("3.")) | .item[].name' postman/HOSTMASTER-TDC.postman_collection.json
```

Esperado — os sete controles, um a um, casando com os botões: forçar falha, forçar sucesso, taxa 0%, taxa 50%, taxa 100%, derrubar/restabelecer, resetar baseline. O oitavo botão ("Disparar checkout com falha agora") corresponde a **"Comprar (falha garantida)"** na pasta 2. Se algum não tiver par, acrescente à collection antes de seguir.

- [ ] **Step 12: Smoke test local**

```bash
./scripts/smoke.sh
```

A seção 10 checa `WEB_URL` contendo `HOSTMASTER` — continua valendo, o nome está na sidebar das duas telas. Esperado: `0 falharam`.

- [ ] **Step 13: Commit**

```bash
git add apps/web
git commit -m "feat(web): separa loja publica de painel do operador com controles de demo"
```

- [ ] **Step 14: Deploy e verificação em produção**

```bash
git push
DEPLOY=$(api -X POST "$COOLIFY/api/v1/deploy?uuid=$APP&force=false" | jq -r '.deployments[0].deployment_uuid')
until [ "$(api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status')" != "in_progress" ]; do sleep 15; done
api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status'

curl -s https://hostmaster.fagnerlopes.dev/ | grep -c 'Comprar'
curl -s https://hostmaster.fagnerlopes.dev/dashboard | grep -c 'Logs recentes'
```

---

## Task 5: noindex

Três camadas, porque cada uma cobre um caso distinto. Aplicado ao app **inteiro** — o `/dashboard` também não deve ser indexado.

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/app/robots.ts`
- Modify: `apps/web/next.config.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: `/robots.txt` servindo `Disallow: /` (o `smoke.sh` da Task 10 checa por esse texto) e o header `X-Robots-Tag` em toda resposta.

- [ ] **Step 1: `metadata.robots` no layout raiz — cobre as respostas HTML**

Em `apps/web/app/layout.tsx`, troque o objeto `metadata`:

```tsx
export const metadata: Metadata = {
  title: 'HOSTMASTER — Painel Administrativo',
  description: 'Dashboard administrativo HOSTMASTER',
  // Aplicado ao app INTEIRO, nao so a loja: o /dashboard tambem nao pode ser
  // indexado. Esta camada cobre as respostas HTML; robots.ts cobre quem consulta
  // robots.txt; o header em next.config.mjs cobre as respostas nao-HTML.
  robots: { index: false, follow: false },
};
```

- [ ] **Step 2: `robots.ts` — cobre os crawlers que consultam robots.txt**

Crie `apps/web/app/robots.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
```

- [ ] **Step 3: Header `X-Robots-Tag` — cobre as respostas não-HTML**

Em `apps/web/next.config.mjs`, acrescente ao objeto `nextConfig`, logo depois de `transpilePackages`:

```js
  // Terceira camada do noindex: metadata cobre HTML, robots.ts cobre quem le
  // robots.txt, e este header cobre o resto (JSON dos route handlers, assets).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
```

- [ ] **Step 4: Verificar as três camadas**

```bash
docker compose up -d --build web
sleep 5

curl -s http://localhost:3000/robots.txt
# esperado conter: User-Agent: *  e  Disallow: /

curl -s http://localhost:3000/ | grep -io '<meta name="robots"[^>]*>'
# esperado conter: noindex, nofollow

curl -sI http://localhost:3000/ | grep -i 'x-robots-tag'
# esperado: x-robots-tag: noindex, nofollow

curl -sI http://localhost:3000/api/proxy/v2/health | grep -i 'x-robots-tag'
# esperado: x-robots-tag: noindex, nofollow  (resposta nao-HTML)
```

As quatro precisam sair. Se a `<meta>` não aparecer, confira que o `robots` está no `metadata` do layout **raiz**, não de uma página.

- [ ] **Step 5: Commit e deploy**

```bash
git add apps/web/app/layout.tsx apps/web/app/robots.ts apps/web/next.config.mjs
git commit -m "feat(web): noindex em tres camadas no app inteiro"
git push

DEPLOY=$(api -X POST "$COOLIFY/api/v1/deploy?uuid=$APP&force=false" | jq -r '.deployments[0].deployment_uuid')
until [ "$(api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status')" != "in_progress" ]; do sleep 15; done

curl -s https://hostmaster.fagnerlopes.dev/robots.txt
curl -sI https://hostmaster.fagnerlopes.dev/ | grep -i x-robots-tag
```

---

## — LINHA DE CORTE PARA SEGUNDA —

Tudo acima já entrega valor sozinho: a stack deixa de estar exposta, a loja e o painel são cenas distintas e os controles de palco existem. Se o que vem abaixo estourar, o fallback está descrito no fim da Task 8.

---

## Task 6: `password.ts`, `session.ts` e testes

Duas funções puras e seus testes, antes de qualquer schema ou tela. Ambos os módulos vivem em `packages/database/src/` e **não importam Prisma** — assim o seed (que roda no container da API) e o Next usam exatamente a mesma implementação.

**Files:**
- Create: `packages/database/src/password.ts`
- Create: `packages/database/src/session.ts`
- Create: `packages/database/test/password.test.ts`
- Create: `packages/database/test/session.test.ts`
- Create: `vitest.config.ts` (raiz)
- Modify: `package.json` (raiz) — devDependency `vitest` + script `test`
- Modify: `packages/database/src/index.ts` — reexportar
- Modify: `packages/database/tsconfig.json` — não compilar `test/`

**Interfaces:**
- Consumes: nada além do `node:crypto`.
- Produces, todos reexportados por `@hermes/database`:
  - `hashPassword(plain: string): Promise<string>` — devolve `"<salt-hex>:<hash-hex>"`
  - `verifyPassword(plain: string, stored: string): Promise<boolean>`
  - `generatePassword(length?: number): string` — default 24
  - `SESSION_TTL_HOURS_DEFAULT: number` = `12`
  - `newSessionId(): string` — 32 bytes aleatórios em hex (64 chars)
  - `sessionTtlHours(raw?: string | undefined): number`
  - `sessionExpiresAt(ttlHours: number, now?: Date): Date`
  - `isSessionExpired(session: { expiresAt: Date } | null, now?: Date): boolean`

- [ ] **Step 1: Instalar o vitest e criar a config**

```bash
npm install --save-dev --workspaces=false vitest@^3
```

Crie `vitest.config.ts` na raiz:

```ts
import { defineConfig } from 'vitest/config';

// Os testes cobrem o que e critico de seguranca (hash e sessao), nao a UI.
// Eles importam de packages/database/src/* DIRETO — nunca de src/index.ts, que
// arrasta o client gerado do Prisma e exigiria um `prisma generate` so para
// rodar teste de funcao pura.
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    environment: 'node',
  },
});
```

Acrescente ao `scripts` do `package.json` da raiz:

```json
    "test": "vitest run",
```

- [ ] **Step 2: Escrever os testes de senha (que ainda falham)**

Crie `packages/database/test/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generatePassword, hashPassword, verifyPassword } from '../src/password';

describe('hashPassword / verifyPassword', () => {
  it('faz roundtrip: a senha correta e aceita', async () => {
    const stored = await hashPassword('senha-do-palco-2026');
    expect(await verifyPassword('senha-do-palco-2026', stored)).toBe(true);
  });

  it('rejeita senha errada', async () => {
    const stored = await hashPassword('senha-do-palco-2026');
    expect(await verifyPassword('senha-errada', stored)).toBe(false);
  });

  it('gera hashes diferentes para a mesma senha (salt aleatorio)', async () => {
    const a = await hashPassword('mesma-senha');
    const b = await hashPassword('mesma-senha');
    expect(a).not.toBe(b);
    // ...e ambos continuam validando
    expect(await verifyPassword('mesma-senha', a)).toBe(true);
    expect(await verifyPassword('mesma-senha', b)).toBe(true);
  });

  it('usa o formato salt:hash em hex', async () => {
    const stored = await hashPassword('x');
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it('rejeita hash malformado sem lancar', async () => {
    expect(await verifyPassword('x', 'sem-dois-pontos')).toBe(false);
    expect(await verifyPassword('x', 'aa:bb')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });

  it('generatePassword devolve o tamanho pedido e varia', () => {
    expect(generatePassword(24)).toHaveLength(24);
    expect(generatePassword(24)).not.toBe(generatePassword(24));
  });
});
```

Crie `packages/database/test/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isSessionExpired,
  newSessionId,
  sessionExpiresAt,
  sessionTtlHours,
  SESSION_TTL_HOURS_DEFAULT,
} from '../src/session';

describe('sessao', () => {
  it('gera id opaco de 64 chars hex e nunca repete', () => {
    const a = newSessionId();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(newSessionId());
  });

  it('rejeita sessao inexistente', () => {
    expect(isSessionExpired(null)).toBe(true);
  });

  it('rejeita sessao expirada', () => {
    const now = new Date('2026-08-17T22:00:00Z');
    const passado = new Date('2026-08-17T21:59:59Z');
    expect(isSessionExpired({ expiresAt: passado }, now)).toBe(true);
  });

  it('aceita sessao dentro da validade', () => {
    const now = new Date('2026-08-17T22:00:00Z');
    const futuro = new Date('2026-08-17T22:00:01Z');
    expect(isSessionExpired({ expiresAt: futuro }, now)).toBe(false);
  });

  it('trata o instante exato da expiracao como expirado', () => {
    const now = new Date('2026-08-17T22:00:00Z');
    expect(isSessionExpired({ expiresAt: now }, now)).toBe(true);
  });

  it('sessionExpiresAt soma as horas ao agora', () => {
    const now = new Date('2026-08-17T22:00:00Z');
    expect(sessionExpiresAt(12, now).toISOString()).toBe('2026-08-18T10:00:00.000Z');
  });

  it('sessionTtlHours cai no default para valor ausente ou invalido', () => {
    expect(SESSION_TTL_HOURS_DEFAULT).toBe(12);
    expect(sessionTtlHours(undefined)).toBe(12);
    expect(sessionTtlHours('')).toBe(12);
    expect(sessionTtlHours('   ')).toBe(12);
    expect(sessionTtlHours('nao-e-numero')).toBe(12);
    expect(sessionTtlHours('0')).toBe(12);
    expect(sessionTtlHours('-3')).toBe(12);
    expect(sessionTtlHours('6')).toBe(6);
  });
});
```

- [ ] **Step 3: Rodar os testes e ver falhar**

```bash
npm test
```

Esperado: FAIL com `Failed to resolve import "../src/password"` e `"../src/session"`.

- [ ] **Step 4: Implementar `password.ts`**

Crie `packages/database/src/password.ts`:

```ts
// scrypt do node:crypto — nao bcrypt nem argon2.
//
// Os dois exigem compilacao nativa, e o build roda numa VPS pequena; scrypt e
// built-in e nao acrescenta dependencia nenhuma. Salt aleatorio de 16 bytes por
// senha, formato `salt:hash` em hex, comparacao com timingSafeEqual.
//
// CRITICO: este arquivo nao pode importar Prisma. O seed (container da API) e o
// Next precisam usar exatamente a mesma funcao, e o web nao carrega o client
// gerado so para conferir senha.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEY_BYTES);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const separator = stored.indexOf(':');
  if (separator <= 0) return false;

  const saltHex = stored.slice(0, separator);
  const hashHex = stored.slice(separator + 1);

  // Buffer.from(hex) nao lanca em hex invalido: ele trunca. A checagem de
  // tamanho abaixo e o que rejeita entrada malformada.
  const expected = Buffer.from(hashHex, 'hex');
  const salt = Buffer.from(saltHex, 'hex');
  if (expected.length !== KEY_BYTES || salt.length !== SALT_BYTES) return false;

  const derived = await scrypt(plain, salt, KEY_BYTES);
  return timingSafeEqual(derived, expected);
}

// Alfabeto sem 0/O/1/l/I: a senha do primeiro admin pode acabar sendo lida de um
// `docker compose logs` e digitada a mao.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generatePassword(length = 24): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}
```

- [ ] **Step 5: Implementar `session.ts`**

Crie `packages/database/src/session.ts`:

```ts
// Politica de sessao — funcoes puras, sem Prisma e sem nada do Next.
//
// Sessao no banco em vez de JWT: da logout de verdade e revogacao imediata, sem
// gerenciar segredo compartilhado. O cookie carrega so o id opaco gerado aqui.

import { randomBytes } from 'node:crypto';

export const SESSION_TTL_HOURS_DEFAULT = 12;

/** 32 bytes aleatorios em hex — e o proprio valor do cookie. */
export function newSessionId(): string {
  return randomBytes(32).toString('hex');
}

export function sessionTtlHours(
  raw: string | undefined = process.env.SESSION_TTL_HOURS,
): number {
  if (raw === undefined || raw.trim() === '') return SESSION_TTL_HOURS_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return SESSION_TTL_HOURS_DEFAULT;
  return parsed;
}

export function sessionExpiresAt(ttlHours: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlHours * 3_600_000);
}

/** Sessao ausente conta como expirada — quem chama nao precisa tratar null. */
export function isSessionExpired(
  session: { expiresAt: Date } | null,
  now: Date = new Date(),
): boolean {
  if (session === null) return true;
  return session.expiresAt.getTime() <= now.getTime();
}
```

- [ ] **Step 6: Rodar os testes e ver passar**

```bash
npm test
```

Esperado: PASS, 13 testes.

- [ ] **Step 7: Reexportar e manter o `test/` fora do build**

Em `packages/database/src/index.ts`, acrescente depois de `export * from './catalog';`:

```ts
export * from './password';
export * from './session';
```

E em `packages/database/tsconfig.json`, acrescente `"test"` ao `exclude`:

```json
  "exclude": ["node_modules", "dist", "generated", "test"]
```

- [ ] **Step 8: Confirmar que o build do pacote continua limpo**

```bash
npm run build --workspace @hermes/database
ls packages/database/dist/password.js packages/database/dist/session.js
```

Esperado: os dois arquivos existem e o `tsc` não reclamou.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts packages/database
git commit -m "feat(database): hash scrypt e politica de sessao, com testes"
```

---

## Task 7: Schema, migration e primeiro admin

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_admin_auth/migration.sql` (gerada)
- Modify: `packages/database/src/seed.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `hashPassword`, `generatePassword` da Task 6.
- Produces: modelos `AdminUser` e `Session` no client do Prisma, acessíveis como `prisma.adminUser` e `prisma.session` — usados pela Task 8 e pela Task 9.

**Contexto:** tabela separada dos clientes da loja, de propósito. O `users` atual guarda `gamer-pro@example.com` e `tech-enthusiast@test.com`, está documentado no AGENTE.md e tem FK dos `orders` — o Hermes pode consultá-lo. Credencial de admin ali poluiria a superfície de investigação.

- [ ] **Step 1: Acrescentar os modelos ao schema**

Ao fim de `packages/database/prisma/schema.prisma`:

```prisma
// Tabela SEPARADA dos clientes da loja, de proposito. O model User guarda
// gamer-pro@example.com e tech-enthusiast@test.com, esta documentado no
// AGENTE.md e tem FK dos orders — o Hermes pode consulta-lo. Credencial de
// admin ali poluiria a superficie de investigacao.
model AdminUser {
  id           String    @id @default(cuid())
  email        String    @unique
  name         String
  passwordHash String
  createdAt    DateTime  @default(now())
  lastLoginAt  DateTime?
  sessions     Session[]

  @@map("admin_users")
}

model Session {
  id        String   @id // 32 bytes aleatorios em hex — e o valor do cookie
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  user AdminUser @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}
```

- [ ] **Step 2: Gerar a migration contra um Postgres de verdade**

```bash
docker compose up -d postgres
sleep 5
DATABASE_URL='postgresql://dev_user:dev123@localhost:5432/hermes_demo' \
  npx prisma migrate dev --schema packages/database/prisma/schema.prisma --name admin_auth
```

> Isto exige a 5432 alcançável no laptop — é o que o `docker-compose.override.yml` da Task 3 garante. Se estiver ausente, recrie-o.

- [ ] **Step 3: Conferir o SQL gerado**

```bash
cat packages/database/prisma/migrations/*_admin_auth/migration.sql
```

Precisa conter `CREATE TABLE "admin_users"`, `CREATE TABLE "sessions"`, o `UNIQUE INDEX` no `email` e a FK `sessions.userId -> admin_users.id` com `ON DELETE CASCADE`.

- [ ] **Step 4: Estender o seed**

Em `packages/database/src/seed.ts`, troque os imports e acrescente a função:

```ts
import { prisma } from './index';
import { PRODUCTS, USERS } from './catalog';
import { generatePassword, hashPassword } from './password';
```

```ts
/**
 * Cria o primeiro admin se nao houver nenhum. Idempotente: numa base que ja tem
 * admin, nao faz nada — inclusive nao reseta senha.
 *
 * Se ADMIN_PASSWORD nao vier definida, gera 24 caracteres e imprime UMA UNICA
 * VEZ no stdout do container (recuperavel com `docker compose logs api`). Nada
 * vai para o repositorio, que e publico.
 */
async function seedFirstAdmin(): Promise<void> {
  const existing = await prisma.adminUser.count();
  if (existing > 0) {
    console.log(`Seed: ${existing} admin(s) ja cadastrados, nada a fazer`);
    return;
  }

  const email = (process.env.ADMIN_EMAIL ?? 'admin@hostmaster.local').trim().toLowerCase();
  const provided = process.env.ADMIN_PASSWORD;
  const useProvided = typeof provided === 'string' && provided.length > 0;
  const password = useProvided ? provided : generatePassword(24);

  await prisma.adminUser.create({
    data: {
      email,
      name: 'Administrador',
      passwordHash: await hashPassword(password),
    },
  });

  if (useProvided) {
    console.log(`Seed: admin ${email} criado (senha vinda de ADMIN_PASSWORD)`);
  } else {
    console.log('');
    console.log('==========================================================');
    console.log('  PRIMEIRO ADMIN CRIADO — esta senha aparece UMA SO VEZ');
    console.log(`  email: ${email}`);
    console.log(`  senha: ${password}`);
    console.log('  Guarde agora. Para recuperar depois: docker compose logs api');
    console.log('==========================================================');
    console.log('');
  }
}
```

E chame-a no `main()`, depois do loop de `USERS`:

```ts
  await seedFirstAdmin();
```

- [ ] **Step 5: Documentar as variáveis no `.env.example`**

Acrescente:

```bash
# Primeiro admin do painel (so tem efeito quando a tabela admin_users esta vazia)
ADMIN_EMAIL=admin@hostmaster.local
# Se ausente, o seed gera 24 caracteres e imprime UMA VEZ no log do container.
# NUNCA commitar o valor real: este repositorio e publico.
ADMIN_PASSWORD=

# Validade da sessao do painel, em horas
SESSION_TTL_HOURS=12
```

- [ ] **Step 6: Rodar o seed e ver o admin nascer**

```bash
npm run build --workspace @hermes/database
DATABASE_URL='postgresql://dev_user:dev123@localhost:5432/hermes_demo' \
  ADMIN_EMAIL='fagner@hostmaster.local' \
  node packages/database/dist/seed.js
```

Esperado: `Seed completed: 5 produtos, 2 usuarios` **e** o bloco `PRIMEIRO ADMIN CRIADO` com uma senha de 24 caracteres. Copie a senha — você vai usá-la na Task 8.

- [ ] **Step 7: Confirmar a idempotência**

```bash
DATABASE_URL='postgresql://dev_user:dev123@localhost:5432/hermes_demo' \
  node packages/database/dist/seed.js
```

Esperado na segunda vez: `Seed: 1 admin(s) ja cadastrados, nada a fazer` — e **nenhuma** senha nova impressa.

- [ ] **Step 8: Commit**

```bash
git add packages/database .env.example
git commit -m "feat(database): tabelas admin_users e sessions, com seed do primeiro admin"
```

---

## Task 8: Login, sessão e proteção do `/dashboard`

**Files:**
- Create: `apps/web/lib/session-cookie.ts`
- Create: `apps/web/lib/session.ts`
- Create: `apps/web/middleware.ts`
- Create: `apps/web/app/login/page.tsx`
- Create: `apps/web/components/LoginForm.tsx`
- Create: `apps/web/components/LogoutButton.tsx`
- Create: `apps/web/app/api/auth/login/route.ts`
- Create: `apps/web/app/api/auth/logout/route.ts`
- Modify: `apps/web/app/dashboard/layout.tsx`
- Modify: `apps/web/next.config.mjs`
- Modify: `apps/web/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `prisma`, `verifyPassword`, `newSessionId`, `sessionExpiresAt`, `sessionTtlHours`, `isSessionExpired` de `@hermes/database` (tasks 6 e 7).
- Produces:
  - `SESSION_COOKIE: string` = `'hostmaster_session'` (de `apps/web/lib/session-cookie.ts`)
  - `interface SessionUser { id: string; email: string; name: string }`
  - `createSession(userId: string): Promise<{ id: string; expiresAt: Date }>`
  - `getSession(): Promise<SessionUser | null>`
  - `requireSession(): Promise<SessionUser>` — redireciona para `/login` se ausente
  - `destroySession(): Promise<void>`
  - `POST /api/auth/login` — `{email, password}` → 200 + `Set-Cookie` | 401
  - `POST /api/auth/logout` — 200, cookie limpo
  - Consumidos pela Task 9 e checados pelo `smoke.sh` da Task 10.

- [ ] **Step 1: O nome do cookie, num módulo sem imports**

Crie `apps/web/lib/session-cookie.ts`:

```ts
// Modulo deliberadamente sem NENHUM import.
//
// O middleware.ts roda no Edge Runtime, onde nao existe `node:crypto` nem o
// client do Prisma. Se ele importasse @hermes/database so para saber o nome do
// cookie, o build quebraria. Por isso o nome mora aqui, sozinho.
export const SESSION_COOKIE = 'hostmaster_session';
```

- [ ] **Step 2: A camada de sessão**

Crie `apps/web/lib/session.ts`:

```ts
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  isSessionExpired,
  newSessionId,
  prisma,
  sessionExpiresAt,
  sessionTtlHours,
} from '@hermes/database';

import { SESSION_COOKIE } from './session-cookie';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = newSessionId();
  const expiresAt = sessionExpiresAt(sessionTtlHours());
  await prisma.session.create({ data: { id, userId, expiresAt } });
  return { id, expiresAt };
}

/** Devolve o usuario da sessao, ou null. Sessao expirada e apagada de passagem. */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token === undefined || token === '') return null;

  const session = await prisma.session.findUnique({
    where: { id: token },
    include: { user: true },
  });

  if (isSessionExpired(session)) {
    if (session !== null) {
      // Limpeza best-effort: falhar aqui nao pode impedir o redirect para /login.
      await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    }
    return null;
  }

  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

/**
 * A BARREIRA. Chamada por app/dashboard/layout.tsx, por onde toda rota sob
 * /dashboard/* passa. O middleware.ts NAO protege nada — ver o comentario la.
 */
export async function requireSession(): Promise<SessionUser> {
  const user = await getSession();
  if (user === null) redirect('/login');
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token === undefined || token === '') return;
  await prisma.session.delete({ where: { id: token } }).catch(() => undefined);
}
```

- [ ] **Step 3: O middleware — o atalho, não a barreira**

Crie `apps/web/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from './lib/session-cookie';

/**
 * ATENCAO A QUEM MEXER DEPOIS: este middleware NAO e a barreira de autenticacao.
 *
 * Ele roda no Edge Runtime, onde o Prisma nao existe — logo nao tem como validar
 * o cookie contra o banco. Tudo o que ele faz e o atalho barato: cookie ausente
 * -> redireciona sem tocar no banco. Um cookie forjado passa por aqui sem
 * problema e e barrado adiante.
 *
 * A barreira e o `requireSession()` em app/dashboard/layout.tsx, e os route
 * handlers de /api/dashboard/* revalidam por conta propria.
 */
export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
```

- [ ] **Step 4: O route handler de login**

Crie `apps/web/app/api/auth/login/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { prisma, verifyPassword } from '@hermes/database';

import { createSession } from '../../../../lib/session';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let email = '';
  let password = '';

  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    if (typeof body.email === 'string') email = body.email.trim().toLowerCase();
    if (typeof body.password === 'string') password = body.password;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (email === '' || password === '') {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const user = await prisma.adminUser.findUnique({ where: { email } });

  // Mesma resposta e mesmo custo aproximado para "usuario nao existe" e "senha
  // errada": nao entregamos quais e-mails estao cadastrados.
  const ok = user !== null && (await verifyPassword(password, user.passwordHash));
  if (!ok || user === null) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const session = await createSession(user.id);
  await prisma.adminUser
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => undefined);

  const response = NextResponse.json({ ok: true, email: user.email });

  // `secure` derivado do protocolo real em vez de env var: atras do Traefik o
  // Next ve http, e o x-forwarded-proto e quem sabe a verdade. Assim o cookie e
  // secure em producao (TLS) e continua funcionando no docker compose local, que
  // e http puro — sem ninguem precisar lembrar de trocar uma variavel.
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');

  response.cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    path: '/',
    expires: session.expiresAt,
  });

  return response;
}
```

- [ ] **Step 5: O route handler de logout**

Crie `apps/web/app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from 'next/server';

import { destroySession } from '../../../../lib/session';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  // Sessao no banco em vez de JWT justamente por isto: apagar a linha revoga na
  // hora, sem esperar TTL nenhum.
  await destroySession();

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
```

- [ ] **Step 6: A tela de login**

Crie `apps/web/components/LoginForm.tsx`:

```tsx
'use client';

import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        // replace, nao push: o /login nao volta no botao voltar do navegador.
        window.location.replace(next);
        return;
      }

      setError('E-mail ou senha invalidos.');
    } catch {
      setError('Nao foi possivel falar com o servidor.');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2.5 text-base text-slate-100 focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none';

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm text-slate-400">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={field}
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm text-slate-400">
          Senha
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={field}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded border border-red-500/50 bg-red-950/60 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-1 rounded bg-amber-500 px-4 py-3 text-base font-semibold text-slate-950 transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
```

Crie `apps/web/app/login/page.tsx`:

```tsx
import Link from 'next/link';

import { LoginForm } from '../../components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  // So aceitamos destino interno: `next=https://outro.site` viraria um open
  // redirect de graca.
  const raw = params.next ?? '/dashboard';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded bg-amber-500 font-mono text-lg font-bold text-slate-950">
            H
          </span>
          <span className="text-lg font-semibold tracking-tight text-slate-100">HOSTMASTER</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Acesso ao painel</h1>
        <p className="mt-1.5 mb-6 text-sm text-slate-400">
          Area restrita a operadores. Clientes usam a{' '}
          <Link href="/" className="text-amber-400 underline underline-offset-2">
            loja
          </Link>
          .
        </p>

        <LoginForm next={next} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: O botão de sair**

Crie `apps/web/components/LogoutButton.tsx`:

```tsx
'use client';

export function LogoutButton({ email }: { email: string }) {
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/login');
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden font-mono text-xs text-slate-500 sm:inline">{email}</span>
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded border border-slate-700 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400 transition hover:border-slate-500 hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none"
      >
        Sair
      </button>
    </div>
  );
}
```

- [ ] **Step 8: Ligar a barreira no layout do dashboard**

Substitua `apps/web/app/dashboard/layout.tsx` por:

```tsx
import { AppShell } from '../../components/AppShell';
import { LogoutButton } from '../../components/LogoutButton';
import { requireSession } from '../../lib/session';

// ESTE LAYOUT E A BARREIRA. Toda rota sob /dashboard/* passa por ele, e o
// requireSession() valida o cookie contra o banco a cada request. O middleware.ts
// faz so o atalho barato e NAO protege nada — quem mexer depois nao pode assumir
// o contrario.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();

  return (
    <AppShell eyebrow="Operacao · producao" title="Painel administrativo">
      <div className="flex justify-end">
        <LogoutButton email={user.email} />
      </div>
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 9: Fazer o build do web enxergar o Prisma**

O app Next passa a falar com o Postgres. Sem isso o `output: standalone` não rastreia os engines do Prisma, o container sobe e morre no primeiro login — falha que não aparece em dev.

Em `apps/web/next.config.mjs`, acrescente ao `nextConfig`:

```js
  // O `output: standalone` rastreia so o que consegue ver nos imports. Os engines
  // binarios do Prisma sao carregados em runtime por caminho, entao o tracer nao
  // os encontra e o container morre no primeiro acesso ao banco. Este include e
  // explicito por isso. E uma falha que NAO aparece em `next dev`.
  outputFileTracingIncludes: {
    '/**': ['../../packages/database/generated/**'],
  },
```

Em `apps/web/package.json`, acrescente `@prisma/client` às dependências (o web agora o carrega em runtime):

```json
  "dependencies": {
    "@hermes/database": "*",
    "@prisma/client": "^6.13.0",
    "next": "^15.4.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
```

E rode `npm install` para atualizar o lockfile.

- [ ] **Step 10: Ajustar o Dockerfile do web**

Em `apps/web/Dockerfile`:

**a)** acrescente `openssl` ao stage `base` (o Prisma precisa dele):

```dockerfile
FROM node:22-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
```

**b)** substitua o stage `build` inteiro — o comentário antigo ("NENHUM prisma generate aqui") virou mentira e precisa sair, senão a próxima pessoa desfaz a mudança:

```dockerfile
# -------------------------------------------------------------------- build
# O web agora fala com o Postgres (sessao e admins), entao PRECISA do client
# gerado do Prisma — diferente de antes, quando so importava @hermes/database/catalog.
# `npm run build --workspace @hermes/database` faz `prisma generate` + `tsc`.
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY packages/database packages/database
COPY apps/web apps/web
RUN npm run build --workspace @hermes/database \
  && npm run build --workspace @hermes/web
```

**c)** garanta os engines no runner. O `outputFileTracingIncludes` já deve levá-los para dentro do `standalone`, mas uma cópia explícita custa nada e elimina a classe inteira de falha:

```dockerfile
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# Rede de seguranca para os engines do Prisma: se o tracer do Next tiver deixado
# algum de fora, esta copia resolve. Idempotente com o outputFileTracingIncludes.
COPY --from=build /app/packages/database/generated ./packages/database/generated
```

- [ ] **Step 11: Dar `DATABASE_URL` e `SESSION_TTL_HOURS` ao serviço `web`**

No `docker-compose.yml`, no serviço `web`:

```yaml
    environment:
      API_INTERNAL_URL: ${API_INTERNAL_URL:-http://api:3001}
      # O web passa a falar com o Postgres direto: sessoes e admins. Mesma string
      # do servico api.
      DATABASE_URL: ${DATABASE_URL:-postgresql://dev_user:dev123@postgres:5432/hermes_demo}
      SESSION_TTL_HOURS: ${SESSION_TTL_HOURS:-12}
```

E troque o `depends_on` para esperar o banco. **Atenção:** o `depends_on` atual é uma
lista (`- api`) e não dá para misturar lista e mapa no YAML — o bloco inteiro vira mapa:

```yaml
    depends_on:
      api:
        condition: service_started
      postgres:
        condition: service_healthy
```

Acrescente também `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `SESSION_TTL_HOURS` ao serviço `api`:

```yaml
      ADMIN_EMAIL: ${ADMIN_EMAIL:-admin@hostmaster.local}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}
      SESSION_TTL_HOURS: ${SESSION_TTL_HOURS:-12}
```

- [ ] **Step 12: Build limpo — o passo que pega a falha do Prisma no standalone**

```bash
docker compose build --no-cache web
docker compose up -d
sleep 15
docker compose logs web --tail 30
```

Esperado: o web sobe sem `Cannot find module` nem `Query engine library ... not found`.

- [ ] **Step 13: Verificar o fluxo inteiro**

```bash
BASE=http://localhost:3000
ADMIN_EMAIL=fagner@hostmaster.local
ADMIN_PASS='<a senha impressa na Task 7 Step 6>'

# 1. /login responde 200
curl -s -o /dev/null -w '/login              -> %{http_code} (esperado 200)\n' "$BASE/login"

# 2. /dashboard sem cookie redireciona para /login
curl -s -o /dev/null -w '/dashboard sem auth -> %{http_code} -> %{redirect_url}\n' "$BASE/dashboard"

# 3. senha errada -> 401
curl -s -o /dev/null -w 'login senha errada  -> %{http_code} (esperado 401)\n' \
  -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"nao-e-a-senha\"}"

# 4. senha certa -> 200 + cookie
curl -s -c /tmp/cookies.txt -o /dev/null -w 'login correto       -> %{http_code} (esperado 200)\n' \
  -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASS" '{email:$e,password:$p}')"
grep -q hostmaster_session /tmp/cookies.txt && echo 'cookie             -> presente' || echo 'cookie             -> AUSENTE'

# 5. /dashboard com cookie -> 200 e o painel de verdade
curl -s -b /tmp/cookies.txt -o /tmp/dash.html -w '/dashboard com auth -> %{http_code} (esperado 200)\n' "$BASE/dashboard"
grep -c 'Logs recentes' /tmp/dash.html

# 6. logout revoga
curl -s -b /tmp/cookies.txt -X POST "$BASE/api/auth/logout" > /dev/null
curl -s -b /tmp/cookies.txt -o /dev/null -w '/dashboard pos-logout -> %{http_code} -> %{redirect_url}\n' "$BASE/dashboard"
```

Esperado: (2) `307`/`308` para `/login?next=%2Fdashboard`; (3) `401`; (4) `200` e cookie presente; (5) `200` e `1` ocorrência de "Logs recentes"; (6) redirect para `/login` outra vez.

- [ ] **Step 14: Confirmar que a API e o Loki continuam SEM autenticação**

Esta é a restrição inviolável nº 1. Se ela quebrar, a demo morre.

```bash
curl -s -o /dev/null -w '/v2/health sem auth   -> %{http_code} (esperado 200)\n' http://localhost:3001/v2/health
curl -s -o /dev/null -w '/v2/checkout sem auth -> %{http_code} (esperado 200 ou 500)\n' \
  -X POST http://localhost:3001/v2/checkout -H 'content-type: application/json' \
  -d '{"productId":"MONITOR-240HZ","userId":"user-1"}'
curl -s -o /dev/null -w '/api/proxy sem auth   -> %{http_code} (esperado 200)\n' http://localhost:3000/api/proxy/v2/health
```

Nenhuma pode devolver 401 ou 302.

- [ ] **Step 15: Commit**

```bash
git add apps/web docker-compose.yml package-lock.json
git commit -m "feat(web): sessao no banco, tela de login e protecao do painel"
```

- [ ] **Step 16: Criar as env vars de produção no Coolify e fazer deploy**

Escolha a senha do primeiro admin **agora** — o TLS já está de pé desde a Task 1, então ela nasce sobre HTTPS.

```bash
ADMIN_PASS_PLAIN="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
echo "senha do admin (guarde no gerenciador, NAO commite): $ADMIN_PASS_PLAIN"

api -X POST "$COOLIFY/api/v1/applications/$APP/envs" -d '{"key":"ADMIN_EMAIL","value":"fagner@hostmaster.local"}'
api -X POST "$COOLIFY/api/v1/applications/$APP/envs" \
  -d "$(jq -nc --arg v "$ADMIN_PASS_PLAIN" '{key:"ADMIN_PASSWORD", value:$v}')"
api -X POST "$COOLIFY/api/v1/applications/$APP/envs" -d '{"key":"SESSION_TTL_HOURS","value":"12"}'

api "$COOLIFY/api/v1/applications/$APP/envs" | jq -r '.[].key' | sort -u
```

Não envie `is_build_time` — o Coolify 4.3.2 rejeita o campo.

```bash
git push
DEPLOY=$(api -X POST "$COOLIFY/api/v1/deploy?uuid=$APP&force=false" | jq -r '.deployments[0].deployment_uuid')
until [ "$(api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status')" != "in_progress" ]; do sleep 15; done
api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status'
```

- [ ] **Step 17: Repetir o Step 13 contra produção**

```bash
BASE=https://hostmaster.fagnerlopes.dev
ADMIN_EMAIL=fagner@hostmaster.local
ADMIN_PASS="$ADMIN_PASS_PLAIN"
# ...mesmos seis comandos do Step 13
```

Confirme também que o cookie veio `Secure` (agora há TLS):

```bash
curl -si -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASS" '{email:$e,password:$p}')" \
  | grep -i '^set-cookie'
```

Esperado: `hostmaster_session=...; Path=/; Expires=...; HttpOnly; Secure; SameSite=Lax`.

- [ ] **Step 18 (só se a Task 8 estourar): fallback de basic-auth no painel**

Se o Prisma no standalone não cooperar e o tempo apertar, reverta os commits desta task e proteja o painel pelo Traefik. Protege sem tela de login, e a demo acontece do mesmo jeito. No `docker-compose.yml`, serviço `web` (mesmo padrão da Task 2, com o roteador descoberto pelo `docker_compose`):

```yaml
    labels:
      - "traefik.enable=true"
      - "traefik.http.middlewares.painel-auth.basicauth.users=${PAINEL_BASIC_AUTH}"
      - "traefik.http.routers.<ROUTER-HTTPS-WEB>.middlewares=painel-auth"
```

**Atenção:** isso protege o domínio inteiro, inclusive a loja pública em `/`. Para proteger só o `/dashboard` é preciso um roteador adicional com `PathPrefix(\`/dashboard\`)` e prioridade maior — o que o Coolify não gera sozinho. Se for por esse caminho, teste que `/` continua aberta antes de considerar pronto.

---

## Task 9: `/dashboard/usuarios`

**Files:**
- Create: `apps/web/app/dashboard/usuarios/page.tsx`
- Create: `apps/web/components/UserAdmin.tsx`
- Create: `apps/web/app/api/dashboard/users/route.ts`
- Create: `apps/web/app/api/dashboard/users/[id]/route.ts`

**Interfaces:**
- Consumes: `getSession()`, `requireSession()` (Task 8); `prisma.adminUser`, `hashPassword` (tasks 6 e 7).
- Produces:
  - `POST /api/dashboard/users` — `{email, name, password}` → 201 `{id,email,name}` | 400 | 401 | 409
  - `DELETE /api/dashboard/users/[id]` → 200 | 401 | 409 (último admin ou você mesmo)
  - `interface AdminRow { id: string; email: string; name: string; createdAt: string; lastLoginAt: string | null }`

- [ ] **Step 1: O handler de criação**

Crie `apps/web/app/api/dashboard/users/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { hashPassword, prisma } from '@hermes/database';

import { getSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

const MIN_PASSWORD = 12;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Revalida no servidor. NAO confia em a UI ter escondido o botao: um POST
  // direto de fora chega exatamente aqui.
  const session = await getSession();
  if (session === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let email = '';
  let name = '';
  let password = '';

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.email === 'string') email = body.email.trim().toLowerCase();
    if (typeof body.name === 'string') name = body.name.trim();
    if (typeof body.password === 'string') password = body.password;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!email.includes('@') || name === '') {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: 'weak_password', message: `A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.` },
      { status: 400 },
    );
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing !== null) {
    return NextResponse.json({ error: 'email_taken' }, { status: 409 });
  }

  const created = await prisma.adminUser.create({
    data: { email, name, passwordHash: await hashPassword(password) },
    select: { id: true, email: true, name: true },
  });

  return NextResponse.json(created, { status: 201 });
}
```

- [ ] **Step 2: O handler de remoção**

Crie `apps/web/app/api/dashboard/users/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@hermes/database';

import { getSession } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (session === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;

  // Duas travas contra ficar trancado para fora do proprio painel na vespera da
  // talk. A segunda cobre o caso de dois operadores removerem um ao outro.
  if (id === session.id) {
    return NextResponse.json(
      { error: 'cannot_delete_self', message: 'Voce nao pode remover a propria conta.' },
      { status: 409 },
    );
  }

  const total = await prisma.adminUser.count();
  if (total <= 1) {
    return NextResponse.json(
      { error: 'last_admin', message: 'Nao da para remover o unico admin.' },
      { status: 409 },
    );
  }

  // onDelete: Cascade no schema derruba as sessions junto — o removido perde o
  // acesso na hora, sem esperar o TTL.
  await prisma.adminUser.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: A tela**

Crie `apps/web/components/UserAdmin.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface AdminRow {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt: string | null;
}

function formatDate(iso: string | null): string {
  if (iso === null) return 'nunca';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('pt-BR', { hour12: false });
}

export function UserAdmin({ admins, currentId }: { admins: AdminRow[]; currentId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      const response = await fetch('/api/dashboard/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
      });
      const payload = (await response.json()) as { message?: string; error?: string };

      if (response.ok) {
        setEmail('');
        setName('');
        setPassword('');
        setMessage(`Admin ${email} criado.`);
        router.refresh();
      } else {
        setMessage(payload.message ?? `Nao foi possivel criar (${payload.error ?? response.status}).`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AdminRow) {
    if (!window.confirm(`Remover ${row.email}?`)) return;
    setBusy(true);
    setMessage('');

    try {
      const response = await fetch(`/api/dashboard/users/${row.id}`, { method: 'DELETE' });
      const payload = (await response.json()) as { message?: string; error?: string };

      if (response.ok) {
        setMessage(`Admin ${row.email} removido.`);
        router.refresh();
      } else {
        setMessage(payload.message ?? `Nao foi possivel remover (${payload.error ?? response.status}).`);
      }
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none';

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-slate-100">Administradores</h2>

        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#131c2e]">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Ultimo login</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {admins.map((row) => (
                <tr key={row.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="px-4 py-3 text-slate-200">
                    {row.name}
                    {row.id === currentId ? (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-400">
                        voce
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{row.email}</td>
                  <td className="px-4 py-3 text-slate-400">{formatDate(row.lastLoginAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={busy || row.id === currentId}
                      onClick={() => void remove(row)}
                      className="rounded border border-slate-700 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400 transition hover:border-red-500/60 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-[#131c2e] p-5">
        <h3 className="mb-4 text-base font-medium text-slate-100">Novo administrador</h3>

        <form onSubmit={create} className="grid gap-3 sm:grid-cols-3">
          <input
            aria-label="Nome"
            placeholder="Nome"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={field}
          />
          <input
            aria-label="E-mail"
            type="email"
            placeholder="email@exemplo.com"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={field}
          />
          <input
            aria-label="Senha"
            type="password"
            placeholder="senha (min. 12 caracteres)"
            minLength={12}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={field}
          />

          <button
            type="submit"
            disabled={busy}
            className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-3 sm:justify-self-start sm:px-6"
          >
            {busy ? 'Salvando...' : 'Criar administrador'}
          </button>
        </form>

        {message ? (
          <p role="status" className="mt-3 rounded border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
            {message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
```

Crie `apps/web/app/dashboard/usuarios/page.tsx`:

```tsx
import { prisma } from '@hermes/database';

import { UserAdmin, type AdminRow } from '../../../components/UserAdmin';
import { requireSession } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function Usuarios() {
  // O layout do /dashboard ja chama requireSession(), mas repetir aqui custa uma
  // query e da o `id` do usuario atual, que a tabela precisa.
  const session = await requireSession();

  const rows = await prisma.adminUser.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, createdAt: true, lastLoginAt: true },
  });

  const admins: AdminRow[] = rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  }));

  return <UserAdmin admins={admins} currentId={session.id} />;
}
```

- [ ] **Step 4: Verificar, incluindo o que a UI esconde**

```bash
docker compose up -d --build web
sleep 10

BASE=http://localhost:3000
ADMIN_EMAIL=fagner@hostmaster.local
ADMIN_PASS='<a senha da Task 7 Step 6>'

curl -s -c /tmp/c.txt -o /dev/null -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASS" '{email:$e,password:$p}')"

# a pagina carrega
curl -s -b /tmp/c.txt "$BASE/dashboard/usuarios" | grep -c 'Administradores'    # >= 1

# SEM cookie, o POST tem que dar 401 — a UI esconder o botao nao e protecao
curl -s -o /dev/null -w 'POST sem cookie   -> %{http_code} (esperado 401)\n' \
  -X POST "$BASE/api/dashboard/users" -H 'content-type: application/json' \
  -d '{"email":"invasor@x.com","name":"Invasor","password":"senha-comprida-1"}'

# COM cookie, cria
NOVO=$(curl -s -b /tmp/c.txt -X POST "$BASE/api/dashboard/users" \
  -H 'content-type: application/json' \
  -d '{"email":"segundo@hostmaster.local","name":"Segundo","password":"senha-comprida-1"}' | jq -r .id)
echo "criado: $NOVO"

# senha curta -> 400
curl -s -o /dev/null -w 'senha curta       -> %{http_code} (esperado 400)\n' \
  -b /tmp/c.txt -X POST "$BASE/api/dashboard/users" -H 'content-type: application/json' \
  -d '{"email":"terceiro@x.com","name":"Terceiro","password":"curta"}'

# e-mail repetido -> 409
curl -s -o /dev/null -w 'email repetido    -> %{http_code} (esperado 409)\n' \
  -b /tmp/c.txt -X POST "$BASE/api/dashboard/users" -H 'content-type: application/json' \
  -d '{"email":"segundo@hostmaster.local","name":"Outro","password":"senha-comprida-1"}'

# DELETE sem cookie -> 401
curl -s -o /dev/null -w 'DELETE sem cookie -> %{http_code} (esperado 401)\n' \
  -X DELETE "$BASE/api/dashboard/users/$NOVO"

# DELETE com cookie -> 200
curl -s -o /dev/null -w 'DELETE com cookie -> %{http_code} (esperado 200)\n' \
  -b /tmp/c.txt -X DELETE "$BASE/api/dashboard/users/$NOVO"
```

- [ ] **Step 5: Confirmar as duas travas**

```bash
# tentar remover a si mesmo -> 409
EU=$(curl -s -b /tmp/c.txt "$BASE/dashboard/usuarios" > /dev/null; \
     docker compose exec -T postgres psql -U dev_user -d hermes_demo -tAc \
     "select id from admin_users where email='$ADMIN_EMAIL';")
curl -s -b /tmp/c.txt -o /dev/null -w 'remover a si mesmo -> %{http_code} (esperado 409)\n' \
  -X DELETE "$BASE/api/dashboard/users/$EU"
```

- [ ] **Step 6: Commit e deploy**

```bash
git add apps/web
git commit -m "feat(web): gestao de administradores no painel"
git push

DEPLOY=$(api -X POST "$COOLIFY/api/v1/deploy?uuid=$APP&force=false" | jq -r '.deployments[0].deployment_uuid')
until [ "$(api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status')" != "in_progress" ]; do sleep 15; done
api "$COOLIFY/api/v1/deployments/$DEPLOY" | jq -r '.status'
```

---

## Task 10: `smoke.sh` ampliado e varredura de documentação

**Files:**
- Modify: `scripts/smoke.sh`
- Modify: `AGENTE.md`, `RUNBOOK-LIVE.md`, `CHECKLIST-PRE-LIVE.md`, `README.md`, `DEPLOY.md`
- Modify: `CLAUDE.md`
- Modify: `postman/README.md`

**Interfaces:**
- Consumes: tudo o que veio antes.
- Produces: `./scripts/smoke.sh` aceitando `LOKI_USER`, `LOKI_PASS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`; contador `SKIP` no rodapé.

- [ ] **Step 1: Atualizar o cabeçalho de uso do `smoke.sh`**

```bash
#!/usr/bin/env bash
# Smoke test ponta a ponta. Cada checagem mapeia uma secao do CHECKLIST-PRE-LIVE.md.
#
# Uso:
#   ./scripts/smoke.sh                      # localhost (precisa do docker-compose.override.yml)
#
#   API_URL=https://api.hostmaster.fagnerlopes.dev \
#   WEB_URL=https://hostmaster.fagnerlopes.dev \
#   LOKI_URL=https://loki.hostmaster.fagnerlopes.dev \
#   GRAFANA_URL=https://grafana.hostmaster.fagnerlopes.dev \
#   LOKI_USER=hermes LOKI_PASS='...' \
#   ADMIN_EMAIL='...' ADMIN_PASSWORD='...' ./scripts/smoke.sh
#
# LOKI_USER/LOKI_PASS: o Loki esta atras de basic-auth no Traefik. Sem eles as
#   secoes 6 a 9 respondem 401 e a talk "cai" por motivo errado.
# ADMIN_EMAIL/ADMIN_PASSWORD: sem eles as checagens de login sao PULADAS.
# PROMTAIL_URL: nao ha mais dominio para o Promtail. Deixe em branco.
#
# O criterio de sucesso desta demo NAO e "o app funciona". E: as queries LogQL
# do AGENTE.md retornam dados. Por isso as checagens do Loki sao as criticas.
```

- [ ] **Step 2: Declarar as variáveis novas**

Logo abaixo das existentes:

```bash
PROMTAIL_URL="${PROMTAIL_URL:-}"
LOKI_USER="${LOKI_USER:-}"
LOKI_PASS="${LOKI_PASS:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
```

> `PROMTAIL_URL` passa a ter default **vazio**, não `http://localhost:9080`. Sem domínio e sem porta publicada, o valor antigo só produziria falso negativo.

- [ ] **Step 3: Passar `-u` em toda chamada ao Loki**

Acrescente, logo antes de `loki_query()`:

```bash
# O Loki esta atras de basic-auth no Traefik. Array vazio quando nao ha
# credencial (uso local), para o -u nao virar argumento solto.
loki_auth=()
if [ -n "$LOKI_USER" ]; then
  loki_auth=(-u "${LOKI_USER}:${LOKI_PASS}")
fi
```

Nos `curl`, expanda com `${loki_auth[@]+"${loki_auth[@]}"}` e não com `"${loki_auth[@]}"`:
com `set -u`, a segunda forma quebra em array vazio no bash < 4.4, e não dá para
assumir paridade de versão entre o laptop e a VPS. `loki_query()` fica:

```bash
loki_query() {
  curl -sG ${loki_auth[@]+"${loki_auth[@]}"} "${LOKI_URL}/loki/api/v1/query_range" \
    --data-urlencode "query=$1" \
    --data-urlencode "limit=${2:-100}" \
    --data-urlencode "start=$(date -u -d '15 minutes ago' +%s)000000000" \
    --data-urlencode "end=$(date -u +%s)000000000"
}
```

E os outros dois pontos que falam com o Loki:

```bash
labels=$(curl -s ${loki_auth[@]+"${loki_auth[@]}"} "${LOKI_URL}/loki/api/v1/label/job/values" | jq -r '.data[]?' | tr '\n' ' ')
```

```bash
series=$(curl -sG ${loki_auth[@]+"${loki_auth[@]}"} "${LOKI_URL}/loki/api/v1/query_range" \
  --data-urlencode 'query=count_over_time({job="api"} | json | endpoint="/v2/checkout" | level="error" [1m])' \
  ...
```

- [ ] **Step 4: Acrescentar a checagem de que o Loki está mesmo fechado**

Na seção 6, logo depois da checagem de labels:

```bash
if [ -n "$LOKI_USER" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "${LOKI_URL}/ready")
  [ "$code" = "401" ] && ok "Loki sem credencial = 401 (basic-auth ativo)" \
    || bad "Loki sem credencial = $code — esperado 401; a porta esta ABERTA"

  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${LOKI_URL}/loki/api/v1/push" \
    -H 'content-type: application/json' \
    -d "{\"streams\":[{\"stream\":{\"job\":\"smoke-push-test\"},\"values\":[[\"$(date +%s)000000000\",\"deve ser barrado\"]]}]}")
  [ "$code" = "401" ] && ok "push anonimo no Loki = 401" \
    || bad "push anonimo no Loki = $code — QUALQUER UM PODE ENVENENAR OS LOGS"
else
  skip "basic-auth do Loki — LOKI_USER nao definido"
fi
```

- [ ] **Step 5: Substituir a seção 10 e acrescentar a 11**

A seção 10 atual procura `HOSTMASTER` em `WEB_URL`. Substitua-a por:

```bash
head_ "10. Loja publica e noindex"
body=$(curl -s "${WEB_URL}/")
echo "$body" | grep -q 'HOSTMASTER' && ok "loja responde e contem HOSTMASTER" || bad "loja sem HOSTMASTER"
echo "$body" | grep -q 'Comprar'    && ok "loja tem botao Comprar"           || bad "loja sem botao Comprar"
echo "$body" | grep -q 'Logs recentes' \
  && bad "a loja esta mostrando 'Logs recentes' — isso e do painel" \
  || ok "loja NAO mostra logs (visao do cliente)"

robots=$(curl -s "${WEB_URL}/robots.txt")
echo "$robots" | grep -q 'Disallow: /' && ok "robots.txt com Disallow: /" || bad "robots.txt sem Disallow: /"

curl -sI "${WEB_URL}/" | grep -qi 'x-robots-tag: *noindex' \
  && ok "header X-Robots-Tag: noindex" || bad "sem header X-Robots-Tag"

code=$(curl -s -o /dev/null -w '%{http_code}' "${WEB_URL}/api/proxy/v2/health")
[ "$code" = "200" ] && ok "proxy do Next -> API = 200" || bad "proxy do Next -> API = $code"

code=$(curl -s -o /dev/null -w '%{http_code}' "${GRAFANA_URL}/api/health")
[ "$code" = "200" ] && ok "Grafana respondendo" || bad "Grafana = $code"

ds=$(curl -s "${GRAFANA_URL}/api/datasources" | jq -r '.[0].type' 2>/dev/null)
[ "$ds" = "loki" ] && ok "datasource Loki provisionado" || bad "datasource Loki ausente (got: ${ds:-nada})"

head_ "11. Autenticacao do painel"
code=$(curl -s -o /dev/null -w '%{http_code}' "${WEB_URL}/login")
[ "$code" = "200" ] && ok "GET /login = 200" || bad "GET /login = $code"

redirect=$(curl -s -o /dev/null -w '%{redirect_url}' "${WEB_URL}/dashboard")
case "$redirect" in
  */login*) ok "/dashboard sem cookie redireciona para /login" ;;
  *)        bad "/dashboard sem cookie foi para '${redirect:-lugar nenhum}' — O PAINEL ESTA ABERTO" ;;
esac

if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  cookie_jar=$(mktemp)

  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${WEB_URL}/api/auth/login" \
    -H 'content-type: application/json' \
    -d "$(jq -nc --arg e "$ADMIN_EMAIL" '{email:$e,password:"senha-propositalmente-errada"}')")
  [ "$code" = "401" ] && ok "login com senha errada = 401" || bad "login com senha errada = $code"

  code=$(curl -s -c "$cookie_jar" -o /dev/null -w '%{http_code}' -X POST "${WEB_URL}/api/auth/login" \
    -H 'content-type: application/json' \
    -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')")
  [ "$code" = "200" ] && ok "login correto = 200" || bad "login correto = $code"

  grep -q 'hostmaster_session' "$cookie_jar" \
    && ok "cookie de sessao devolvido" || bad "login nao devolveu cookie de sessao"

  dash=$(curl -s -b "$cookie_jar" -w '\n%{http_code}' "${WEB_URL}/dashboard")
  code=$(echo "$dash" | tail -1)
  [ "$code" = "200" ] && ok "/dashboard com cookie = 200" || bad "/dashboard com cookie = $code"
  echo "$dash" | grep -q 'Logs recentes' \
    && ok "/dashboard contem 'Logs recentes'" || bad "/dashboard sem 'Logs recentes'"

  rm -f "$cookie_jar"
else
  skip "login — ADMIN_EMAIL/ADMIN_PASSWORD nao definidos"
fi

head_ "12. A API continua ABERTA (restricao inviolavel)"
code=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/v2/health")
[ "$code" = "200" ] && ok "GET /v2/health sem credencial = 200" \
  || bad "GET /v2/health = $code — a auth vazou para a API e a demo morre"
```

- [ ] **Step 6: Rodar contra produção**

```bash
API_URL=https://api.hostmaster.fagnerlopes.dev \
WEB_URL=https://hostmaster.fagnerlopes.dev \
LOKI_URL=https://loki.hostmaster.fagnerlopes.dev \
GRAFANA_URL=https://grafana.hostmaster.fagnerlopes.dev \
LOKI_USER=hermes LOKI_PASS="$LOKI_PASS_PLAIN" \
ADMIN_EMAIL=fagner@hostmaster.local ADMIN_PASSWORD="$ADMIN_PASS_PLAIN" \
./scripts/smoke.sh
```

Esperado: `0 falharam` e `1 pulados` (o Promtail). Anote o número de "passaram" — vai para os docs no Step 8.

- [ ] **Step 7: Atualizar o `CLAUDE.md`**

O [CLAUDE.md](../../../CLAUDE.md) já teve as linhas `- Autenticação real` (em "Não precisa de") e `- ❌ Autenticação complexa` removidas. Falta o registro **positivo** — senão a próxima sessão relê o arquivo, não vê auth em lugar nenhum e conclui que ela é escopo indevido.

Acrescente uma seção depois de "**Frontend (Next.js)**":

```markdown
## **Rotas e autenticação**

| Rota | Acesso | Conteúdo |
|---|---|---|
| `/` | pública | Loja HOSTMASTER — produtos e botão "Comprar" |
| `/login` | pública | e-mail + senha |
| `/dashboard` | protegida | stats, logs recentes, controles de demo |
| `/dashboard/usuarios` | protegida | listar, criar e remover admins |

**O painel tem autenticação de sessão real.** Isso **sobrescreve deliberadamente** a
linha original deste arquivo que dizia "Não precisa de: Autenticação real". A decisão
foi tomada depois do deploy, quando a exposição da stack na internet ficou visível — o
Loki aceitava push anônimo e a 5432 respondia com credenciais que estão neste
repositório público. O design completo está em
[docs/superpowers/specs/2026-08-15-auth-e-dominio-design.md](docs/superpowers/specs/2026-08-15-auth-e-dominio-design.md).

**Não remova a autenticação achando que é escopo indevido.** Ela é o escopo.

Restrições que continuam valendo:

- A **API e o Loki não autenticam para o Hermes**. A auth é assunto exclusivo do app
  Next. O basic-auth do Loki é a única exceção, e vive no Traefik, não na aplicação.
- A barreira é `app/dashboard/layout.tsx` (`requireSession()`), não o `middleware.ts` —
  o middleware roda no Edge, não alcança o Prisma e faz só o atalho barato.
- Hash com `scrypt` do `node:crypto`. Nada de bcrypt/argon2: exigem compilação nativa
  e o build roda numa VPS pequena.
```

E na seção "**Docker Compose**", substitua o bloco YAML de exemplo por um aviso, já que o compose real divergiu bastante:

```markdown
**Nenhum serviço publica porta no host.** Todo acesso externo entra pelo Traefik do
Coolify nos domínios `*.hostmaster.fagnerlopes.dev`. Ver [DEPLOY.md](DEPLOY.md).
Para desenvolver localmente, use o `docker-compose.override.yml` (gitignored).

`loki`, `promtail` e `grafana` usam `build:` com Dockerfiles em `monitoring/` em vez
de `image:` + bind mount — o Coolify reescreve binds relativos e o container morre.
Não volte para bind mount.
```

- [ ] **Step 8: Varredura de URLs nos demais documentos**

```bash
grep -rn 'vps70013.publiccloud.com.br:3[0-9][0-9][0-9]\|vps70013.publiccloud.com.br:5432\|vps70013.publiccloud.com.br:9080' \
  --include='*.md' . | grep -v docs/superpowers/
```

Toda ocorrência precisa virar o domínio equivalente:

| Antes | Depois |
|---|---|
| `http://vps70013.publiccloud.com.br:3000` | `https://hostmaster.fagnerlopes.dev` |
| `http://vps70013.publiccloud.com.br:3001` | `https://api.hostmaster.fagnerlopes.dev` |
| `http://vps70013.publiccloud.com.br:3100` | `https://loki.hostmaster.fagnerlopes.dev` (com `-u`) |
| `http://vps70013.publiccloud.com.br:3300` | `https://grafana.hostmaster.fagnerlopes.dev` |
| `http://vps70013.publiccloud.com.br:9080` | sem equivalente externo — trocar pela checagem via `docker compose exec` |

Além disso, em cada arquivo:

**[RUNBOOK-LIVE.md](../../../RUNBOOK-LIVE.md)** — a tabela "Setup de tela" ganha a **Loja** (`https://hostmaster.fagnerlopes.dev`) como aba 1, porque é ela que aparece no Ato 1. Acrescente ao Ato 2 o aviso: *"não abra o `<details>` de Controles de demo com a tela compartilhada — ele conta para a plateia que a falha é encenada"*. E na seção "Se o Hermes não achar nada no Loki", o primeiro comando (`/ready` do Promtail) vira `docker compose exec promtail wget -qO- localhost:9080/ready`, executado na VPS.

**[CHECKLIST-PRE-LIVE.md](../../../CHECKLIST-PRE-LIVE.md)** — a seção "Frontend" descreve hoje uma tela só. Reescreva para:

```markdown
## Frontend

- [ ] `https://hostmaster.fagnerlopes.dev` carrega a **loja**
- [ ] Sidebar com Loja, Painel e Usuários (links reais) + itens decorativos
- [ ] 5 cards de produto com botão "Comprar [Nome]"
- [ ] A loja **não** mostra stats, logs nem controles
- [ ] Clique em "Comprar":
  - [ ] 200 → toast verde com o `orderId`
  - [ ] 500 → toast vermelho "Não foi possível concluir o pagamento" + **código de referência**
  - [ ] O `reason` técnico **não** aparece na loja — é o que o Hermes vai descobrir
- [ ] `https://hostmaster.fagnerlopes.dev/dashboard` sem cookie redireciona para `/login`
- [ ] Login com o admin funciona e o painel abre
- [ ] O painel tem stats, "Logs recentes" e o `<details>` **fechado** de Controles de demo
- [ ] `/dashboard/usuarios` lista os admins
- [ ] Clicar no chip do `correlationId` copia o valor
```

E a seção "Dados" — os `docker compose exec postgres psql` só rodam **na VPS** agora, já que a 5432 está fechada. Anote isso.

**[README.md](../../../README.md)** — atualize as URLs e acrescente `npm test` à lista de comandos.

**[postman/README.md](../../../postman/README.md)** — o parágrafo "Nada aqui autentica na API" precisa refletir que o basic-auth do Loki **já entrou**: troque "Quando o basic-auth do Loki entrar, basta preencher..." por "Preencha `loki_user` e `loki_pass` no Environment de produção — a pasta 4 e o `/ready` da pasta 5 já usam os dois."

- [ ] **Step 9: Trocar a contagem fixa de checagens**

O número `23` aparece em vários lugares e agora mudou. Como ele vai continuar mudando, troque por uma afirmação estável:

```bash
grep -rn '23/23\|23 checagens\|23 passaram' --include='*.md' . | grep -v docs/superpowers/
```

Substitua cada uma por "sem falhas" / "`0 falharam`". No `CHECKLIST-PRE-LIVE.md`, `./scripts/smoke.sh # 23 checagens; sai != 0 se algo falhar` vira:

```bash
./scripts/smoke.sh          # sai != 0 se algo falhar; "pulados" nao sao falha
```

- [ ] **Step 10: Rodar tudo uma última vez**

```bash
npm test

API_URL=https://api.hostmaster.fagnerlopes.dev \
WEB_URL=https://hostmaster.fagnerlopes.dev \
LOKI_URL=https://loki.hostmaster.fagnerlopes.dev \
GRAFANA_URL=https://grafana.hostmaster.fagnerlopes.dev \
LOKI_USER=hermes LOKI_PASS="$LOKI_PASS_PLAIN" \
ADMIN_EMAIL=fagner@hostmaster.local ADMIN_PASSWORD="$ADMIN_PASS_PLAIN" \
./scripts/smoke.sh

npx newman@6 run postman/HOSTMASTER-TDC.postman_collection.json \
  -e postman/HOSTMASTER-vps-tls.postman_environment.json \
  --env-var "loki_pass=$LOKI_PASS_PLAIN"

API_URL=https://api.hostmaster.fagnerlopes.dev ./scripts/reset-demo.sh
```

Esperado: testes passando, smoke com `0 falharam`, newman com `0 falhas`, baseline restaurado.

- [ ] **Step 11: Confirmar que nenhum segredo entrou no repositório**

```bash
git log --all -p -- . | grep -inE 'apr1\$|ADMIN_PASSWORD=[^ ]|LOKI_BASIC_AUTH=[^ ]|LOKI_PASS=[^"$]' | head
grep -rniE 'apr1\$' --include='*.yml' --include='*.yaml' --include='*.md' --include='*.json' . | grep -v docs/superpowers/
```

Esperado: nada. Se aparecer alguma coisa, **pare** — o repositório é público e a credencial precisa ser rotacionada, não só removida.

- [ ] **Step 12: Commit final**

```bash
git add -A
git status --short   # docker-compose.override.yml NAO pode aparecer
git commit -m "test(smoke): auth, noindex e loki fechado; docs alinhadas aos dominios"
git push
```

---

## Verificação final — antes da talk

```bash
# 1. as seis portas fechadas
for p in 3000 3001 3100 3300 9080 5432; do
  printf '%-6s ' "$p"; timeout 5 bash -c "</dev/tcp/177.153.35.27/$p" 2>/dev/null && echo ABERTA || echo fechada
done

# 2. push anonimo no Loki barrado
curl -s -o /dev/null -w 'push anonimo -> %{http_code} (esperado 401)\n' \
  -X POST https://loki.hostmaster.fagnerlopes.dev/loki/api/v1/push \
  -H 'content-type: application/json' \
  -d '{"streams":[{"stream":{"job":"x"},"values":[["1","y"]]}]}'

# 3. ninguem escreveu de fora
curl -sG -u "hermes:$LOKI_PASS_PLAIN" \
  https://loki.hostmaster.fagnerlopes.dev/loki/api/v1/label/job/values | jq -c '.data'
# esperado exatamente: ["api","teste-de-exposicao"]

# 4. o painel esta protegido e a API nao
curl -s -o /dev/null -w '/dashboard -> %{http_code} -> %{redirect_url}\n' https://hostmaster.fagnerlopes.dev/dashboard
curl -s -o /dev/null -w '/v2/health -> %{http_code} (tem que ser 200)\n' https://api.hostmaster.fagnerlopes.dev/v2/health

# 5. baseline
API_URL=https://api.hostmaster.fagnerlopes.dev ./scripts/reset-demo.sh
```

## Ações fora do código (do humano)

1. ✅ Criar os quatro registros A na Vercel apontando para `177.153.35.27` — **já feito**
2. Guardar no gerenciador de senhas: credencial do Loki (`hermes` + senha) e do primeiro admin
3. Passar `LOKI_USER` e `LOKI_PASS` ao Hermes por variável de ambiente — **nunca** pelo `AGENTE.md`
4. Preencher `loki_pass` no Postman localmente (não commitar o environment com a senha)
