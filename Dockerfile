# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY packages/backend/package.json  ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN npm ci

# Build
COPY packages/shared   ./packages/shared
COPY packages/backend  ./packages/backend
COPY packages/frontend ./packages/frontend
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Non-root user
RUN addgroup -S dave && adduser -S dave -G dave

# Copy backend bundle and frontend SPA
COPY --from=builder /app/packages/backend/dist/server.js  ./server.js
COPY --from=builder /app/packages/frontend/dist           ./public

# Persistent volume for SQLite session store
RUN mkdir -p /data && chown dave:dave /data
VOLUME ["/data"]

USER dave
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "server.js"]
