#!/bin/sh
# Migrar no start, nao manualmente: na VPS do Coolify voce pode nao ter um shell
# confortavel, e `npm run seed` cru no host nao funciona la (sem node_modules,
# sem DATABASE_URL). Com isto, `docker compose up -d` basta.
set -e

SCHEMA=/app/packages/database/prisma/schema.prisma
PRISMA=/app/node_modules/.bin/prisma
LOG_TARGET="${LOG_FILE:-/var/log/app/api.log}"

mkdir -p "$(dirname "$LOG_TARGET")"

echo "[entrypoint] aplicando migrations..."
attempt=0
until "$PRISMA" migrate deploy --schema "$SCHEMA"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then
    echo "[entrypoint] migrate deploy falhou $attempt vezes; tentando db push"
    if "$PRISMA" db push --schema "$SCHEMA" --accept-data-loss --skip-generate; then
      break
    fi
    echo "[entrypoint] db push tambem falhou — abortando"
    exit 1
  fi
  echo "[entrypoint] tentativa $attempt falhou; aguardando 2s"
  sleep 2
done

if [ "${SEED_ON_BOOT:-false}" = "true" ]; then
  echo "[entrypoint] seed idempotente..."
  node /app/packages/database/dist/seed.js || echo "[entrypoint] seed falhou (seguindo mesmo assim)"
fi

echo "[entrypoint] subindo checkout-api"
exec "$@"
