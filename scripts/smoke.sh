#!/usr/bin/env bash
# Smoke test ponta a ponta. Cada checagem mapeia uma secao do CHECKLIST-PRE-LIVE.md.
#
# Uso:
#   ./scripts/smoke.sh          # localhost (precisa do docker-compose.override.yml)
#
#   API_URL=https://api.hostmaster.fagnerlopes.dev \
#   WEB_URL=https://hostmaster.fagnerlopes.dev \
#   LOKI_URL=https://loki.hostmaster.fagnerlopes.dev \
#   GRAFANA_URL=https://grafana.hostmaster.fagnerlopes.dev \
#   LOKI_USER=hermes LOKI_PASS='...' \
#   ADMIN_EMAIL='...' ADMIN_PASSWORD='...' ./scripts/smoke.sh
#
# LOKI_USER/LOKI_PASS: em producao o Loki fica atras do proxy loki-auth. Sem eles
#   as secoes 6 a 9 respondem 401 e a talk "cai" pelo motivo errado.
# ADMIN_EMAIL/ADMIN_PASSWORD: sem eles as checagens de login sao PULADAS.
# PROMTAIL_URL: nao ha dominio para o Promtail. Deixe em branco contra a VPS.
#
# O criterio de sucesso desta demo NAO e "o app funciona". E: as queries LogQL
# do AGENTE.md retornam dados. Por isso as checagens do Loki sao as criticas.

set -uo pipefail

API_URL="${API_URL:-http://localhost:3001}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
LOKI_URL="${LOKI_URL:-http://localhost:3100}"
# Sem dominio e sem porta publicada, o Promtail nao e alcancavel de fora.
# Default VAZIO de proposito: manter localhost:9080 aqui so produziria
# falso negativo contra a VPS.
PROMTAIL_URL="${PROMTAIL_URL:-}"
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3300}"
LOKI_USER="${LOKI_USER:-}"
LOKI_PASS="${LOKI_PASS:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

# Em producao o Loki esta atras de basic-auth (servico loki-auth). Array vazio
# quando nao ha credencial, para o -u nao virar argumento solto.
#
# Expanda SEMPRE com ${loki_auth[@]+"${loki_auth[@]}"}, nunca com "${loki_auth[@]}":
# sob `set -u` a segunda forma quebra em array vazio no bash < 4.4, e nao da para
# assumir paridade de versao entre o laptop e a VPS.
loki_auth=()
if [ -n "$LOKI_USER" ]; then
  loki_auth=(-u "${LOKI_USER}:${LOKI_PASS}")
fi

PASS=0
FAIL=0
SKIP=0

ok()   { printf '  \033[32mOK\033[0m   %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFALHA\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
skip() { printf '  \033[33mPULADO\033[0m %s\n' "$1"; SKIP=$((SKIP + 1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# LogQL precisa de --data-urlencode: `-d` puro nao faz URL-encode e os
# caracteres | { } " e espaco geram HTTP 400 no Loki.
loki_query() {
  curl -sG ${loki_auth[@]+"${loki_auth[@]}"} "${LOKI_URL}/loki/api/v1/query_range" \
    --data-urlencode "query=$1" \
    --data-urlencode "limit=${2:-100}" \
    --data-urlencode "start=$(date -u -d '15 minutes ago' +%s)000000000" \
    --data-urlencode "end=$(date -u +%s)000000000"
}

loki_lines() {
  loki_query "$1" "${2:-100}" | jq '[.data.result[].values[]] | length' 2>/dev/null || echo 0
}

head_ "1. Stack de pe"
# `--services --filter status=running` em vez de `--format '{{.Service}}'`:
# o compose 2.3.3 nao entende o segundo, e nao da para assumir paridade de
# versao entre o laptop e a VPS.
if [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1; then
  running=$(docker compose ps --services --filter status=running 2>/dev/null | grep -c .)
  if [ "$running" -ge 7 ]; then
    ok "$running servicos rodando"
  else
    bad "so $running servicos rodando (esperado 7: postgres api web loki loki-auth promtail grafana)"
  fi
else
  ok "sem docker-compose.yml local — assumindo host remoto, pulando"
fi

head_ "2. Endpoints /v1 e /v2"
for v in v1 v2; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/${v}/health")
  [ "$code" = "200" ] && ok "GET /${v}/health = 200" || bad "GET /${v}/health = $code"

  fields=$(curl -s "${API_URL}/${v}/status" | jq -r 'has("uptime") and has("checkouts") and has("failures") and has("failureRate") and has("crashed")')
  [ "$fields" = "true" ] && ok "GET /${v}/status traz uptime/checkouts/failures/failureRate/crashed" \
    || bad "GET /${v}/status sem os campos esperados"

  count=$(curl -s "${API_URL}/${v}/products" | jq '.products | length')
  [ "$count" = "5" ] && ok "GET /${v}/products = 5 produtos" || bad "GET /${v}/products = $count produtos"
done

head_ "3. Falha ~50% em /v1 (10 tentativas)"
before=$(curl -s "${API_URL}/v1/status" | jq -r .checkouts)
failures=0
for _ in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API_URL}/v1/checkout" \
    -H 'content-type: application/json' -d '{"productId":"MONITOR-240HZ","userId":"user-1"}')
  [ "$code" = "500" ] && failures=$((failures + 1))
done
if [ "$failures" -ge 3 ] && [ "$failures" -le 7 ]; then
  ok "$failures/10 falharam (tolerancia binomial 3-7)"
else
  bad "$failures/10 falharam — fora da faixa 3-7; conferir CHECKOUT_FAILURE_RATE"
fi

head_ "4. Isolamento entre versoes"
v2_before=$(curl -s "${API_URL}/v2/status" | jq -r .checkouts)
curl -s -o /dev/null -X POST "${API_URL}/v1/checkout" -H 'content-type: application/json' \
  -d '{"productId":"MOUSEPAD-XL"}'
v2_after=$(curl -s "${API_URL}/v2/status" | jq -r .checkouts)
[ "$v2_before" = "$v2_after" ] && ok "checkout em /v1 nao moveu os contadores de /v2" \
  || bad "contadores de /v2 mudaram ($v2_before -> $v2_after) — estado vazando entre versoes"

head_ "5. Crash toggle em /v1"
curl -s -o /dev/null -X POST "${API_URL}/v1/simulate-crash"
code=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/v1/health")
[ "$code" = "500" ] && ok "apos simulate-crash, health = 500" || bad "apos simulate-crash, health = $code"
curl -s -o /dev/null -X POST "${API_URL}/v1/simulate-crash"
code=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/v1/health")
[ "$code" = "200" ] && ok "apos reset, health = 200" || bad "apos reset, health = $code"

head_ "6. Promtail e Loki"
# O Promtail nao tem dominio: com as portas fechadas, /ready so e alcancavel de
# dentro do host. Tres tentativas, em ordem de disponibilidade. Pular em silencio
# seria pior que nao checar — por isso o estado PULADO aparece no resultado.
if [ -n "$PROMTAIL_URL" ] && [ "$(curl -s -m 5 "${PROMTAIL_URL}/ready" 2>/dev/null)" = "Ready" ]; then
  ok "promtail /ready (via PROMTAIL_URL)"
elif [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1 \
     && docker compose exec -T promtail wget -qO- localhost:9080/ready 2>/dev/null | grep -q Ready; then
  ok "promtail /ready (via docker compose exec)"
else
  skip "promtail /ready — sem acesso externo nem ao host; na VPS rode: docker compose exec promtail wget -qO- localhost:9080/ready"
fi

labels=$(curl -s ${loki_auth[@]+"${loki_auth[@]}"} "${LOKI_URL}/loki/api/v1/label/job/values" | jq -r '.data[]?' | tr '\n' ' ')
echo "$labels" | grep -q 'api' && ok "Loki conhece o label job=api" || bad "Loki nao tem job=api (labels: ${labels:-nenhum})"

head_ "7. GATE CRITICO — queries do AGENTE.md"
# Gera trafego fresco em /v2 e garante ao menos uma falha
CID=$(curl -s -X POST "${API_URL}/v2/checkout" -H 'content-type: application/json' \
  -d '{"productId":"MONITOR-240HZ","userId":"user-1","forceFailure":true}' | jq -r .correlationId)
sleep 4

n=$(loki_lines '{job="api"} | json | level="error"')
[ "$n" -gt 0 ] && ok "{job=\"api\"} | json | level=\"error\" -> $n linhas" \
  || bad "{job=\"api\"} | json | level=\"error\" -> 0 linhas — A TALK CAI AQUI"

n=$(loki_lines '{job="api"} | json | endpoint="/v2/checkout" | level="error"')
[ "$n" -gt 0 ] && ok "filtro por endpoint=/v2/checkout -> $n linhas" || bad "filtro por endpoint -> 0 linhas"

n=$(loki_lines '{job="api"} | json | endpoint="/v2/checkout" | productId="MONITOR-240HZ" | level="error"')
[ "$n" -gt 0 ] && ok "filtro por productId=MONITOR-240HZ -> $n linhas" || bad "filtro por productId -> 0 linhas"

series=$(curl -sG ${loki_auth[@]+"${loki_auth[@]}"} "${LOKI_URL}/loki/api/v1/query_range" \
  --data-urlencode 'query=count_over_time({job="api"} | json | endpoint="/v2/checkout" | level="error" [1m])' \
  --data-urlencode "start=$(date -u -d '15 minutes ago' +%s)000000000" \
  --data-urlencode "end=$(date -u +%s)000000000" \
  --data-urlencode 'step=60' | jq -r '.data.result | length')
[ "${series:-0}" -gt 0 ] && ok "count_over_time -> $series series" || bad "count_over_time -> nenhuma serie"

head_ "8. Campos obrigatorios na linha de log"
keys=$(loki_query '{job="api"} | json | level="error"' 1 | jq -r '.data.result[0].values[0][1] | fromjson | keys | join(",")' 2>/dev/null)
missing=""
for field in level timestamp correlationId service endpoint productId reason message; do
  echo ",$keys," | grep -q ",$field," || missing="$missing $field"
done
[ -z "$missing" ] && ok "os 8 campos obrigatorios estao presentes" || bad "faltando:$missing"

head_ "9. Trace por correlacao (latencia log -> Loki)"
n=$(loki_lines "{job=\"api\"} | json | correlationId=\"$CID\"")
[ "$n" = "2" ] && ok "correlationId $CID -> exatamente 2 linhas (inicio + falha)" \
  || bad "correlationId $CID -> $n linhas (esperado 2)"

head_ "10. Frontend e Grafana"
hits=$(curl -s "${WEB_URL}" | grep -c HOSTMASTER)
[ "$hits" -ge 1 ] && ok "dashboard responde e contem HOSTMASTER" || bad "dashboard sem HOSTMASTER"

code=$(curl -s -o /dev/null -w '%{http_code}' "${WEB_URL}/api/proxy/v2/health")
[ "$code" = "200" ] && ok "proxy do Next -> API = 200" || bad "proxy do Next -> API = $code"

code=$(curl -s -o /dev/null -w '%{http_code}' "${GRAFANA_URL}/api/health")
[ "$code" = "200" ] && ok "Grafana respondendo" || bad "Grafana = $code"

ds=$(curl -s "${GRAFANA_URL}/api/datasources" | jq -r '.[0].type' 2>/dev/null)
[ "$ds" = "loki" ] && ok "datasource Loki provisionado" || bad "datasource Loki ausente (got: ${ds:-nada})"

head_ "Resultado"
printf '  %d passaram, %d falharam, %d pulados\n\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || exit 1
