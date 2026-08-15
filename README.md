# **TDC Demo: E-commerce + Hermes Agent**

Demo ao vivo para o TDC (The Developer's Conference) mostrando como um Agente IA (Hermes) monitora e resolve problemas em produção via **observabilidade agnóstica**.

## **O Que é Esta Demo?**

Uma aplicação de e-commerce simples (freelancers) que:
- Simula falhas aleatórias em checkouts
- Loga tudo estruturado no Loki
- Hermes Agent monitora logs e avisa no Telegram
- Demonstra observabilidade em tempo real durante a live

**Duração:** 20 minutos  
**Data:** Segunda-feira, 19h (live ao vivo)  
**Stack:** Next.js + Node.js + Postgres + Loki + Hermes Agent

## **Estrutura do Projeto**

```
.
├── apps/
│   ├── web/              # Frontend Next.js (Dashboard HOSTMASTER)
│   └── api/              # Backend Node.js + Fastify (Endpoints /v1, /v2)
├── packages/
│   └── database/         # Prisma ORM + Seed
├── monitoring/           # Config Promtail + Loki
├── docker-compose.yml    # Stack completo
├── PRD.md               # Product Requirements
├── CLAUDE.md            # Diretrizes de implementação
├── AGENTE.md            # Instruções para Hermes
└── README.md            # Este arquivo
```

## **Quick Start**

### **1. Deploy no Coolify (segunda 18h)**

```bash
# Clone este repositório
git clone <repo-url>
cd tdc-talk-vps-hermes

# Deploy via Coolify
# (Instruções específicas dependem da configuração da VPS)
```

### **2. Inicializar Stack**

```bash
# Suba os containers
docker-compose up -d

# Aguarde ~30 segundos para tudo ficar pronto

# Seed do banco
npm run seed
```

### **3. Testar Endpoints**

```bash
# Health check (deve retornar 200)
curl http://localhost:3001/v2/health

# Status da aplicação
curl http://localhost:3001/v2/status

# Fazer uma compra (50% de chance de falhar)
curl -X POST http://localhost:3001/v2/checkout \
  -H "Content-Type: application/json" \
  -d '{"productId": "TEMPLATE-NEXTJS", "userId": "user-1"}'
```

### **4. Verificar Logs no Loki**

```bash
# Acessar Loki UI
open http://localhost:3100

# Ou fazer query via API
curl -G \
  -d 'query={job="api"} | json' \
  -d 'limit=100' \
  http://localhost:3100/loki/api/v1/query_range | jq '.data.result'
```

## **Durante a Live**

### **Ato 1: Simular Falha (T+5)**
```
1. Dev compartilha tela mostrando o dashboard
2. Clica em "Comprar Produto" algumas vezes
3. Uma das requisições retorna 500
4. Log estruturado chega em Loki
```

### **Ato 2: Descoberta via Hermes (T+8)**
```
1. Dev envia áudio: "Hermes, procure erros 500 no checkout"
2. Hermes consulta Loki API
3. Hermes identifica o erro e avisa Telegram
4. Mostra contexto (timestamp, produto, motivo)
```

### **Ato 3: Monitoramento Autônomo (T+15)**
```
1. Dev pede: "Crie um cron para monitorar"
2. Hermes cria cron job que roda a cada 1 minuto
3. Hermes simula novo erro (clica novamente)
4. Cron descobre → avisa Telegram automaticamente
```

## **Documentação**

| Arquivo | Descrição |
|---------|-----------|
| [PRD.md](PRD.md) | Requisitos e visão arquitetural |
| [CLAUDE.md](CLAUDE.md) | Diretrizes de implementação |
| [AGENTE.md](AGENTE.md) | Instruções para o Hermes Agent |
| [README.md](README.md) | Este arquivo |

## **Endpoints Disponíveis**

### **Teste Prévio (/v1)**
- `GET /v1/health` — Status de saúde
- `GET /v1/status` — Métricas do sistema
- `POST /v1/checkout` — Simular compra (50% falha)
- `POST /v1/simulate-crash` — Simular queda

### **Live (/v2)**
Mesma coisa que /v1, mas isolada para a demonstração ao vivo não interferir no teste prévio.

## **Logs Estruturados**

Todos os logs saem como JSON no stdout:

```json
{
  "level": "error",
  "timestamp": "2026-08-15T19:08:23.456Z",
  "correlationId": "req-abc-123",
  "service": "checkout-api",
  "endpoint": "/v2/checkout",
  "productId": "TEMPLATE-NEXTJS",
  "reason": "payment_gateway_timeout",
  "message": "Falha ao processar pagamento"
}
```

**O Hermes lê esses logs via Loki API e os interpreta.**

## **Dados Fictícios (Gaming/Informática)**

**Produtos:**
- Monitor 240Hz IPS (R$ 1.299,00)
- Placa de Vídeo RTX 4060 (R$ 1.899,00)
- Headset Gamer Wireless (R$ 449,00)
- Teclado Mecânico RGB (R$ 599,00)
- Mousepad Extra Grande (R$ 149,00)

**Usuários:**
- gamer-pro@example.com
- tech-enthusiast@test.com

**Nenhuma informação sensível:** Tudo é fictício

## **Troubleshooting**

### **Loki não está recebendo logs**
```bash
# Verificar se Promtail está rodando
docker-compose logs promtail

# Verificar se API está loggando
docker-compose logs api
```

### **Endpoint /v2/checkout não existe**
```bash
# Verificar se API está rodando
docker-compose logs api

# Resetar containers
docker-compose down
docker-compose up -d
npm run seed
```

### **Banco de dados vazio**
```bash
# Rodar seed manualmente
npm run seed
```

## **Próximos Passos**

1. ✅ Ler [PRD.md](PRD.md) para entender requisitos
2. ✅ Ler [CLAUDE.md](CLAUDE.md) para diretrizes de código
3. ✅ Inicializar monorepo (apps/web, apps/api, packages/database)
4. ✅ Implementar endpoints /v1 e /v2
5. ✅ Configurar docker-compose completo
6. ✅ Seed de dados
7. ✅ Deploy no Coolify (segunda 18h)
8. ✅ Testes (segunda 18h-19h)
9. ✅ Live (segunda 19h)

---

**Qualquer dúvida?** Consulte [AGENTE.md](AGENTE.md) para detalhes sobre como Hermes funciona.

**Sucesso na demo! 🚀**
