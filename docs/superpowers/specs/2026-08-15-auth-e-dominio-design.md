# Design — Separação loja/admin, autenticação e domínio próprio

**Data:** 2026-08-15 · **Status:** aguardando revisão

## Contexto

A demo está no ar em `177.153.35.27` com as seis portas do compose publicadas cruas. Três problemas motivaram esta mudança:

1. **O frontend tem uma rota só**, misturando a visão do cliente (comprar) com a do operador (stats, logs). Não há lugar óbvio para os controles de palco.
2. **Não há como gerar erro pela interface** — só por `curl`.
3. **A stack está aberta na internet.** Um `push` anônimo no Loki foi aceito (`HTTP 204`), e a 5432 responde com `dev_user`/`dev123`, credenciais que estão no repositório público.

Este design resolve os três. Ele **sobrescreve deliberadamente** o [CLAUDE.md](../../../CLAUDE.md), que diz "Não precisa de: Autenticação real" e lista "Autenticação complexa" no que não fazer. Essa decisão foi tomada depois do deploy, quando a exposição real ficou visível. O CLAUDE.md será atualizado junto, senão a próxima sessão remove a auth achando que é escopo indevido.

## Restrições invioláveis

- **A API e o Loki continuam sem autenticação para o Hermes.** A auth é assunto exclusivo do app Next. Se encostar nos endpoints `/vN/*`, a demo morre. O basic-auth do Loki é a única exceção, e é no Traefik, não na aplicação.
- **A falha forçada continua produzindo log byte-idêntico à natural.** Nenhum controle novo pode introduzir um campo `forced`.
- **`{job="api"} | json | level="error"` continua funcionando.** Toda mudança passa pelo `smoke.sh` antes de ser considerada pronta.

## 1. Rotas do frontend

| Rota | Acesso | Conteúdo |
|---|---|---|
| `/` | pública | Loja HOSTMASTER — projetada no Ato 1 |
| `/login` | pública | e-mail + senha |
| `/admin` | protegida | stats, logs recentes, controles de demo |
| `/admin/usuarios` | protegida | listar, criar e remover admins |

A loja não tem stats, logs nem controles: é o que um cliente veria. O painel não tem cards de produto: é o que o operador olha. Essa separação é o que faz o Ato 1 ("loja de cliente falhando") e o Ato 2 ("dev investigando") serem cenas distintas, como o [RUNBOOK-LIVE.md](../../../RUNBOOK-LIVE.md) já narra.

**Erro na loja é o que um cliente real veria:** "Não foi possível concluir o pagamento" mais `código de referência: req-a1b2c3d4`. Lojas de verdade mostram código de suporte, então é realista e preserva o beat de ler o id em voz alta para o Hermes. O `reason` técnico (`payment_gateway_timeout`) não aparece na loja — é o que o Hermes vai descobrir.

Na sidebar, "Loja" e "Painel" viram links reais; os demais continuam decorativos.

## 2. Controles de demo

Dentro de `/admin`, num `<details>` **fechado por padrão**, em cinza e sem destaque visual.

- `Forçar falha no próximo clique` / `Forçar sucesso`
- `Disparar checkout com falha agora`
- `Derrubar serviço` / `Restabelecer`
- Taxa de falha: `0%` · `50%` · `100%`
- `Resetar baseline`
- Alvo: `v2` / `v1`

Nenhum endpoint novo: tudo chama `POST /vN/config`, `/vN/simulate-crash` e `/vN/checkout` pelo proxy existente.

**Risco assumido:** um botão "forçar erro" visível na tela projetada conta para a plateia que a falha é encenada. Ficar recolhido por padrão reduz, não elimina. Se aparecer no telão durante o Ato 2, a premissa enfraquece.

## 3. Autenticação

### Modelo de dados

Tabela separada dos clientes da loja. O `users` atual guarda `gamer-pro@example.com` e `tech-enthusiast@test.com`, está documentado no AGENTE.md e tem FK dos `orders` — o Hermes pode consultá-lo. Credencial de admin ali poluiria a superfície de investigação.

```prisma
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
  id        String    @id  // 32 bytes aleatórios em hex — é o valor do cookie
  userId    String
  expiresAt DateTime
  createdAt DateTime  @default(now())
  user      AdminUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("sessions")
}
```

Sessão no banco em vez de JWT: dá logout de verdade e revogação imediata, sem gerenciar segredo compartilhado. O cookie carrega só um id opaco, `httpOnly`, `sameSite=lax`, `secure` (viável porque teremos TLS).

### Hash

`scrypt` do `node:crypto`, não bcrypt nem argon2 — os dois exigem compilação nativa e o build roda numa VPS pequena. `scrypt` é built-in, sem dependência nova. Salt aleatório de 16 bytes por senha, formato `salt:hash` em hex, comparação com `timingSafeEqual`.

Vive em `packages/database/src/password.ts`, sem importar Prisma, para que o seed (que roda no container da API) e o Next usem exatamente a mesma função.

### Ponto de aplicação

`app/admin/layout.tsx` chama `requireSession()`, que valida o cookie contra o banco e redireciona para `/login` se ausente, inválido ou expirado. **Este layout é a barreira** — toda rota sob `/admin/*` passa por ele.

`middleware.ts` faz só o atalho barato: cookie ausente → redireciona sem tocar no banco. **O middleware não é a barreira**, porque roda no Edge e não alcança o Prisma. Registrar isso é importante: quem mexer depois não pode assumir que ele protege.

Os route handlers `POST /api/admin/users` e `DELETE /api/admin/users/[id]` revalidam a sessão no servidor. Não confiam em a UI ter escondido o botão.

### Primeiro admin

O seed cria um `AdminUser` se não existir nenhum, lendo `ADMIN_EMAIL` e `ADMIN_PASSWORD`. Se `ADMIN_PASSWORD` não vier definida, gera 24 caracteres aleatórios e **imprime uma única vez no stdout do container** — recuperável com `docker compose logs api`, e nada vai para o repositório público.

TTL da sessão: `SESSION_TTL_HOURS`, default 12.

## 4. noindex

Aplicado ao app inteiro, não só à loja — o `/admin` também não deve ser indexado. Três camadas porque cada uma cobre um caso distinto:

- `metadata.robots = { index: false, follow: false }` no layout raiz → respostas HTML
- `app/robots.ts` gerando `Disallow: /` → crawlers que consultam robots.txt
- header `X-Robots-Tag: noindex, nofollow` em `next.config.mjs` → respostas não-HTML

## 5. Domínio e TLS

Quatro registros A em `fagnerlopes.dev` (DNS na Vercel), todos apontando para `177.153.35.27`. O apex continua servindo o site pessoal na Vercel e não é tocado.

| Subdomínio | Serviço | Porta interna |
|---|---|---|
| `hostmaster.fagnerlopes.dev` | web | 3000 |
| `api.hostmaster.fagnerlopes.dev` | api | 3001 |
| `loki.hostmaster.fagnerlopes.dev` | loki | 3100 |
| `grafana.hostmaster.fagnerlopes.dev` | grafana | 3000 |

As portas 80 e 443 já estão abertas na VPS e o Traefik do Coolify responde nelas, então o desafio HTTP-01 do Let's Encrypt funciona assim que o DNS propagar.

Com os quatro domínios de pé, **fechar no firewall**: 3000, 3001, 3100, 3300, 5432 e 9080. Isso resolve de uma vez a escrita anônima no Loki e a exposição do Postgres.

Consequência no `smoke.sh`: o Promtail não ganha domínio (nada externo precisa dele), então a checagem de `/ready` deixa de ser alcançável de fora. Ela passa a rodar por dentro — `docker compose exec promtail wget -qO- localhost:9080/ready` quando houver acesso ao host, e a ser pulada com aviso explícito quando não houver. Pular em silêncio seria pior que não checar.

### Proteção do Loki

Basic-auth no Traefik, sobre TLS. Não depende do IP de saída da VPS do Hermes (que pode mudar) e a credencial não trafega em claro. O Hermes passa a usar `curl -u "$LOKI_USER:$LOKI_PASS"`. A senha vive em env var do Coolify e **nunca** no repositório.

Dois caminhos internos que **não** passam pelo Traefik e portanto não são afetados:
- Promtail → `http://loki:3100` (push)
- Grafana → `http://loki:3100` (datasource)

Isso costuma ser fonte de confusão: o basic-auth barra só quem vem de fora.

### Risco de implementação

O Coolify gera labels do Traefik automaticamente para serviços de compose com domínio. Adicionar um middleware `basicauth` customizado junto pode conflitar. Verificar cedo; se conflitar, o fallback é a allowlist por IP no `ufw`, que já está documentada no [DEPLOY.md](../../../DEPLOY.md).

## 6. Build e deploy

O app web passa a falar com o Postgres. No `apps/web/Dockerfile`:

- `npm run build --workspace @hermes/database` antes do build do Next
- `openssl` na imagem base
- engines do Prisma copiados para o runner

E no `next.config.mjs`:

```js
outputFileTracingIncludes: { '/**': ['../../packages/database/generated/**'] }
```

Sem isso o `output: standalone` não rastreia os engines do Prisma, o container sobe e morre no primeiro login. Falha que não aparece em dev.

Variáveis novas:

| Variável | Serviço | Formato |
|---|---|---|
| `DATABASE_URL` | web | mesma string do serviço `api` |
| `ADMIN_EMAIL` | api (seed) | e-mail do primeiro admin |
| `ADMIN_PASSWORD` | api (seed) | se ausente, gera 24 chars e imprime no log |
| `SESSION_TTL_HOURS` | web | inteiro, default `12` |
| `LOKI_BASIC_AUTH` | loki (label do Traefik) | `usuario:$hash` no formato htpasswd, gerado com `htpasswd -nb`; os `$` viram `$$` no compose |

Migration nova: `admin_users` e `sessions`.

**Ordem obrigatória: TLS antes da senha definitiva.** Configurar os domínios e confirmar HTTPS primeiro; só depois criar a credencial que será usada de fato. Senha criada sobre HTTP puro deve ser considerada queimada.

## 7. Testes

`vitest` no workspace, cobrindo o que é crítico de segurança — não a UI:

- hash e verify em roundtrip
- senha errada é rejeitada
- a mesma senha gera hashes diferentes (salt aleatório)
- sessão expirada é rejeitada
- sessão inexistente é rejeitada

O `smoke.sh` ganha:

- `/` responde 200 e contém "Comprar"
- `/admin` sem cookie redireciona para `/login`
- `/login` responde 200
- login com senha errada responde 401
- login correto responde 200 e devolve cookie
- `/admin` com cookie responde 200 e contém "Logs recentes"
- `robots.txt` contém `Disallow: /`
- as queries do AGENTE.md continuam passando pela URL nova do Loki, com `-u`

## 8. Ordem de implementação

Faseada, com linha de corte explícita. Se algo estourar no domingo, o que está acima da linha já entrega valor sozinho.

1. Split loja/admin + controles de demo (sem auth)
2. noindex
3. Domínios, TLS e fechamento das portas cruas
4. Basic-auth no Loki + atualização do AGENTE.md
5. **— linha de corte para segunda —**
6. Auth: schema, hash, sessão, `/login`, proteção do `/admin`
7. `/admin/usuarios`
8. Testes e smoke ampliado

Abaixo da linha, se der problema, o fallback é basic-auth do Traefik em `hostmaster.fagnerlopes.dev/admin` — protege o painel sem tela de login, e a demo acontece do mesmo jeito.

## Riscos

| Risco | Mitigação |
|---|---|
| **Sessão falha no palco e você perde os controles de demo**, que agora moram no `/admin` | Os `curl` do RUNBOOK continuam funcionando e o `reset-demo.sh` não depende de login. O plano B não passa pela tela. |
| Engines do Prisma não rastreados no standalone → container morre no primeiro login | `outputFileTracingIncludes` explícito; validar com build limpo antes do deploy |
| Middleware do Coolify conflita com o basic-auth do Loki | Verificar cedo; fallback é a allowlist por IP no `ufw` |
| DNS não propaga a tempo | Criar os registros primeiro, antes de mexer no código |
| Escopo grande num fim de semana | Ordem faseada com linha de corte; segunda reservada para smoke test, não para depurar Prisma |
| Botão de forçar erro visível no telão enfraquece a premissa | `<details>` fechado, sem destaque visual; anotado no RUNBOOK para não abrir no Ato 2 |

## Ações fora do código

1. Criar os quatro registros A na Vercel apontando para `177.153.35.27`
2. Escolher a senha do primeiro admin (depois do TLS de pé)
3. Escolher a credencial de basic-auth do Loki
