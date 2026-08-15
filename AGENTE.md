# Instruções para o Hermes Agent — TDC Demo

## Visão geral

O Hermes atua como **observador autônomo** do sistema. Sua função é:

1. **Monitorar erros** consultando a API do Loki
2. **Alertar via Telegram** quando encontra problemas
3. **Diagnosticar causas** analisando os logs estruturados
4. **Criar cron jobs** para monitoramento contínuo
5. **Propor soluções** com base na análise

Nada disso está codificado na aplicação. A aplicação só loga; toda a inteligência é do Hermes.

## Ambiente de acesso

> URLs de produção, já no ar. O Hermes roda numa **VPS separada** da que hospeda a
> aplicação — ele não enxerga `localhost`, por isso tudo abaixo usa o host público.
>
> **Pendente:** o acesso à porta 3100 ainda precisa ser restrito ao IP da VPS do
> Hermes — ver [DEPLOY.md](DEPLOY.md#exposição-do-loki-r4). Feita a allowlist por IP,
> nenhum comando desta página muda. Se a escolha for basic-auth, todo `curl` ao Loki
> passa a precisar de `-u "$LOKI_USER:$LOKI_PASS"`.

| Recurso | URL | Descrição |
|---|---|---|
| **API da aplicação** | `http://vps70013.publiccloud.com.br:3001` | endpoints `/v1` e `/v2` |
| **Loki** | `http://vps70013.publiccloud.com.br:3100` | query de logs — o canal principal do Hermes |
| **Grafana** | `http://vps70013.publiccloud.com.br:3300` | Explore, sem login (uso humano, não do agente) |
| **Telegram** | canal privado | recebe comandos e envia alertas |
| **PostgreSQL** | `vps70013.publiccloud.com.br:5432` | `dev_user` / `dev123` / `hermes_demo` |

Para rodar contra a stack local: substituir `vps70013.publiccloud.com.br` por `localhost`.

## 1. Consultar o estado da aplicação

```bash
curl -s http://vps70013.publiccloud.com.br:3001/v2/health | jq '.'
curl -s http://vps70013.publiccloud.com.br:3001/v2/status | jq '.'
```

Resposta de `/v2/health`:
```json
{ "status": "ok", "version": "v2", "timestamp": "2026-08-17T22:08:23.114Z" }
```

Resposta de `/v2/status`:
```json
{
  "version": "v2",
  "uptime": 312,
  "checkouts": 14,
  "failures": 7,
  "failureRate": 0.5,
  "observedFailureRate": 0.5,
  "maxSuccessStreak": 3,
  "crashed": false,
  "timestamp": "2026-08-17T22:08:23.129Z"
}
```

`failureRate` é a taxa **configurada**; `observedFailureRate` é a taxa **medida** desde o start. Divergência grande entre as duas é informação útil, não bug.

## 2. Consultar logs no Loki

**Endpoint:** `GET http://vps70013.publiccloud.com.br:3100/loki/api/v1/query_range`

⚠️ **Use `--data-urlencode`, nunca `-d`.** Uma query LogQL contém `|`, `{`, `}`, `"` e espaços. Com `-d` puro o curl não faz URL-encode e o Loki responde **HTTP 400**.

```bash
LOKI=http://vps70013.publiccloud.com.br:3100

curl -sG "$LOKI/loki/api/v1/query_range" \
  --data-urlencode 'query={job="api"} | json | level="error"' \
  --data-urlencode "start=$(date -u -d '5 minutes ago' +%s)000000000" \
  --data-urlencode "end=$(date -u +%s)000000000" \
  --data-urlencode 'limit=100' | jq '.data.result'
```

`start` e `end` são **nanossegundos** epoch. Omitir ambos faz o Loki assumir a última hora.

### Extrair as linhas em JSON

A resposta aninha os valores em `.data.result[].values[][1]`. Para trabalhar com os campos:

```bash
curl -sG "$LOKI/loki/api/v1/query_range" \
  --data-urlencode 'query={job="api"} | json | level="error"' \
  --data-urlencode 'limit=20' \
| jq -r '.data.result[].values[][1] | fromjson
         | {timestamp, correlationId, endpoint, productId, reason, message}'
```

### Campos disponíveis na linha

| Campo | Exemplo | Nota |
|---|---|---|
| `level` | `error` \| `warn` \| `info` | string, não número |
| `timestamp` | `2026-08-17T22:08:23.456Z` | ISO8601 |
| `service` | `checkout-api` | constante |
| `correlationId` | `req-a1b2c3d4` | **rastreia a transação ponta a ponta** |
| `endpoint` | `/v2/checkout` | distingue a live (`/v2`) do ensaio (`/v1`) |
| `productId` | `MONITOR-240HZ` | |
| `userId` | `user-1` | |
| `reason` | `payment_gateway_timeout` | só em falhas |
| `stack` | `Error: Payment gateway...` | stack trace real |
| `httpStatus` | `500` | |
| `durationMs` | `1843` | |
| `amount` | `1299` | |
| `message` | `Falha ao processar pagamento` | |

O Loki 3.x acrescenta `detected_level` e `service_name` por conta própria. **Ignore os dois** e filtre sempre pelo `level` que vem do `| json`.

## 3. Interpretar um erro de checkout

Cenário: `POST /v2/checkout` retornou 500. A linha no Loki:

```json
{
  "level": "error",
  "timestamp": "2026-08-17T22:08:23.456Z",
  "service": "checkout-api",
  "correlationId": "req-a1b2c3d4",
  "endpoint": "/v2/checkout",
  "productId": "MONITOR-240HZ",
  "userId": "user-1",
  "reason": "payment_gateway_timeout",
  "stack": "Error: Payment gateway did not respond within 30000ms\n    at ...",
  "httpStatus": 500,
  "durationMs": 1843,
  "amount": 1299,
  "message": "Falha ao processar pagamento"
}
```

Leitura:
- ✗ Checkout falhou (`httpStatus: 500`)
- ✗ Causa: timeout no gateway de pagamento
- ✗ Produto: **MONITOR-240HZ** (Monitor 240Hz IPS)
- ✓ Correlação: `req-a1b2c3d4` — use para reconstruir a transação inteira

### Os três `reason` possíveis

| `reason` | Frequência | Diagnóstico | Recomendação |
|---|---|---|---|
| `payment_gateway_timeout` | ~70% | gateway não respondeu em 30s | verificar conectividade com o gateway ou aumentar o timeout |
| `payment_processing_failed` | ~20% | provedor recusou (código `PROV-502`) | verificar credenciais e status do provedor |
| `insufficient_inventory` | ~10% | reserva de estoque falhou | conferir consistência de estoque |

### Reconstruir a transação

Cada checkout gera **exatamente 2 linhas** com o mesmo `correlationId`: o início (`info`) e o desfecho (`info` de sucesso ou `error` de falha).

```bash
curl -sG "$LOKI/loki/api/v1/query_range" \
  --data-urlencode 'query={job="api"} | json | correlationId="req-a1b2c3d4"' \
  --data-urlencode 'limit=10' | jq -r '.data.result[].values[][1]'
```

O mesmo `correlationId` também está gravado na tabela `orders` do Postgres — segundo ângulo de investigação, se precisar confirmar o que foi persistido.

## 4. Criar cron job de monitoramento

**Objetivo:** verificar erros a cada 60s e avisar no Telegram.

```javascript
const cronJob = {
  name: 'monitor-checkout-errors',
  schedule: '*/1 * * * *',
  action: async () => {
    const errors = await queryLoki({
      query: '{job="api"} | json | endpoint="/v2/checkout" | level="error"',
      timeRange: 'last 2 minutes',
    });

    if (errors.length > 0) {
      const summary = errors.map((e) => ({
        time: e.timestamp,
        product: e.productId,
        reason: e.reason,
        correlationId: e.correlationId,
      }));

      await sendTelegram({
        message: `❌ Erro detectado no checkout:\n${JSON.stringify(summary, null, 2)}`,
        chat_id: DEV_CHAT_ID,
      });
    }
  },
};

scheduleJob(cronJob);
```

Guarde os `correlationId` já reportados para não avisar duas vezes sobre o mesmo erro.

**Trigger via Telegram**
Dev: `"Hermes, crie um monitor para erros 500 no checkout"`
Hermes: `"✓ Cron job criado. Vou monitorar os próximos 10 minutos."`

## Fluxo de interação (Telegram)

### Ato 1 — descoberta manual

```
Dev: "Hermes, procure erros 500 nos últimos 5 minutos"

Hermes: (consulta Loki)
✓ Encontrado 1 erro:
  - Endpoint: /v2/checkout
  - Produto: MONITOR-240HZ
  - Timestamp: 22:08:23 UTC
  - Correlação: req-a1b2c3d4

Dev: "Qual é a causa?"

Hermes: (analisa o stack trace)
❌ Motivo: payment_gateway_timeout
💡 Análise: o gateway de pagamento não respondeu dentro de 30s
📋 Recomendação: verificar conectividade com o gateway ou aumentar o timeout
```

### Ato 2 — monitoramento autônomo

```
Dev: "Crie um cron para monitorar erros no checkout"

Hermes: ✓ Cron criado. Vou verificar a cada 1 minuto e avisar se achar erro novo.

(1 minuto depois)

Hermes: ❌ Novo erro detectado!
  - Endpoint: /v2/checkout
  - Produto: RTX-4060
  - Timestamp: 22:09:30 UTC

Dev: "Quantos erros temos agora?"

Hermes: 📊 Últimos 5 minutos:
  - Total: 3 erros
  - Taxa: 60% (3 de 5 requisições)
  - Produtos afetados: MONITOR-240HZ, RTX-4060, HEADSET-GAMER
  - Motivos: payment_gateway_timeout (100%)

Dev: "Desligue o monitor"

Hermes: ✓ Cron job deletado. Parei de monitorar.
```

## Queries úteis do Loki

Todas com `--data-urlencode`.

**Erros no checkout da live**
```
{job="api"} | json | endpoint="/v2/checkout" | level="error"
```

**Contar erros por minuto**
```
count_over_time({job="api"} | json | endpoint="/v2/checkout" | level="error" [1m])
```

**Rastrear uma transação**
```
{job="api"} | json | correlationId="req-a1b2c3d4"
```

**Erros de um produto específico**
```
{job="api"} | json | endpoint="/v2/checkout" | productId="MONITOR-240HZ" | level="error"
```

**Erros por motivo**
```
sum by (reason) (count_over_time({job="api"} | json | level="error" [5m]))
```

**Só a live, ignorando o ensaio das 18h**
```
{job="api"} | json | endpoint=~"/v2/.*"
```

**Serviço marcado como indisponível**
```
{job="api"} | json | reason="manual_crash_enabled"
```

### Sobre os labels

O stream tem **um label só**: `job="api"`. Não existe label `level` nem `endpoint` — se existissem, o `| json` renomearia as chaves extraídas para `level_extracted` / `endpoint_extracted` e todas as queries acima quebrariam em silêncio. Todo filtro acontece **depois** do `| json`, em tempo de query.

Confirmar a qualquer momento:
```bash
curl -s "$LOKI/loki/api/v1/label/job/values" | jq -r '.data[]'   # => api
```

## Dados de teste

### Produtos

| id | nome | preço |
|---|---|---|
| `MONITOR-240HZ` | Monitor 240Hz IPS | 1299.00 |
| `RTX-4060` | Placa de Vídeo RTX 4060 | 1899.00 |
| `HEADSET-GAMER` | Headset Gamer Wireless | 449.00 |
| `TECLADO-RGB` | Teclado Mecânico RGB | 599.00 |
| `MOUSEPAD-XL` | Mousepad Extra Grande | 149.00 |

### Usuários

| id | email |
|---|---|
| `user-1` | gamer-pro@example.com |
| `user-2` | tech-enthusiast@test.com |

## Endpoints de controle (uso do apresentador, não do Hermes)

Existem para tornar o palco determinístico. **O Hermes não deve chamá-los durante a demo** — se chamar, deixa de estar investigando e passa a estar dirigindo.

```bash
# provocar uma falha por curl, sem alterar o estado global
curl -X POST http://vps70013.publiccloud.com.br:3001/v2/checkout -H 'content-type: application/json' \
  -d '{"productId":"MONITOR-240HZ","userId":"user-1","forceFailure":true}'

# garantir que o PRÓXIMO clique falhe
curl -X POST http://vps70013.publiccloud.com.br:3001/v2/config -H 'content-type: application/json' \
  -d '{"forceNextOutcome":"fail"}'

# ajustar a taxa de falha
curl -X POST http://vps70013.publiccloud.com.br:3001/v2/config -H 'content-type: application/json' \
  -d '{"failureRate":0.5}'

# voltar ao baseline
curl -X POST http://vps70013.publiccloud.com.br:3001/v2/config -H 'content-type: application/json' -d '{"reset":true}'

# derrubar / restabelecer o health
curl -X POST http://vps70013.publiccloud.com.br:3001/v2/simulate-crash

# últimas linhas do ring buffer (é o que o painel do dashboard consome)
curl -s 'http://vps70013.publiccloud.com.br:3001/v2/logs?limit=10' | jq '.logs'
```

**Uma falha forçada produz uma linha de log byte-idêntica a uma falha natural.** Não existe campo `forced`. O Hermes não tem — e não deve ter — como distinguir as duas.

## O que esperar

✅ O sistema normalmente funciona — a maioria das requisições retorna 200
✅ As falhas são aleatórias, sem padrão temporal
✅ Os logs são sempre JSON válido de uma linha
✅ A correlação é confiável: 2 linhas por transação, sempre
✅ O Telegram é o canal do Hermes

❌ Não há autenticação — quem souber o bot pode usar
❌ Não há persistência de cron — ao desligar o container, os crons morrem
❌ Dados sensíveis: nenhum, tudo é fictício

## Prompt de referência para o Hermes

```
Você é um agente de observabilidade monitorando um e-commerce em uma VPS.

Você tem acesso a:
1. API da aplicação (health, status)
2. API do Loki (logs estruturados)
3. Telegram (comandos e alertas)

Ao investigar um erro:
1. Consulte o Loki com --data-urlencode (query com | e {} quebra sem isso)
2. Filtre com {job="api"} | json | level="error" — job é o único label
3. Extraia timestamp, correlationId, productId e reason
4. Use o correlationId para reconstruir a transação (são 2 linhas)
5. Leia o stack trace para diagnosticar
6. Avalie se é isolado ou recorrente (count_over_time)
7. Sugira causa e solução, e avise no Telegram

Ao monitorar:
1. Crie um cron job interno
2. A cada minuto, consulte o Loki pelos últimos 2 minutos
3. Avise só sobre correlationId ainda não reportados
4. Mantenha a contagem acumulada
5. Delete o cron quando pedirem

Seja conciso, use emojis para clareza e estruture dados em JSON.
```

## Sucesso da demo

✓ Dev clica em "Comprar" → falha aleatória → Hermes acha via Loki → avisa no Telegram → propõe fix
✓ Hermes cria cron → monitora continuamente → acha erro novo → avisa na hora
✓ A demo fecha mostrando observabilidade agnóstica funcionando em tempo real
