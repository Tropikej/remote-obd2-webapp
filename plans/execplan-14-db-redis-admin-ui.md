# Secure Postgres and Redis Admin UIs

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, operators can safely access graphical admin tools for both Postgres and Redis by visiting `https://baltringuelabs.cam/db` and `https://baltringuelabs.cam/redis`. Access is protected by strong authentication using OAuth2 (GitHub login with an allowlist), and the admin tools are not exposed on public ports. You can see it working by visiting `/db` or `/redis`, completing GitHub login, and landing in the respective UI without any public access to the raw service ports.

## Progress

- [x] (2025-12-26 14:10Z) Draft initial plan for secure Postgres and Redis admin UIs.
- [ ] (2025-12-26 14:10Z) Prototype path-based routing for the selected UIs and confirm assets load under `/db` and `/redis`.
- [ ] (2025-12-26 14:10Z) Add a docker compose admin stack with oauth2-proxy and the two admin UIs bound to localhost only.
- [ ] (2025-12-26 14:10Z) Update Nginx, add documentation, and validate authentication and access controls.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Use oauth2-proxy with GitHub OAuth and an email allowlist as the primary authentication layer for admin UIs.
  Rationale: It provides strong identity-based access control and integrates with existing GitHub accounts.
  Date/Author: 2025-12-26 / Codex
- Decision: Run Postgres and Redis admin UIs in Docker containers bound to localhost and only exposed via Nginx.
  Rationale: It prevents direct public access to data services and keeps admin access centralized and auditable.
  Date/Author: 2025-12-26 / Codex

## Outcomes & Retrospective

Not implemented yet. No outcomes to report.

## Context and Orientation

The dashboard runs on an Ubuntu VPS with Nginx terminating TLS and proxying to the API. Nginx configuration lives in `infra/nginx/obd2-dashboard.conf`. The existing ops documentation is in `doc/ops-deploy.md`, and data services are provisioned by Docker Compose under `infra/docker-compose.ops.yml` as described in `plans/execplan-10-ops-ci-observability.md`. This plan adds a secure admin surface for Postgres and Redis without exposing ports publicly.

The plan introduces three new containers on the VPS: `oauth2-proxy` for authentication, a Postgres GUI (pgAdmin 4), and a Redis GUI (RedisInsight). The containers will only bind to `127.0.0.1` so that access is only possible through Nginx. The `/db` and `/redis` paths on `baltringuelabs.cam` will be protected with `auth_request` so the browser must be authenticated before reaching the UI.

## Plan of Work

First, validate that the chosen admin UIs can be served behind a path prefix. Stand up the containers locally or on the VPS, add an Nginx reverse proxy with `/db/` and `/redis/`, and confirm assets and navigation work. If a UI cannot be hosted under a subpath, keep `/db` or `/redis` as a redirect to a dedicated admin subpath such as `/admin/db` while still meeting the requirement that the operator can reach the UI by visiting `baltringuelabs.cam/db` or `baltringuelabs.cam/redis`.

Next, create a dedicated admin Docker Compose file at `infra/docker-compose.admin.yml` that defines `oauth2-proxy`, `pgadmin`, and `redisinsight`. The compose file should bind ports to `127.0.0.1` only. Create a new environment file at `/etc/obd2-dashboard-admin.env` on the VPS containing OAuth and admin UI secrets such as `OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET`, `OAUTH2_PROXY_COOKIE_SECRET`, `OAUTH2_PROXY_ALLOWED_EMAILS`, and the pgAdmin admin credentials. The cookie secret should be a 32-byte base64 value generated with `openssl rand -base64 32`.

Then, update `infra/nginx/obd2-dashboard.conf` to add `location /db/` and `location /redis/` blocks. Each block should use `auth_request` to `/oauth2/auth`, proxy to the corresponding localhost port for pgAdmin or RedisInsight, and pass through `X-Forwarded-User` and `X-Auth-Request-Email` headers from oauth2-proxy so the UI can log access if needed. Add the standard oauth2-proxy endpoints under `/oauth2/` and ensure the callback URL matches `https://baltringuelabs.cam/oauth2/callback`.

Finally, document the setup in a new file such as `doc/admin-ui.md`, including how to rotate the OAuth client secret and pgAdmin password, how to add or remove allowed emails, and how to disable the admin UI if needed. Update `doc/ci-secrets.md` only if the admin stack requires new GitHub Action secrets for deployment.

## Concrete Steps

From the repository root on the VPS, create the admin compose file and start the stack:

    cd /opt/obd2-dashboard
    sudo cp infra/docker-compose.admin.yml /opt/obd2-dashboard/infra/docker-compose.admin.yml
    sudo docker compose -f infra/docker-compose.admin.yml --env-file /etc/obd2-dashboard-admin.env up -d
    sudo docker compose -f infra/docker-compose.admin.yml ps

Generate the oauth2-proxy cookie secret and add it to `/etc/obd2-dashboard-admin.env`:

    openssl rand -base64 32

Reload Nginx after updating `infra/nginx/obd2-dashboard.conf` and installing it:

    sudo nginx -t
    sudo systemctl reload nginx

## Validation and Acceptance

Visiting `https://baltringuelabs.cam/db` or `https://baltringuelabs.cam/redis` should redirect to the GitHub OAuth login screen. After authenticating with an allowlisted account, the respective UI should load successfully. Direct access to the admin UI ports (for example, `http://85.208.110.83:5050`) should not be possible because the containers bind to `127.0.0.1` only. A curl check should show that unauthenticated requests receive a 302 redirect to `/oauth2/start`.

## Idempotence and Recovery

Re-running `docker compose up -d` for the admin stack should be safe and should not reset data. If the admin UI must be disabled, stop and remove the admin compose stack and remove the Nginx `/db` and `/redis` locations, then reload Nginx.

## Artifacts and Notes

Example oauth2-proxy environment values:

    OAUTH2_PROXY_PROVIDER=github
    OAUTH2_PROXY_CLIENT_ID=...
    OAUTH2_PROXY_CLIENT_SECRET=...
    OAUTH2_PROXY_COOKIE_SECRET=... (base64 32 bytes)
    OAUTH2_PROXY_ALLOWED_EMAILS=admin@example.com
    OAUTH2_PROXY_COOKIE_SECURE=true
    OAUTH2_PROXY_COOKIE_SAMESITE=lax

Example Nginx location block outline:

    location /db/ {
        auth_request /oauth2/auth;
        error_page 401 = /oauth2/start;
        proxy_pass http://127.0.0.1:5050/;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }

## Interfaces and Dependencies

Add `infra/docker-compose.admin.yml` defining `oauth2-proxy`, `dpage/pgadmin4`, and `redis/redisinsight` services. Update `infra/nginx/obd2-dashboard.conf` to proxy `/db/`, `/redis/`, and `/oauth2/` to the local admin services and oauth2-proxy. Create `/etc/obd2-dashboard-admin.env` on the VPS with OAuth secrets and admin UI credentials. The oauth2-proxy container must be configured to allow only known emails and to use secure cookies over HTTPS.

Plan change note: Initial version created on 2025-12-26 to add secure Postgres and Redis admin UIs behind OAuth authentication.
