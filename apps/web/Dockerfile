# Contexto de build e a RAIZ do monorepo (`context: .` no compose).
FROM node:22-slim AS base
# openssl entrou junto com o Prisma no web: o engine do Prisma linka contra ele.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --------------------------------------------------------------------- deps
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
RUN npm ci

# -------------------------------------------------------------------- build
# ATENCAO: isto MUDOU. O web nao importa mais so `@hermes/database/catalog`
# (constantes puras) — ele agora fala com o Postgres para sessao e admins, entao
# PRECISA do client gerado do Prisma. `npm run build --workspace @hermes/database`
# faz `prisma generate` + `tsc`, nessa ordem, e tem que rodar ANTES do build do
# Next. Nao remova achando que e sobra do passado.
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY packages/database packages/database
COPY apps/web apps/web
RUN npm run build --workspace @hermes/database \
  && npm run build --workspace @hermes/web

# ------------------------------------------------------------------- runner
FROM base AS runner
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3000 \
  HOSTNAME=0.0.0.0
WORKDIR /app

# outputFileTracingRoot aponta para a raiz do monorepo, entao o layout
# standalone e apps/web/server.js (e nao server.js na raiz).
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# Rede de seguranca para os engines do Prisma: se o tracer do Next deixar algum
# de fora, esta copia resolve. Idempotente com o outputFileTracingIncludes do
# next.config.mjs — os dois apontam para o mesmo diretorio de proposito.
COPY --from=build /app/packages/database/generated ./packages/database/generated

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
