# ── Stage 1: build ────────────────────────────────────────────────────────────
# node:22-alpine — LTS; node:sqlite is stable in 22.12+, no extra flag needed.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY packages/backend/package.json  ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN npm ci

COPY packages/shared   ./packages/shared
COPY packages/backend  ./packages/backend
COPY packages/frontend ./packages/frontend
RUN npm run build

# Strip devDependencies so only production node_modules are copied to the
# runtime stage. tsdav and other npm deps are loaded at runtime via ESM
# imports in the compiled bundle (tsup bundles local TS but keeps npm
# packages as external imports — they must be present in node_modules).
RUN npm prune --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Non-root user
RUN addgroup -S dave && adduser -S dave -G dave

# Production node_modules — required because the backend bundle imports npm
# packages (fastify, tsdav, ical.js, etc.) as external ESM modules.
COPY --from=builder /app/node_modules ./node_modules

# Root package.json — Node uses "type":"module" here to parse server.js as ESM.
COPY --from=builder /app/package.json ./package.json

# Backend compiled bundle (local TS and @dave/shared are inlined by tsup;
# npm deps are resolved from node_modules above).
COPY --from=builder /app/packages/backend/dist/server.js ./server.js

# Frontend SPA served as static files.
COPY --from=builder /app/packages/frontend/dist ./public

# Persistent volume for the SQLite session and cache stores.
RUN mkdir -p /data && chown dave:dave /data
VOLUME ["/data"]

USER dave
EXPOSE 3000

# Shell-form CMD is not substituted at build time, so ${PORT} is expanded by the
# container's shell on every probe — the check follows whatever port the app was
# told to bind (config.PORT), instead of assuming 3000.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/healthz || exit 1

CMD ["node", "server.js"]
