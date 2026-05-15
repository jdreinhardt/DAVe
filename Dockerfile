# ── Stage 1: build ────────────────────────────────────────────────────────────
# node:22-alpine — LTS; node:sqlite is stable in 22.12+, no extra flag needed.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY packages/backend/package.json  ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN npm ci

COPY packages/shared   ./packages/shared
COPY packages/backend  ./packages/backend
COPY packages/frontend ./packages/frontend
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Non-root user
RUN addgroup -S dave && adduser -S dave -G dave

# Backend is a self-contained ESM bundle (no node_modules needed at runtime
# because node:sqlite is built into Node and all other deps are bundled by tsup).
COPY --from=builder /app/packages/backend/dist/server.js  ./server.js

# Frontend SPA served as static files.
COPY --from=builder /app/packages/frontend/dist           ./public

# Persistent volume for the SQLite session store.
RUN mkdir -p /data && chown dave:dave /data
VOLUME ["/data"]

USER dave
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "server.js"]
