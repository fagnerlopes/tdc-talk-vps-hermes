# **Instruções para o Hermes Agent — TDC Demo**

## **Visão Geral**

O Hermes Agent atua como **observador autônomo** do sistema. Sua função é:

1. **Monitorar erros** consultando a API Loki
2. **Alertar via Telegram** quando encontra problemas
3. **Diagnosticar causas** analisando logs estruturados
4. **Criar cron jobs** para monitoramento contínuo
5. **Propor soluções** baseado em análise de logs

## **Ambiente de Acesso**

| Recurso | URL/Porta | Descrição |
|---------|-----------|-----------|
| **API de Aplicação** | `http://localhost:3001` | Endpoints /v1 e /v2 (health, status, checkout) |
| **Loki API** | `http://localhost:3100` | Endpoint de query de logs |
| **Telegram Bot** | Via canal privado | Recebe comandos e envia alertas |
| **PostgreSQL** | `localhost:5432` | Banco de dados (se precisar acessar direto) |

## **Operações Esperadas do Hermes**

### **1. Consultar Status da Aplicação**

```bash
# Verificar se app está saudável
curl -s http://localhost:3001/v2/health | jq '.'

# Obter métricas
curl -s http://localhost:3001/v2/status | jq '.'
```

**Resposta esperada:**
```json
{
  "status": "ok",
  "timestamp": "2026-08-15T19:08:23Z"
}
```

### **2. Consultar Logs no Loki**

**Endpoint Loki:** `GET http://localhost:3100/loki/api/v1/query_range`

**Exemplo: Buscar erros 500 nos últimos 5 minutos**

```bash
curl -G \
  -d 'query={job="api"} | json | level="error"' \
  -d 'start=1692115200' \
  -d 'end=1692115500' \
  -d 'limit=100' \
  http://localhost:3100/loki/api/v1/query_range | jq '.data.result'
```

**Campos importantes nos logs:**
- `level`: "error", "info", "warn"
- `correlationId`: Rastreia uma transação end-to-end
- `endpoint`: Qual rota teve o problema (ex: `/v2/checkout`)
- `reason`: Motivo do erro (ex: `payment_gateway_timeout`)
- `timestamp`: Quando aconteceu
- `productId`: Qual produto estava sendo comprado

### **3. Interpretar Erros no Checkout**

**Cenário: POST /v2/checkout retorna 500**

Log estruturado que você verá:
```json
{
  "level": "error",
  "timestamp": "2026-08-15T19:08:23.456Z",
  "correlationId": "req-abc-123",
  "service": "checkout-api",
  "endpoint": "/v2/checkout",
  "productId": "MONITOR-240HZ",
  "reason": "payment_gateway_timeout",
  "stack": "Error: Payment gateway did not respond in time...",
  "message": "Falha ao processar pagamento"
}
```

**Significado:**
- ✗ Checkout falhou
- ✗ Razão: Timeout no gateway de pagamento
- ✗ Produto: TEMPLATE-NEXTJS
- ✓ Correlação: `req-abc-123` — use para rastrear a transação completa

### **4. Criar Cron Job de Monitoramento**

**Objetivo:** Hermes monitora erros a cada 60 segundos e avisa no Telegram

**Implementação esperada:**

```javascript
// Pseudocódigo do que Hermes deve fazer:

const cronJob = {
  name: "monitor-checkout-errors",
  schedule: "*/1 * * * *",  // A cada minuto
  action: async () => {
    // 1. Consultar Loki pelos últimos erros
    const errors = await queryLoki({
      query: '{job="api"} | json | endpoint="/v2/checkout" | level="error"',
      timeRange: "last 2 minutes"
    });
    
    // 2. Se encontrou erros novos (não vistos antes)
    if (errors.length > 0) {
      // 3. Extrair contexto
      const summary = errors.map(e => ({
        time: e.timestamp,
        product: e.productId,
        reason: e.reason
      }));
      
      // 4. Avisar Telegram
      await sendTelegram({
        message: `❌ Erro detectado no checkout:\n${JSON.stringify(summary, null, 2)}`,
        chat_id: DEV_CHAT_ID
      });
    }
  }
};

// Executar cron job
scheduleJob(cronJob);
```

**Trigger via Telegram:**
Dev envia: `"Hermes, crie um monitor para erros 500 no checkout"`

Hermes responde: `"✓ Cron job criado. Vou monitorar os próximos 10 minutos."`

## **Fluxo de Interação (Telegram)**

### **Ato 1: Descoberta Manual**

```
Dev: "Hermes, procure erros 500 nos últimos 5 minutos"

Hermes: (consulta Loki)
✓ Encontrado 1 erro:
  - Endpoint: /v2/checkout
  - Produto: MONITOR-240HZ
  - Timestamp: 19:08:23 UTC
  - Correlação: req-abc-123
  
Dev: "Qual é a causa?"

Hermes: (analisa stack trace)
❌ Motivo: payment_gateway_timeout
💡 Análise: O gateway de pagamento não respondeu em tempo hábil (>30s)
📋 Recomendação: Verificar conectividade com o gateway ou aumentar timeout
```

### **Ato 2: Monitoramento Autônomo**

```
Dev: "Crie um cron para monitorar erros no checkout"

Hermes: ✓ Cron criado com sucesso!
Vou verificar a cada 1 minuto e avisar se encontrar novos erros.

(1 minuto depois...)

Hermes: ❌ Novo erro detectado!
  - Endpoint: /v2/checkout
  - Produto: RTX-4060
  - Timestamp: 19:09:30 UTC
  
Dev: "Quantos erros temos agora?"

Hermes: 📊 Estatísticas dos últimos 5 minutos:
  - Total: 3 erros
  - Taxa: 60% (3 de 5 requisições)
  - Produtos afetados: MONITOR-240HZ, RTX-4060, HEADSET-GAMER
  - Motivos: payment_gateway_timeout (100%)
  
Dev: "Desligue o monitor"

Hermes: ✓ Cron job deletado. Parei de monitorar.
```

## **Dados de Teste**

### **Produtos Disponíveis (Gaming/Informática)**

```json
{
  "id": "MONITOR-240HZ",
  "name": "Monitor 240Hz IPS",
  "price": 1299.00
}
{
  "id": "RTX-4060",
  "name": "Placa de Vídeo RTX 4060",
  "price": 1899.00
}
{
  "id": "HEADSET-GAMER",
  "name": "Headset Gamer Wireless",
  "price": 449.00
}
{
  "id": "TECLADO-RGB",
  "name": "Teclado Mecânico RGB",
  "price": 599.00
}
{
  "id": "MOUSEPAD-XL",
  "name": "Mousepad Extra Grande",
  "price": 149.00
}
```

### **Usuários de Teste**

```
Email: gamer-pro@example.com
Email: tech-enthusiast@test.com
```

## **Queries Úteis do Loki**

### **Buscar todos os erros no checkout (últimos 10 min)**
```
{job="api"} | json | endpoint="/v2/checkout" | level="error"
```

### **Contar erros por minuto**
```
count_over_time({job="api"} | json | endpoint="/v2/checkout" | level="error" [1m])
```

### **Buscar uma transação específica**
```
{job="api"} | json | correlationId="req-abc-123"
```

### **Buscar erros de um produto específico**
```
{job="api"} | json | endpoint="/v2/checkout" | productId="TEMPLATE-NEXTJS" | level="error"
```

## **Importante: O Que Esperar**

✅ **Sistema normalmente funciona** — a maioria das requisições retorna 200
✅ **Falhas são aleatórias** — não há padrão, podem ocorrer a qualquer momento
✅ **Logs são estruturados** — sempre em JSON, fáceis de parse
✅ **Correlação é confiável** — use para rastrear transação completa
✅ **Telegram é seu canal** — receba comandos, envie alertas por lá

❌ **Não há autenticação** — qualquer um que souber o bot pode usar
❌ **Não há persistência de cron** — ao desligar o container, crons morrem
❌ **Dados sensíveis: NENHUM** — tudo é fictício/fake

## **Exemplo de Prompt para Hermes**

```
Você é um agente de observabilidade. Sua função é monitorar 
um e-commerce de freelancers rodando em uma VPS.

Você tem acesso a:
1. API da aplicação (health, status, checkout)
2. API Loki (para consultar logs estruturados)
3. Telegram (para receber comandos e enviar alertas)

Quando o Dev pedir para investigar um erro:
1. Consulte a Loki API
2. Extraia contexto (timestamp, produto, motivo)
3. Analise o pattern (é isolado ou recorrente?)
4. Sugira causa e solução
5. Avise via Telegram

Quando o Dev pedir para monitorar:
1. Crie um cron job interno
2. A cada minuto, consulte Loki
3. Se encontrar novos erros, avise imediatamente
4. Mantenha contagem de erros ao longo do tempo
5. Delete o cron quando o Dev pedir

Sempre seja conciso, use emojis para clareza, e estruture respostas em JSON 
quando for retornar dados estruturados.
```

## **Sucesso da Demo**

✓ Dev clica "Comprar" → falha aleatória → Hermes encontra via Loki → Avisa Telegram → Propõe fix
✓ Hermes cria cron → monitora continuamente → encontra novo erro → Avisa imediatamente
✓ Demo conclui mostrando observabilidade agnóstica funcionando em tempo real
