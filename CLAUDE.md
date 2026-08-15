# **Diretrizes para Claude Code — TDC Demo: E-commerce + Hermes**

## **Contexto**

Demo ao vivo (20 min, segunda 19h) onde Hermes Agent investiga erros em produção via **observabilidade agnóstica** (Loki). O código deve ser realista, limpo, e servir de palco para demonstrar:

1. **Falhas aleatórias** — Dev clica em "Comprar", sistema falha 50% das vezes
2. **Descoberta via logs** — Hermes consulta Loki, descobre o erro
3. **Monitoramento autônomo** — Hermes cria cron job para alertar em tempo real via Telegram

## **Arquitetura**

```
Monorepo (NPM Workspaces)
├── apps/web           (Next.js: Dashboard Admin HOSTMASTER)
├── apps/api           (Fastify: Endpoints /v1 e /v2)
└── packages/database  (Prisma: ORM + Seed)

Docker Compose Stack (nenhuma porta publicada — tudo pelo Traefik do Coolify)
├── PostgreSQL (volume persistente)
├── API      → api.hostmaster.fagnerlopes.dev       (logs JSON → arquivo + stdout)
├── Web      → hostmaster.fagnerlopes.dev           (loja em /, painel em /dashboard)
├── Promtail (coleta logs; sem dominio, nada externo precisa)
├── Loki     (API REST para o Hermes; sem dominio proprio)
├── Loki-auth→ loki.hostmaster.fagnerlopes.dev      (basic-auth na frente do Loki)
└── Grafana  → grafana.hostmaster.fagnerlopes.dev
```

## **Endpoints (OBRIGATÓRIOS)**

### **Padrão /v1 (Teste Prévio)**

- `GET /v1/health` → Status (200 ou 500 conforme estado em memória)
- `GET /v1/status` → Métricas (uptime, checkouts, failures)
- `POST /v1/checkout` → Compra (falha 50%, loga erro estruturado)
- `POST /v1/simulate-crash` → Muda estado

### **Padrão /v2 (Live)**

Mesma coisa que /v1, mas isolada para teste não interferir na live.

## **Logs Estruturados**

**Ferramenta:** Pino (JSON)  
**Saída:** stdout (Promtail coleta, Loki armazena)  
**Campos obrigatórios:**

```json
{
  "level": "error|info|warn",
  "timestamp": "ISO8601",
  "correlationId": "req-abc-123",
  "service": "checkout-api",
  "endpoint": "/v2/checkout",
  "productId": "string",
  "reason": "payment_gateway_timeout|payment_processing_failed|...",
  "message": "string"
}
```

**Quando fazer log:**

- ✅ Início de transação (info)
- ✅ Falha (error + stack trace)
- ✅ Sucesso (info + orderId)
- ❌ NÃO fazer webhook/Telegram aqui — é responsabilidade do Hermes

## **Frontend (Next.js)**

**Dashboard Admin HOSTMASTER:**

- Menu sidebar fake com navegação (Home, Produtos, Pedidos, Analytics, Settings)
- Seção principal: Lista de produtos com botão "Comprar [Nome]"
- Clique = POST /v2/checkout → simulação de falha 50/50
- Painel lateral: "Logs Recentes" (últimas 10 ações, atualiza em tempo real)
- Design simples mas profissional (Tailwind CSS)

**Não precisa de:**

- Checkout real (só simula)
- Integração com métodos de pagamento

## **Rotas e autenticação**

| Rota | Acesso | Conteúdo |
|---|---|---|
| `/` | pública | Loja HOSTMASTER — produtos e botão "Comprar" |
| `/login` | pública | e-mail + senha |
| `/dashboard` | protegida | stats, logs recentes, controles de demo |
| `/dashboard/usuarios` | protegida | listar, criar e remover admins |

**O painel tem autenticação de sessão real.** Isso **sobrescreve deliberadamente** a
linha original deste arquivo que dizia "Não precisa de: Autenticação real" e o item
"Autenticação complexa" da lista do que não fazer. A decisão foi tomada **depois** do
deploy, quando a exposição real ficou visível: o Loki aceitava `push` anônimo (HTTP
204 confirmado) e a 5432 respondia com `dev_user`/`dev123`, credenciais que estão
neste repositório público. O design completo está em
[docs/superpowers/specs/2026-08-15-auth-e-dominio-design.md](docs/superpowers/specs/2026-08-15-auth-e-dominio-design.md).

**Não remova a autenticação achando que é escopo indevido. Ela é o escopo.**

Restrições que continuam valendo, e que a auth não pode violar:

- **A API não autentica.** `/vN/*` fica aberto para o Hermes — é o que mantém a
  observabilidade agnóstica. Se a auth encostar nesses endpoints, a demo morre.
- **O Loki autentica**, mas por um proxy (`loki-auth`), não na aplicação. O Loki
  continua com `auth_enabled: false`; o Hermes só precisa de `curl -u`.
- **A barreira é `app/dashboard/layout.tsx`** (`requireSession()`), **não** o
  `middleware.ts` — o middleware roda no Edge, não alcança o Prisma e faz só o
  atalho barato de cookie ausente. Um cookie forjado passa por ele.
- **Hash com `scrypt` do `node:crypto`.** Nada de bcrypt/argon2: exigem compilação
  nativa e o build roda numa VPS pequena.

## **Dados (Seed)**

**Script:** `packages/database/seed.ts`  
**Dados fictícios (Gaming/Informática):**

**Produtos:**

```json
[
  { "id": "MONITOR-240HZ", "name": "Monitor 240Hz IPS", "price": 1299.0 },
  { "id": "RTX-4060", "name": "Placa de Vídeo RTX 4060", "price": 1899.0 },
  { "id": "HEADSET-GAMER", "name": "Headset Gamer Wireless", "price": 449.0 },
  { "id": "TECLADO-RGB", "name": "Teclado Mecânico RGB", "price": 599.0 },
  { "id": "MOUSEPAD-XL", "name": "Mousepad Extra Grande", "price": 149.0 }
]
```

**Usuários:**

- gamer-pro@example.com
- tech-enthusiast@test.com

**Executar com:** `npm run seed` após `docker-compose up`  
**Nenhuma informação KingHost/Locaweb**

## **Docker Compose**

**Arquivo:** `docker-compose.yml` (raiz do monorepo)

Sete serviços: `postgres`, `api`, `web`, `loki`, `loki-auth`, `promtail`, `grafana`.

**Nenhum serviço publica porta no host.** Todo acesso externo entra pelo Traefik do
Coolify nos domínios `*.hostmaster.fagnerlopes.dev`. Ver [DEPLOY.md](DEPLOY.md).
Para desenvolver localmente, use o `docker-compose.override.yml` (gitignored), que
reintroduz as portas.

Duas coisas que **não** devem ser desfeitas:

- `loki`, `promtail`, `grafana` e `loki-auth` usam `build:` com Dockerfiles em
  `monitoring/`, levando o config dentro da imagem. O Coolify reescreve bind mounts
  relativos e o container morre com "not a directory". **Não volte para `image:` +
  bind mount.**
- Não tente fechar porta com `ufw`: o Docker insere regra de DNAT na chain `DOCKER`,
  avaliada antes do `ufw`. Fechar de verdade é não ter `ports:`.

## **Checklist de Implementação**

- [x] Monorepo + workspaces
- [x] Fastify API com Pino (logs JSON)
- [x] Endpoints /v1 e /v2 completos
- [x] POST /checkout com falha 50%, loga erro estruturado
- [x] Next.js com dashboard HOSTMASTER
- [x] Botão "Comprar [Produto]" funcional
- [x] Painel "Logs Recentes"
- [x] Prisma + seed de dados fictícios
- [x] Docker-compose completo (Postgres, API, Web, Promtail, Loki)
- [x] Testes manuais (endpoints, logs chegando no Loki)
- [x] AGENTE.md criado
- [x] Pronto para deploy no Coolify (segunda 18h)
- [x] Domínios com TLS, portas cruas fechadas, basic-auth no Loki
- [x] Split loja/painel, controles de demo, noindex
- [x] Autenticação de sessão no painel + gestão de admins
- [x] `npm test` (vitest) cobrindo hash e sessão

## **Importante: O Que NÃO Fazer**

- ❌ Alertas/webhooks no código (é do Hermes)
- ❌ Cron jobs hardcoded (Hermes cria dinamicamente)
- ❌ Dados sensíveis (tudo fake/fictício)
- ❌ Lógica de negócio pesada (simples + realista)
