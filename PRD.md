# **Product Requirements Document (PRD) \- TDC Demo: Freelancer/Indie Dev**

## **1\. Visão Geral**

A aplicação simula um E-commerce realista, focado na realidade de freelancers, devs independentes ou agências. O objetivo é demonstrar como o Hermes Agent atua resolvendo problemas clássicos de produção direto do celular via Telegram, com foco em:
- **Observabilidade Agnóstica**: Hermes monitora erros via Loki, não via alertas hardcoded no código
- **Reatividade**: Dev clica em "Comprar", sistema falha aleatoriamente, Hermes descobre via logs
- **Proatividade**: Hermes cria cron jobs de monitoramento sob demanda via Telegram

## **2\. Cronograma e Palco da Demonstração**

**Tempo Total:** 20 minutos (live segunda às 19h)  
**Infraestrutura:** Uma VPS com Coolify rodando docker-compose completo

### **Ato 1 (A Falha Manual - T+5min)**
- Dev compartilha tela mostrando o dashboard admin (HOSTMASTER)
- Clica em "Comprar Produto" algumas vezes
- Um dos cliques retorna HTTP 500 (falha aleatória 50/50)
- Log estruturado chega em Loki
- Telegram silencioso (sem alerta automático)

### **Ato 2 (A Descoberta - T+8min)**
- Dev envia áudio/comando via Telegram: *"Hermes, procure erros 500 no checkout"*
- Hermes consulta Loki API → encontra o erro com contexto (timestamp, produto, stack)
- Hermes avisa Telegram: ❌ *"1 erro 500 detectado em /checkout às 19:08"*
- Dev pede detalhes: *"Qual é a causa?"*
- Hermes analisa logs estruturados → diagnostica

### **Ato 3 (O Monitoramento Autônomo - T+15min)**
- Dev pede: *"Crie um cron para monitorar erros 500"*
- Hermes cria cron job internamente → a cada 60 segundos
- Cron consulta Loki → busca erros recentes
- Se encontra erro → avisa Telegram automaticamente
- Dev simula novo erro (clica "Comprar" novamente)
- Hermes descobre via monitoramento → avisa

## **3\. Visão Arquitetural**

```
┌─────────────────────────────────────────────────────┐
│                 VPS Única (Coolify)                  │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │         Docker Compose Stack                   │  │
│  ├───────────────────────────────────────────────┤  │
│  │ • Frontend Next.js (port 3000)                │  │
│  │ • API Node.js (port 3001)                     │  │
│  │ • PostgreSQL (port 5432)                      │  │
│  │ • Promtail (coleta logs JSON)                 │  │
│  │ • Loki (armazena logs, API REST port 3100)   │  │
│  └───────────────────────────────────────────────┘  │
│                         ↑                             │
│                         │ Logs JSON                  │
│                       Stdout                         │
│                                                       │
└─────────────────────────────────────────────────────┘
         ↑
         │ HTTP/REST
         │
    Hermes Agent ← Monitora via Loki API
         ↑
         │ Telegram
         │
       Dev (Celular/Web)
```

## **4\. Stack Tecnológica (Monorepo)**

* **Gerenciador:** NPM Workspaces  
* **Frontend (apps/web):** Next.js (App Router) + Tailwind CSS  
  - Dashboard admin HOSTMASTER com menu sidebar e links fake  
  - Botão "Comprar [Produto]" que simula checkout com falha aleatória  
  - Seção de logs recentes (últimas 10 ações do sistema)  
* **Backend (apps/api):** Node.js (Fastify) + TypeScript  
  - Logs estruturados em JSON via Pino  
  - Correlation IDs em toda transação  
  - Endpoints `/v1/...` (teste prévio) e `/v2/...` (live ao vivo)  
* **Banco de Dados:** PostgreSQL (conteinerizado, volume nomeado)  
* **ORM:** Prisma (schemas, migrações, seed)  
* **Observabilidade:** 
  - Pino (logging JSON estruturado)  
  - Promtail (coleta logs do stdout)  
  - Grafana Loki (armazena + API REST para Hermes consultar)  
  - OpenTelemetry (traces distribuídos, opcional)  
* **Infra:** Docker Compose (tudo em uma VPS via Coolify)

## **5\. Endpoints Estratégicos (Backend)**

Dois conjuntos isolados: `/v1/...` para teste prévio (segunda 18h) e `/v2/...` para a live (segunda 19h).

### **Conjunto 1: /v1 (Teste Prévio)**

| Endpoint | Método | Descrição | Resposta |
|----------|--------|-----------|----------|
| `/v1/health` | GET | Status da API (estado em memória) | `{"status": "ok"}` (200) ou `{"error": "crashed"}` (500) |
| `/v1/status` | GET | Métricas do sistema | `{"uptime": 3600, "checkouts": 42, "failures": 3}` |
| `/v1/checkout` | POST | Comprar produto (falha 50% dos casos) | `{"orderId": "ORD-123"}` (200) ou erro (500) |
| `/v1/simulate-crash` | POST | Simular queda (muda estado) | `{"crashed": true}` |

### **Conjunto 2: /v2 (Live Ao Vivo)**

Mesma estrutura que /v1, mas isolada para a live não interferir no teste prévio.

### **Detalhes de Implementação**

#### **POST /v1/checkout e /v2/checkout**
```javascript
// Comportamento esperado:
1. Recebe { productId, userId } no body
2. Loga início da transação (com correlationId)
3. 50% de chance: falha condicional
   - Loga erro estruturado: { correlationId, productId, reason, stack }
   - Retorna HTTP 500
4. 50% de chance: sucesso
   - Salva no banco via Prisma
   - Loga sucesso
   - Retorna HTTP 200 com orderId
```

#### **Logs Estruturados (JSON via Pino)**
```json
{
  "level": "error",
  "timestamp": "2026-08-15T19:08:23.456Z",
  "correlationId": "req-abc-123",
  "service": "checkout-api",
  "endpoint": "/v2/checkout",
  "productId": "PROMO-001",
  "reason": "payment_gateway_timeout",
  "stack": "Error: ...",
  "message": "Falha ao processar pagamento"
}
```

## **6\. Infraestrutura e Persistência**

- **PostgreSQL:** Volume nomeado `postgres_data:/var/lib/postgresql/data` (persiste entre restarts)
- **Seed de Dados:** Script `packages/database/seed.ts` com dados fictícios (produtos, usuários)
- **Logs:** API imprime JSON no stdout → Promtail coleta → Loki armazena
- **API Loki:** Exposta em `http://localhost:3100` para Hermes consultar
- **Docker Compose:** Expõe todas as portas (3000, 3001, 5432, 3100, etc)

## **7\. Dados de Teste**

Todos os dados são **fictícios e não-sensíveis**:

### **Produtos (Gaming/Informática)**
- "Monitor 240Hz IPS" (R$ 1.299,00)
- "Placa de Vídeo RTX 4060" (R$ 1.899,00)
- "Headset Gamer Wireless" (R$ 449,00)
- "Teclado Mecânico RGB" (R$ 599,00)
- "Mousepad Extra Grande" (R$ 149,00)

### **Usuários**
- gamer-pro@example.com
- tech-enthusiast@test.com

### **Dados Sensíveis**
- **Nenhuma informação KingHost/Locaweb deve aparecer**
- CPF, email real, dados bancários: TUDO fictício

## **8\. Escopo de Desenvolvimento (Claude Code)**

**Incluso:**
- Monorepo completo (apps/web, apps/api, packages/database)
- Endpoints /v1 e /v2 com falhas condicionais
- Dashboard admin HOSTMASTER
- Logs estruturados via Pino
- Docker-compose com stack completo (Postgres, Promtail, Loki)
- Seed de dados
- AGENTE.md com instruções para Hermes

**Não incluso (Responsabilidade do Hermes Agent):**
- Cron jobs de monitoramento
- Queries no Loki
- Avisos no Telegram
- Investigação de causas de erro
- Esses artefatos são **gerados dinamicamente** durante a live via Telegram

## **9\. Checklist Pré-Live (Segunda 18h)**

- [ ] Deploy no Coolify
- [ ] Seed do banco (`npm run seed`)
- [ ] Teste GET /v2/health (deve retornar 200)
- [ ] Teste POST /v2/checkout com produto valido (deve retornar 200)
- [ ] Verificar Loki recebendo logs (`curl http://localhost:3100/loki/api/v1/query_range`)
- [ ] Testar Hermes com query simples no Loki
- [ ] Reset/cleanup para começar live limpo

