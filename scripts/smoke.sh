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

# As checagens que usam `docker compose` inspecionam a stack DESTE host. Rodando
# contra a VPS a partir do repositorio, com uma stack local de pe, elas passariam
# olhando para os containers errados — um falso positivo que esconde exatamente o
# que o smoke deveria pegar. Por isso so valem quando o alvo e local.
ALVO_LOCAL=no
case "$WEB_URL" in
  *localhost*|*127.0.0.1*) ALVO_LOCAL=yes ;;
esac
if [ "$ALVO_LOCAL" = "yes" ] && [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1; then
  DOCKER_LOCAL=yes
else
  DOCKER_LOCAL=no
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
if [ "$DOCKER_LOCAL" = "yes" ]; then
  running=$(docker compose ps --services --filter status=running 2>/dev/null | grep -c .)
  if [ "$running" -ge 7 ]; then
    ok "$running servicos rodando"
  else
    bad "so $running servicos rodando (esperado 7: postgres api web loki loki-auth promtail grafana)"
  fi
else
  skip "contagem de containers — alvo remoto; rode na VPS: docker compose ps --services --filter status=running"
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
# A faixa e 2-8, nao 3-7. O CHECKOUT_MAX_SUCCESS_STREAK=3 forca falha depois de 3
# sucessos seguidos, o que empurra a taxa REAL para ~53%, nao 50% — a cadeia de
# Markov dos estados de streak da 0.533. Com n=10, a faixa 3-7 dispara falso
# alarme em ~7% das execucoes, e um gate que grita a toa antes da live e pior que
# gate nenhum. A faixa 2-8 continua pegando o que importa: failureRate=0 (da 0) e
# failureRate=1 (da 10), que sao os erros reais de configuracao.
before=$(curl -s "${API_URL}/v1/status" | jq -r .checkouts)
failures=0
for _ in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API_URL}/v1/checkout" \
    -H 'content-type: application/json' -d '{"productId":"MONITOR-240HZ","userId":"user-1"}')
  [ "$code" = "500" ] && failures=$((failures + 1))
done
if [ "$failures" -ge 2 ] && [ "$failures" -le 8 ]; then
  ok "$failures/10 falharam (tolerancia 2-8; media real ~5.3 por causa do streak cap)"
else
  bad "$failures/10 falharam — fora da faixa 2-8; conferir CHECKOUT_FAILURE_RATE"
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
elif [ "$DOCKER_LOCAL" = "yes" ] \
     && docker compose exec -T promtail wget -qO- localhost:9080/ready 2>/dev/null | grep -q Ready; then
  ok "promtail /ready (via docker compose exec)"
else
  skip "promtail /ready — sem acesso externo nem ao host; na VPS rode: docker compose exec promtail wget -qO- localhost:9080/ready"
fi

labels=$(curl -s ${loki_auth[@]+"${loki_auth[@]}"} "${LOKI_URL}/loki/api/v1/label/job/values" | jq -r '.data[]?' | tr '\n' ' ')
echo "$labels" | grep -q 'api' && ok "Loki conhece o label job=api" || bad "Loki nao tem job=api (labels: ${labels:-nenhum})"

if [ -n "$LOKI_USER" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "${LOKI_URL}/ready")
  [ "$code" = "401" ] && ok "Loki sem credencial = 401 (basic-auth ativo)" \
    || bad "Loki sem credencial = $code — esperado 401; O LOKI ESTA ABERTO"

  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${LOKI_URL}/loki/api/v1/push" \
    -H 'content-type: application/json' \
    -d "{\"streams\":[{\"stream\":{\"job\":\"smoke-push-test\"},\"values\":[[\"$(date +%s)000000000\",\"deve ser barrado\"]]}]}")
  [ "$code" = "401" ] && ok "push anonimo no Loki = 401" \
    || bad "push anonimo no Loki = $code — QUALQUER UM PODE ENVENENAR OS LOGS"
else
  skip "basic-auth do Loki — LOKI_USER nao definido (uso local)"
fi

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

head_ "10. Loja publica e noindex"
body=$(curl -s "${WEB_URL}/")
echo "$body" | grep -q 'HOSTMASTER' && ok "loja responde e contem HOSTMASTER" || bad "loja sem HOSTMASTER"
echo "$body" | grep -q 'Comprar'    && ok "loja tem botao Comprar"           || bad "loja sem botao Comprar"
echo "$body" | grep -q 'Logs recentes' \
  && bad "a loja esta mostrando 'Logs recentes' — isso e do painel" \
  || ok "loja NAO mostra logs (visao do cliente)"

curl -s "${WEB_URL}/robots.txt" | grep -q 'Disallow: /' \
  && ok "robots.txt com Disallow: /" || bad "robots.txt sem Disallow: /"

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

# Cookie forjado tem que ser barrado pela BARREIRA (app/dashboard/layout.tsx),
# nao pelo middleware — que so olha a presenca do cookie.
redirect=$(curl -s -o /dev/null -H 'Cookie: hostmaster_session=forjado-nao-existe' \
  -w '%{redirect_url}' "${WEB_URL}/dashboard")
case "$redirect" in
  */login*) ok "cookie forjado barrado pela validacao no banco" ;;
  *)        bad "cookie forjado NAO foi barrado — a barreira nao esta validando" ;;
esac

if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  jar=$(mktemp)

  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${WEB_URL}/api/auth/login" \
    -H 'content-type: application/json' \
    -d "$(jq -nc --arg e "$ADMIN_EMAIL" '{email:$e,password:"senha-propositalmente-errada"}')")
  [ "$code" = "401" ] && ok "login com senha errada = 401" || bad "login com senha errada = $code"

  code=$(curl -s -c "$jar" -o /dev/null -w '%{http_code}' -X POST "${WEB_URL}/api/auth/login" \
    -H 'content-type: application/json' \
    -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')")
  [ "$code" = "200" ] && ok "login correto = 200" || bad "login correto = $code"

  grep -q 'hostmaster_session' "$jar" \
    && ok "cookie de sessao devolvido" || bad "login nao devolveu cookie de sessao"

  dash=$(curl -s -b "$jar" -w '\n%{http_code}' "${WEB_URL}/dashboard")
  code=$(echo "$dash" | tail -1)
  [ "$code" = "200" ] && ok "/dashboard com cookie = 200" || bad "/dashboard com cookie = $code"
  echo "$dash" | grep -q 'Logs recentes' \
    && ok "/dashboard contem 'Logs recentes'" || bad "/dashboard sem 'Logs recentes'"

  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${WEB_URL}/api/dashboard/users" \
    -H 'content-type: application/json' \
    -d '{"email":"invasor@exemplo.com","name":"Invasor","password":"senha-comprida-123"}')
  [ "$code" = "401" ] && ok "POST /api/dashboard/users sem cookie = 401" \
    || bad "POST /api/dashboard/users sem cookie = $code — o handler nao revalida"

  rm -f "$jar"
else
  skip "login — ADMIN_EMAIL/ADMIN_PASSWORD nao definidos"
fi

head_ "12. A API continua ABERTA (restricao inviolavel)"
code=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/v2/health")
[ "$code" = "200" ] && ok "GET /v2/health sem credencial = 200" \
  || bad "GET /v2/health = $code — a auth vazou para a API e a demo morre"

code=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/v2/logs?limit=1")
[ "$code" = "200" ] && ok "GET /v2/logs sem credencial = 200" \
  || bad "GET /v2/logs = $code — a auth vazou para a API"

head_ "Resultado"
printf '  %d passaram, %d falharam, %d pulados\n\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || exit 1
