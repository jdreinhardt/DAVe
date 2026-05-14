# DAVe — Baikal Web Client

A self-hosted web client for [Baikal](https://sabre.io/baikal/) (CalDAV + CardDAV). Replaces InfCloud with a modern, easy-to-deploy stack.

**Stack:** Node 20 · Fastify · React 19 · Vite · Tailwind v4 · TypeScript  
**DAV:** [tsdav](https://github.com/natelindev/tsdav) · [ical.js](https://github.com/kewisch/ical.js) · vcard4

---

## Quick start (development)

```bash
# 1. Clone and install
git clone <repo> dave && cd dave
npm install

# 2. Spin up app + Baikal
docker compose -f docker-compose.dev.yml up -d

# 3. Complete the Baikal first-run wizard
open http://localhost:8800/admin/
# Set an admin password, then save the system config page.

# 4. Seed a test user + collections
./scripts/seed.sh

# 5. Open the app
open http://localhost:5173
```

The dev compose bind-mounts the source directory. Backend changes restart via `tsx watch`; frontend changes are applied instantly via Vite HMR. No rebuild needed.

### Without Docker (local Node)

```bash
npm install
cp .env.example .env
# Edit .env — set BAIKAL_BASE_URL to your Baikal instance.
npm run dev
# Backend → http://localhost:3000
# Frontend → http://localhost:5173
```

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in:

| Variable | Required | Default | Description |
|---|---|---|---|
| `BAIKAL_BASE_URL` | Yes | — | Root URL of the Baikal DAV endpoint, e.g. `https://baikal.example.com/dav.php` |
| `SESSION_SECRET` | Yes | — | Random secret ≥ 32 chars for encrypting session credentials. Generate: `openssl rand -hex 32` |
| `SESSION_TTL_HOURS` | No | `168` | Session inactivity timeout (sliding window). Default = 7 days. |
| `PORT` | No | `3000` | Port to listen on |
| `BIND_ADDRESS` | No | `0.0.0.0` | Address to bind |
| `TRUST_PROXY` | No | `0` | Set to `1` when running behind a reverse proxy |

---

## Production deployment

### Docker Compose

```bash
cp .env.example .env
# Fill in BAIKAL_BASE_URL, SESSION_SECRET, etc.
docker compose up -d
```

The production image is built from a multi-stage `Dockerfile`. Session data is stored in a named Docker volume (`data`) mounted at `/data`. Logins persist across container restarts.

The container listens on HTTP only. Terminate TLS at a reverse proxy.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name dave.example.com;

    ssl_certificate     /etc/ssl/certs/dave.crt;
    ssl_certificate_key /etc/ssl/private/dave.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set `TRUST_PROXY=1` in `.env` when using a reverse proxy.

### Caddy

```caddyfile
dave.example.com {
    reverse_proxy localhost:3000
}
```

Caddy handles TLS automatically. Set `TRUST_PROXY=1`.

---

## Common commands

```bash
npm run dev          # Start backend + frontend dev servers
npm run build        # Production build (backend bundle + frontend SPA)
npm test             # Unit tests
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit across all packages

docker compose -f docker-compose.dev.yml up -d   # Dev stack (app + Baikal)
docker compose -f docker-compose.dev.yml down -v  # Tear down + remove volumes
./scripts/seed.sh                                 # Seed Baikal with test data
```

---

## Project structure

```
packages/
  shared/     TypeScript types shared between frontend and backend
  backend/    Fastify server — proxies CalDAV/CardDAV, serves the SPA
  frontend/   React SPA (Vite + Tailwind)
scripts/
  seed.sh     Populate dev Baikal with a test user + collections
Dockerfile         Production multi-stage build
Dockerfile.dev     Development image (source bind-mounted)
docker-compose.yml           Production compose (app only)
docker-compose.dev.yml       Dev compose (app + Baikal + hot reload)
```
