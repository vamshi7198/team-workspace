# syntax=docker/dockerfile:1
# Multi-stage build: dependencies -> build -> small runtime image (non-root).

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ holds no files yet and git doesn't keep empty folders; the runner stage copies it.
RUN mkdir -p public && npm run build
# Self-contained scripts for migrations and first-run setup (run inside the container).
RUN npx esbuild scripts/migrate.ts --bundle --platform=node --target=node24 --outfile=dist/migrate.cjs \
 && npx esbuild scripts/setup.ts --bundle --platform=node --target=node24 --outfile=dist/setup.cjs \
      --alias:server-only=./tests/server-only-stub.ts --tsconfig=tsconfig.json --conditions=react-server

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_DIR=/data/uploads MIGRATIONS_DIR=/app/drizzle
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data/uploads && chown -R app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app docker-entrypoint.sh ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
