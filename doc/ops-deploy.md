# Deployment Guide (Ubuntu VPS)

This document describes how to deploy the dashboard API and web app on an Ubuntu VPS using systemd, Nginx, and PostgreSQL/Redis.

## Prerequisites

- Ubuntu 22.04+ with sudo access
- Node.js 20.x and npm installed
- PostgreSQL running and reachable (`DATABASE_URL` set) or provisioned via Docker Compose
- Redis running and reachable (`REDIS_URL` set) or provisioned via Docker Compose
- TLS certs available (e.g., via Let's Encrypt)

## Local Redis (dev)

Run local services so dev matches production:

```
npm run dev:services
```

This starts Postgres on `localhost:5434` and Redis on `localhost:6379`.

## Environment file

Create `/etc/obd2-dashboard.env` (0600, root-owned) with:

```
NODE_ENV=production
PORT=3000
POSTGRES_DB=obd2_dashboard
POSTGRES_USER=obd2_user
POSTGRES_PASSWORD=change-me
POSTGRES_PORT=5432
REDIS_PORT=6379
DATABASE_URL=postgresql://obd2_user:change-me@localhost:5432/obd2_dashboard
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

## Data services (Postgres + Redis via Docker Compose)

If you are not using managed Postgres/Redis, start the local services stack:

```
cd /opt/obd2-dashboard
sudo docker compose -f infra/docker-compose.ops.yml --env-file /etc/obd2-dashboard.env up -d
sudo docker compose -f infra/docker-compose.ops.yml --env-file /etc/obd2-dashboard.env ps
```

## Database migrations

```
cd /opt/obd2-dashboard
npx prisma migrate deploy --schema=prisma/schema.prisma
```

### Creating new migrations (dev)

Create migrations in a dev environment and commit them:

```
cd /opt/obd2-dashboard
npx prisma migrate dev --schema=prisma/schema.prisma --name <migration_name>
```

### Applying migrations (VPS)

Before applying migrations on the VPS, take a backup, then run deploy:

```
pg_dump "$DATABASE_URL" > /var/backups/obd2-dashboard-$(date +%F-%H%M%S).sql
cd /opt/obd2-dashboard
npx prisma migrate deploy --schema=prisma/schema.prisma
```

If Redis schema metadata is used, re-run the bootstrap:

```
npm run redis:bootstrap --workspace apps/dashboard-api
```

## Redis bootstrap

Run the Redis bootstrap script after migrations to initialize schema metadata:

```
cd /opt/obd2-dashboard
npm run redis:bootstrap --workspace apps/dashboard-api
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

## Admin UI (Postgres + Redis)

To enable the OAuth-protected pgAdmin and RedisInsight UIs under `/db` and
`/redis`, follow `doc/admin-ui.md`.

## Backups and rollback

Daily backups use restic + Backblaze B2. Follow `doc/ops-backups.md` to set up
the timers and restic repository.

Before migrations on the VPS, trigger a fresh backup:

```
sudo systemctl start obd2-dashboard-backup.service
```

To roll back, restore from the latest snapshot as documented in
`doc/ops-backups.md`, then redeploy the previous app build.

## CI/CD (GitHub Actions)

A workflow in `.github/workflows/ci.yml` runs tests on push/PR. It also includes a `workflow_dispatch` deploy job that builds, ships artifacts over SSH, runs `prisma migrate deploy`, and restarts systemd—configure secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY`, and `DEPLOY_PATH` to use it. Adjust commands to match your VPS setup.
