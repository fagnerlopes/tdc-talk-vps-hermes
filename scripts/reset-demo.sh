#!/usr/bin/env bash
# Reset de palco: volta v1 e v2 ao baseline e ASSERTA o resultado.
#
# R1 do plano: esquecer o failureRate em 1.0 apos o smoke test faz TODO clique
# falhar no palco, e a premissa "o sistema normalmente funciona" do AGENTE.md
# desaba. Este script existe para que isso nao dependa da sua memoria.
#
# R5: este script NUNCA chama `docker compose down -v`. O -v apagaria
# postgres_data E loki_data — junto com todo o historico que o Hermes vai buscar.

set -uo pipefail

API_URL="${API_URL:-http://localhost:3001}"
FAILED=0

for v in v1 v2; do
  curl -s -X POST "${API_URL}/${v}/config" \
    -H 'content-type: application/json' -d '{"reset":true}' > /dev/null

  status=$(curl -s "${API_URL}/${v}/status")
  rate=$(echo "$status" | jq -r .failureRate)
  crashed=$(echo "$status" | jq -r .crashed)
  health=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/${v}/health")

  printf '%s: failureRate=%s crashed=%s health=%s ' "$v" "$rate" "$crashed" "$health"

  if [ "$rate" = "0.5" ] && [ "$crashed" = "false" ] && [ "$health" = "200" ]; then
    printf '\033[32mOK\033[0m\n'
  else
    printf '\033[31mFORA DO BASELINE\033[0m\n'
    FAILED=1
  fi
done

if [ "$FAILED" -eq 0 ]; then
  printf '\n\033[32mBaseline restaurado. Pode subir ao palco.\033[0m\n'
else
  printf '\n\033[31mAlgo ficou fora do baseline — conferir antes da live.\033[0m\n'
  exit 1
fi
