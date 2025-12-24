# Ops, CI/CD, and Observability

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the dashboard can be deployed on a VPS with automated builds, migrations, systemd services, Nginx reverse proxy, backups, and basic observability. Operators can deploy safely, roll back using backups, and monitor health endpoints. You can see it working by running the GitHub Actions workflow, deploying to a staging VPS, and verifying that `/healthz` and `/readyz` return healthy responses.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [ ] Add systemd service units and environment file conventions.
- [ ] Configure Nginx for HTTPS, WS, and SSE with correct buffering and timeouts.
- [ ] Implement health and readiness endpoints in the API.
- [ ] Add GitHub Actions workflow for build, deploy, and migrations.
- [ ] Document backup and rollback procedures and verify restore.
- [ ] Add Redis setup guidance (local/staging/prod), include `REDIS_URL` in env files, and validate `/healthz` covers Redis.
- [ ] Add Redis setup guidance (local/staging/prod), include `REDIS_URL` in env files, and validate `/healthz` covers Redis.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Store secrets in `/etc/obd2-dashboard.env` with 0600 permissions and load via systemd EnvironmentFile.
  Rationale: The spec requires this path and it keeps secrets out of the repository.
  Date/Author: 2025-12-22 / Codex
- Decision: Use `prisma migrate deploy` in CI/CD and take a database backup immediately before migrations.
  Rationale: The spec mandates safe migrations and backups to enable rollbacks.
  Date/Author: 2025-12-22 / Codex

## Outcomes & Retrospective

Not started yet. This section will summarize deployment and ops readiness once implemented.

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

## Concrete Steps

Add systemd unit templates under `infra/systemd` for `obd2-dashboard-api.service`. Include `EnvironmentFile=/etc/obd2-dashboard.env` and set `WorkingDirectory` to the API directory. Add instructions in a new `doc/ops-deploy.md` file describing how to install and enable the service.

Add Nginx configuration under `infra/nginx/obd2-dashboard.conf` with server blocks for HTTPS and redirect from HTTP. Configure proxy headers for WebSocket and SSE, and set `proxy_buffering off` for `/api/v1/streams` routes.

Add `apps/dashboard-api/src/routes/health.ts` and wire it into the API. The handler should query Postgres and Redis and return a JSON object describing status.

Create `.github/workflows/deploy.yml` with steps for build and deployment. Use secrets for SSH credentials and ensure no application secrets are stored in GitHub.

## Validation and Acceptance

Deploy to a staging VPS and verify that the systemd service is active, Nginx is serving HTTPS, and API endpoints respond. Use `curl https://host/healthz` and expect HTTP 200 with a JSON body containing `db: ok` and `redis: ok`. Confirm SSE endpoints keep connections open and that WebSocket connections are upgraded correctly. Verify that a migration can be applied and that a backup file exists and can be restored into a staging database.

## Idempotence and Recovery

Systemd and Nginx configs are safe to re apply. Backups should be created before each migration so rollback is possible. If a deploy fails after migration, roll back the application by redeploying the previous artifact and restore the pre migration backup if needed.

## Artifacts and Notes

Example systemd service excerpt:

    [Service]
    EnvironmentFile=/etc/obd2-dashboard.env
    WorkingDirectory=/opt/obd2-dashboard/apps/dashboard-api
    ExecStart=/usr/bin/node dist/server.js

## Interfaces and Dependencies

The API must expose `GET /healthz` and `GET /readyz` in `apps/dashboard-api/src/routes/health.ts` and register them in the Express router. The deployment workflow depends on `prisma migrate deploy` and the build output path for the API and web app, which should be documented in `doc/ops-deploy.md`.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
