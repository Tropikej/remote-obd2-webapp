# Ops, CI/CD, and Observability

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the dashboard can be deployed on a VPS with automated builds, migrations, systemd services, Nginx reverse proxy, backups, and basic observability. Operators can deploy safely, roll back using backups, and monitor health endpoints. You can see it working by running the GitHub Actions workflow, deploying to a staging VPS, and verifying that `/healthz` and `/readyz` return healthy responses.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-24 15:35Z) Add systemd service units and environment file conventions.
- [x] (2025-12-24 15:35Z) Configure Nginx for HTTPS, WS, and SSE with correct buffering and timeouts.
- [x] (2025-12-24 15:35Z) Implement health and readiness endpoints in the API.
- [x] (2025-12-24 15:35Z) Add GitHub Actions workflow for build, deploy, and migrations.
- [x] (2025-12-24 15:35Z) Document backup and rollback procedures and verify restore (documented; staging run pending).
- [x] (2025-12-24 15:35Z) Add Redis setup guidance (local/staging/prod), include `REDIS_URL` in env files, and validate `/readyz` covers Redis.
- [ ] (2025-12-24 16:15Z) Wire CI/CD to auto-deploy on push to `main` using VPS secrets (SSH_HOST/USER/KEY, DEPLOY_PATH, DATABASE_URL, REDIS_URL); validate end-to-end by pushing to a staging branch that mimics main and confirming systemd restart + migration execution on the configured VPS.
- [x] (2025-12-26 15:05Z) Add deployment steps for Postgres + Redis (system packages or Docker Compose), and ensure CI/CD provisions/updates data services and runs safe migrations and Redis bootstraps without destructive resets (no db wipe on push).

## Surprises & Discoveries

- Deploy job is workflow_dispatch-only to avoid failing without VPS secrets; set secrets before using.

## Decision Log

- Decision: Store secrets in `/etc/obd2-dashboard.env` with 0600 permissions and load via systemd EnvironmentFile.
  Rationale: The spec requires this path and it keeps secrets out of the repository.
  Date/Author: 2025-12-22 / Codex
- Decision: Use `prisma migrate deploy` in CI/CD and take a database backup immediately before migrations.
  Rationale: The spec mandates safe migrations and backups to enable rollbacks.
  Date/Author: 2025-12-22 / Codex
- Decision: Provision Postgres and Redis via Docker Compose with named volumes and localhost-only bindings.
  Rationale: It keeps data persistent across deploys while avoiding public exposure of data ports.
  Date/Author: 2025-12-26 / Codex

## Outcomes & Retrospective

Ops scaffolding is in place: systemd unit and env conventions under `infra/systemd`, full Nginx TLS/WS/SSE config under `infra/nginx`, health and readiness endpoints (`/healthz`, `/readyz`) validate Postgres and Redis connectivity, GitHub Actions workflow runs tests/build and provides a manual deploy job with migrations/restart, and deployment/backups are documented in `doc/ops-deploy.md`. Next step: execute a staging deploy to validate Nginx/systemd wiring and run a real pre-migration backup/restore drill.

## Context and Orientation

The dashboard is a monorepo with API, web UI, and Bridge Agent apps. The primary deployment target is a VPS running Ubuntu. Nginx terminates TLS and proxies to the API, including WebSocket and SSE routes. systemd runs the API process. Redis and Postgres run locally or as managed services. Deployment is performed by GitHub Actions that build, deploy, run migrations, and restart services.

Relevant files include `infra/systemd/`, `infra/nginx/`, and CI workflows under `.github/workflows/`. The API must expose `/healthz` and `/readyz` endpoints.

## Plan of Work

Create systemd unit files for the API service and any background job services. The unit should run the built API with the environment file loaded, restart on failure, and log to journald. Provide a clear install script or documentation to enable and start the service.

Create Nginx configuration that terminates TLS, proxies `/api` to the API service, and supports WebSocket and SSE. Disable proxy buffering for SSE routes and increase timeouts for long lived connections. Set `X-Request-ID` on incoming requests if missing.

Add health and readiness endpoints to the API. `/healthz` should return HTTP 200 when the process is running and dependencies like the database and Redis are reachable. `/readyz` should verify that migrations are applied and the API can handle requests.

Create a GitHub Actions workflow that runs lint and tests, builds artifacts, deploys to the VPS, runs `prisma migrate deploy`, and restarts systemd services. Add steps to create a pre migration `pg_dump` backup and store it on the VPS with retention.

Document backup and restore procedures, including a monthly manual restore test. Provide a rollback strategy that restores the database backup and redeploys the previous app version.

Add Redis setup guidance and parity:
- Local dev: run `docker run -p 6379:6379 redis:7` and set `REDIS_URL=redis://localhost:6379` for realistic tests; fallback mock is only for unit/local quick runs.
- Staging/prod: install Redis as a system service or use managed Redis; add `REDIS_URL` to `/etc/obd2-dashboard.env` next to `DATABASE_URL`/`SESSION_SECRET`.
- Extend `/healthz`/`/readyz` to fail when Redis is unreachable so ops can detect misconfiguration early.

Add a data services deployment step that provisions Postgres and Redis on the VPS in a way that survives redeploys. Prefer a `infra/docker-compose.ops.yml` file with named volumes and explicit versions (for example `postgres:16` and `redis:7`), and bind ports to localhost only so they are not publicly exposed. The CI/CD deploy step should ensure the compose stack is running before migrations and service restarts, and it must never call `prisma migrate reset` or `prisma db push` in production.

Define a Redis bootstrap step that creates any required streams or keys and records a schema version in Redis. Make it runnable in CI/CD (for example, a node script invoked via `npm run redis:bootstrap`), and ensure it is safe to run multiple times without deleting existing data.

## Concrete Steps

Add systemd unit templates under `infra/systemd` for `obd2-dashboard-api.service`. Include `EnvironmentFile=/etc/obd2-dashboard.env` and set `WorkingDirectory` to the API directory. Add instructions in a new `doc/ops-deploy.md` file describing how to install and enable the service.

Add Nginx configuration under `infra/nginx/obd2-dashboard.conf` with server blocks for HTTPS and redirect from HTTP. Configure proxy headers for WebSocket and SSE, and set `proxy_buffering off` for `/api/v1/streams` routes.

Add `apps/dashboard-api/src/routes/health.ts` and wire it into the API. The handler should query Postgres and Redis and return a JSON object describing status.

Create `.github/workflows/deploy.yml` with steps for build and deployment. Use secrets for SSH credentials and ensure no application secrets are stored in GitHub.

Add `infra/docker-compose.ops.yml` to define Postgres and Redis for the VPS. Use named volumes for persistence, create the initial database/user via environment variables, and bind Postgres and Redis to `127.0.0.1` ports so only the local host can reach them. Update the deploy job to run `docker compose -f infra/docker-compose.ops.yml up -d` before running `prisma migrate deploy`. Add a Redis bootstrap command to the deploy job that runs after Redis is healthy and before the API is restarted.

## Validation and Acceptance

Deploy to a staging VPS and verify that the systemd service is active, Nginx is serving HTTPS, and API endpoints respond. Use `curl https://host/healthz` and expect HTTP 200 with a JSON body containing `db: ok` and `redis: ok`. Confirm SSE endpoints keep connections open and that WebSocket connections are upgraded correctly. Verify that a migration can be applied and that a backup file exists and can be restored into a staging database.

Verify the data services do not wipe data across deploys by inserting a test row into the database, deploying again, and confirming the row still exists. For Redis, create a test key and ensure it remains after a deploy. Confirm that Redis bootstrap is idempotent by re-running the bootstrap command and verifying it does not delete or reset existing keys.

## Idempotence and Recovery

Systemd and Nginx configs are safe to re apply. Backups should be created before each migration so rollback is possible. If a deploy fails after migration, roll back the application by redeploying the previous artifact and restore the pre migration backup if needed.

Docker Compose for Postgres and Redis should be idempotent; `docker compose up -d` can be run repeatedly without data loss because the volumes are persistent. If migrations fail, restore the backup and do not run migrations again until the issue is fixed.

## Artifacts and Notes

Example systemd service excerpt:

    [Service]
    EnvironmentFile=/etc/obd2-dashboard.env
    WorkingDirectory=/opt/obd2-dashboard/apps/dashboard-api
    ExecStart=/usr/bin/node dist/server.js

## Interfaces and Dependencies

The API must expose `GET /healthz` and `GET /readyz` in `apps/dashboard-api/src/routes/health.ts` and register them in the Express router. The deployment workflow depends on `prisma migrate deploy` and the build output path for the API and web app, which should be documented in `doc/ops-deploy.md`.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
Plan change note: Expanded to include Postgres/Redis deployment and non-destructive data service updates in CI/CD on 2025-12-26.
Plan change note: Marked data services deployment task complete after implementing Docker Compose + Redis bootstrap wiring on 2025-12-26.
