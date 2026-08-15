# Contexto de build e a RAIZ do monorepo (`context: .` no compose).
FROM node:22-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
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
# O web importa `@hermes/database/catalog`, que o exports map aponta para o .ts
# cru — transpilePackages compila. Ou seja: NENHUM prisma generate aqui, e o
# @prisma/client nunca entra no bundle do Next.
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY packages/database packages/database
COPY apps/web apps/web
RUN npm run build --workspace @hermes/web

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

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
