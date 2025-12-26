# Deployment Guide (Ubuntu VPS)

This document describes how to deploy the dashboard API and web app on an Ubuntu VPS using systemd, Nginx, and PostgreSQL/Redis.

## Prerequisites

- Ubuntu 22.04+ with sudo access
- Node.js 20.x and npm installed
- PostgreSQL running and reachable (`DATABASE_URL` set)
- Redis running and reachable (`REDIS_URL` set)
- TLS certs available (e.g., via Let's Encrypt)

## Environment file

Create `/etc/obd2-dashboard.env` (0600, root-owned) with:

```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/obd2_dashboard
REDIS_URL=redis://localhost:6379
SESSION_SECRET=change-me
DONGLE_TOKEN_MASTER_KEY_V1=base64_32_bytes
```

Add any SMTP or future secrets as needed.

## Build and install

```
sudo mkdir -p /opt/obd2-dashboard
sudo chown $USER:$USER /opt/obd2-dashboard
git clone <repo> /opt/obd2-dashboard
cd /opt/obd2-dashboard
npm ci
npm run build
```

## Database migrations

```
cd /opt/obd2-dashboard
npx prisma migrate deploy --schema=apps/dashboard-api/prisma/schema.prisma
```

## systemd

Copy `infra/systemd/obd2-dashboard-api.service` to `/etc/systemd/system/`, adjust `WorkingDirectory` if needed, then:

```
sudo systemctl daemon-reload
sudo systemctl enable obd2-dashboard-api
sudo systemctl start obd2-dashboard-api
```

Logs:

```
journalctl -u obd2-dashboard-api -f
```

## Nginx

Use `infra/nginx/obd2-dashboard.conf` (TLS + WS/SSE) or `infra/nginx/streams.conf` for SSE-only snippet. Replace `your.domain` and cert paths. Enable the site and reload Nginx.

Key locations:
- `/api` → API (proxy buffering off for `/api/v1/streams/**`)
- `/ws/agent` and `/ws/data` → WebSocket upgrade paths

## Backups and rollback (outline)

- Before migrations, run `pg_dump "$DATABASE_URL" > /var/backups/obd2-dashboard-$(date +%F-%H%M%S).sql`.
- Retain backups with rotation (e.g., cron + logrotate).
- To roll back, restore the dump to the database and redeploy the previous app build.

## CI/CD (GitHub Actions)

A workflow in `.github/workflows/ci.yml` runs tests on push/PR. It also includes a `workflow_dispatch` deploy job that builds, ships artifacts over SSH, runs `prisma migrate deploy`, and restarts systemd—configure secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY`, and `DEPLOY_PATH` to use it. Adjust commands to match your VPS setup.
