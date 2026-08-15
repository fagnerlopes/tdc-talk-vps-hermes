# Contexto de build e a RAIZ do monorepo (`context: .` no compose).
# `build: ./apps/api` nao enxergaria packages/database e quebraria o npm ci.

# node:22-slim (Debian), nao Alpine: Prisma em musl precisa dos engines
# linux-musl-openssl-3.0.x e quebra periodicamente. Debian + openssl e chato e
# funciona. Tamanho de imagem e irrelevante numa demo de uma noite.
FROM node:22-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --------------------------------------------------------------------- deps
# O stage deps precisa do package.json de TODOS os workspaces antes do npm ci.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
RUN npm ci

# -------------------------------------------------------------------- build
# Nada de `postinstall: prisma generate` — o npm ci roda antes do schema ser
# copiado. Geramos explicitamente aqui.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/database packages/database
COPY apps/api apps/api
RUN npm run build --workspace @hermes/database \
  && npm run build --workspace @hermes/api

# ------------------------------------------------------------------- runner
# Sem `npm prune --production`: o entrypoint chama o CLI do Prisma
# (migrate deploy), que vive em devDependencies.
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/database/package.json ./packages/database/package.json
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/database/generated ./packages/database/generated
COPY --from=build /app/packages/database/prisma ./packages/database/prisma

COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/server.js"]
