# syntax=docker/dockerfile:1.7
# Imagem de produção do Factoria SaaS (Next.js standalone). Build no GitHub Actions.

FROM node:22-alpine AS base
# libc6-compat: binários nativos (SWC do Next, Tailwind/lightningcss) — mesmo que o exemplo oficial do Next.js
RUN apk add --no-cache libc6-compat && corepack enable
WORKDIR /app

# 1) Dependências (camada em cache enquanto o lockfile não muda)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# 2) Build do app + scripts de operação (migrate, bootstrap-admin)
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build && pnpm build:scripts

# 3) Runtime mínimo: só o necessário, usuário sem privilégios
FROM node:22-alpine AS run
RUN apk add --no-cache libc6-compat
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION}
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist-scripts ./dist-scripts
COPY --from=build --chown=node:node /app/lib/db/migrations ./lib/db/migrations
USER node
EXPOSE 3000
CMD ["node", "server.js"]
