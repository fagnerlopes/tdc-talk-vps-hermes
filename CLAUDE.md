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

Docker Compose Stack
├── PostgreSQL (volume persistente)
├── API (port 3001, logs JSON → stdout)
├── Web (port 3000)
├── Promtail (coleta logs)
└── Loki (port 3100, API REST para Hermes)
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
- Autenticação real
- Checkout real (só simula)
- Integração com métodos de pagamento

## **Dados (Seed)**

**Script:** `packages/database/seed.ts`  
**Dados fictícios (Gaming/Informática):**

**Produtos:**
```json
[
  { id: "MONITOR-240HZ", name: "Monitor 240Hz IPS", price: 1299.00 },
  { id: "RTX-4060", name: "Placa de Vídeo RTX 4060", price: 1899.00 },
  { id: "HEADSET-GAMER", name: "Headset Gamer Wireless", price: 449.00 },
  { id: "TECLADO-RGB", name: "Teclado Mecânico RGB", price: 599.00 },
  { id: "MOUSEPAD-XL", name: "Mousepad Extra Grande", price: 149.00 }
]
```

**Usuários:**
- gamer-pro@example.com
- tech-enthusiast@test.com

**Executar com:** `npm run seed` após `docker-compose up`  
**Nenhuma informação KingHost/Locaweb**

## **Docker Compose**

**Arquivo:** `docker-compose.yml` (raiz do monorepo)  
**Serviços:**
```yaml
services:
  postgres:
    image: postgres:16
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: dev123
      POSTGRES_USER: dev_user
      POSTGRES_DB: hermes_demo

  api:
    build: ./apps/api
    ports:
      - "3001:3001"
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://dev_user:dev123@postgres:5432/hermes_demo
      LOG_LEVEL: info

  web:
    build: ./apps/web
    ports:
      - "3000:3000"
    depends_on:
      - api

  promtail:
    image: grafana/promtail:latest
    volumes:
      - ./monitoring/promtail-config.yaml:/etc/promtail/config.yml
    command: -config.file=/etc/promtail/config.yml

  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"
    volumes:
      - ./monitoring/loki-config.yaml:/etc/loki/local-config.yaml
    command: -config.file=/etc/loki/local-config.yaml

volumes:
  postgres_data:
```

## **Checklist de Implementação**

- [ ] Monorepo + workspaces
- [ ] Fastify API com Pino (logs JSON)
- [ ] Endpoints /v1 e /v2 completos
- [ ] POST /checkout com falha 50%, loga erro estruturado
- [ ] Next.js com dashboard HOSTMASTER
- [ ] Botão "Comprar [Produto]" funcional
- [ ] Painel "Logs Recentes"
- [ ] Prisma + seed de dados fictícios
- [ ] Docker-compose completo (Postgres, API, Web, Promtail, Loki)
- [ ] Testes manuais (endpoints, logs chegando no Loki)
- [ ] AGENTE.md criado
- [ ] Pronto para deploy no Coolify (segunda 18h)

## **Importante: O Que NÃO Fazer**

- ❌ Alertas/webhooks no código (é do Hermes)
- ❌ Cron jobs hardcoded (Hermes cria dinamicamente)
- ❌ Dados sensíveis (tudo fake/fictício)
- ❌ Autenticação complexa (foco na demo, não em segurança)
- ❌ Lógica de negócio pesada (simples + realista)

