# Secure Postgres and Redis Admin UIs

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, operators can safely access graphical admin tools for both Postgres and Redis by visiting `https://baltringuelabs.cam/db` and `https://baltringuelabs.cam/redis`. Access is protected by strong authentication using OAuth2 (GitHub login with an allowlist), and the admin tools are not exposed on public ports. You can see it working by visiting `/db` or `/redis`, completing GitHub login, and landing in the respective UI without any public access to the raw service ports.

## Progress

- [x] (2025-12-26 14:10Z) Draft initial plan for secure Postgres and Redis admin UIs.
- [x] (2025-12-27 07:25Z) Prototype path-based routing for pgAdmin and RedisInsight in Docker; confirm assets load under `/db` and `/redis`.
- [x] (2025-12-27 07:25Z) Add a docker compose admin stack with oauth2-proxy, pgAdmin, and RedisInsight bound to localhost only.
- [x] (2025-12-27 07:25Z) Update Nginx config and add admin UI documentation + secrets guidance.
- [x] (2025-12-27 16:45Z) Validate authentication and access controls on the VPS (OAuth redirect, allowlist enforcement, pgAdmin login).

## Surprises & Discoveries

- Observation: pgAdmin supports subpath hosting via `SCRIPT_NAME` and `X-Script-Name` headers; requests to `/db/` return redirects scoped to `/db`.
  Evidence: local curl to `/db/` returned `Location: /db/login?next=/db/` with cookie `Path=/db`.
- Observation: RedisInsight supports subpath hosting via `RI_PROXY_PATH` and `RI_SOCKET_PROXY_PATH`, replacing `__RIPROXYPATH__` in its UI assets.
  Evidence: `ui/dist/index.html` and `api/dist/config/default.js` in the RedisInsight container reference `RI_PROXY_PATH` and `__RIPROXYPATH__`.
- Observation: oauth2-proxy enforces a 16/24/32 byte cookie secret; hex-encoded 16-byte values are accepted and avoid base64 length pitfalls.
  Evidence: oauth2-proxy logs reported `cookie_secret must be 16, 24, or 32 bytes` when the secret length was off; a 32-char hex (16-byte) value succeeded.
- Observation: the allowlist file must be readable by the container; 0600 caused permission errors.
  Evidence: oauth2-proxy reported `open /etc/oauth2-proxy/allowed-emails.txt: permission denied` until the allowlist was set to 0644.
- Observation: GitHub App credentials cannot access the `/user/emails` endpoint; oauth2-proxy requires an OAuth App.
  Evidence: oauth2-proxy returned `Resource not accessible by integration` when using GitHub App credentials.
- Observation: oauth2-proxy calls the GitHub orgs API and requires `read:org` scope.
  Evidence: oauth2-proxy returned `You need at least read:org scope or user scope to list your organizations` during OAuth callback until `read:org` was requested.
- Observation: pgAdmin returns CSRF host mismatch errors when it does not trust forwarded host/proto headers.
  Evidence: pgAdmin logged `The referrer does not match the host` until `PGADMIN_CONFIG_PROXY_X_HOST_COUNT=1` and `PGADMIN_CONFIG_PROXY_X_PROTO_COUNT=1` were set.

## Decision Log

- Decision: Use oauth2-proxy with GitHub OAuth and an email allowlist as the primary authentication layer for admin UIs.
  Rationale: It provides strong identity-based access control and integrates with existing GitHub accounts.
  Date/Author: 2025-12-26 / Codex
- Decision: Run Postgres and Redis admin UIs in Docker containers bound to localhost and only exposed via Nginx.
  Rationale: It prevents direct public access to data services and keeps admin access centralized and auditable.
  Date/Author: 2025-12-26 / Codex
- Decision: Use pgAdmin `SCRIPT_NAME` plus `X-Script-Name` headers, and RedisInsight `RI_PROXY_PATH`/`RI_SOCKET_PROXY_PATH`, to make `/db` and `/redis` subpaths work.
  Rationale: Both UIs natively support subpath hosting without brittle rewrite hacks.
  Date/Author: 2025-12-27 / Codex
- Decision: Implement the OAuth allowlist via `authenticated-emails-file` mounted into oauth2-proxy.
  Rationale: oauth2-proxy does not accept an inline email allowlist variable; the file-based allowlist is supported and reloadable.
  Date/Author: 2025-12-27 / Codex
- Decision: Use a 16-byte cookie secret rendered as 32 hex characters for oauth2-proxy.
  Rationale: oauth2-proxy strictly validates byte length; hex avoids base64 padding confusion while satisfying the 16/24/32 byte requirement.
  Date/Author: 2025-12-27 / Codex
- Decision: Store the allowlist file with 0644 permissions so the container can read it.
  Rationale: oauth2-proxy runs as a non-root user and cannot read a 0600 allowlist.
  Date/Author: 2025-12-27 / Codex
- Decision: Require GitHub OAuth App credentials (not GitHub App credentials) for oauth2-proxy.
  Rationale: oauth2-proxy uses the OAuth App flow and calls the email API endpoints that GitHub Apps cannot access.
  Date/Author: 2025-12-27 / Codex
- Decision: Include `read:org` in the oauth2-proxy GitHub scope.
  Rationale: oauth2-proxy queries the orgs API when building the session; without `read:org` GitHub returns 403.
  Date/Author: 2025-12-27 / Codex
- Decision: Configure pgAdmin to trust forwarded host/proto headers.
  Rationale: CSRF checks compare referrer to request host; without proxy header trust, pgAdmin rejects requests behind Nginx.
  Date/Author: 2025-12-27 / Codex

## Outcomes & Retrospective

Implemented the admin stack Compose file, Nginx routing, and documentation, validated local path-prefix behavior, and confirmed OAuth redirect + allowlist enforcement on the VPS. pgAdmin and RedisInsight are accessible behind `/db` and `/redis`, and the admin UIs are not exposed on public ports.

## Context and Orientation

The dashboard runs on an Ubuntu VPS with Nginx terminating TLS and proxying to the API. Nginx configuration lives in `infra/nginx/obd2-dashboard.conf`. The existing ops documentation is in `doc/ops-deploy.md`, and data services are provisioned by Docker Compose under `infra/docker-compose.ops.yml` as described in `plans/execplan-10-ops-ci-observability.md`. This plan adds a secure admin surface for Postgres and Redis without exposing ports publicly.

The plan introduces three new containers on the VPS: `oauth2-proxy` for authentication, a Postgres GUI (pgAdmin 4), and a Redis GUI (RedisInsight). The containers will only bind to `127.0.0.1` so that access is only possible through Nginx. The `/db` and `/redis` paths on `baltringuelabs.cam` will be protected with `auth_request` so the browser must be authenticated before reaching the UI.

## Plan of Work

First, validate that the chosen admin UIs can be served behind a path prefix. Stand up the containers locally or on the VPS, add an Nginx reverse proxy with `/db/` and `/redis/`, and confirm assets and navigation work. pgAdmin supports subpaths via `SCRIPT_NAME` and the `X-Script-Name` header, and RedisInsight supports subpaths via `RI_PROXY_PATH` and `RI_SOCKET_PROXY_PATH`, so no rewrite hacks are required.

Next, create a dedicated admin Docker Compose file at `infra/docker-compose.admin.yml` that defines `oauth2-proxy`, `pgadmin`, and `redisinsight`. The compose file should bind ports to `127.0.0.1` only. Create a new environment file at `/etc/obd2-dashboard-admin.env` on the VPS containing OAuth and admin UI secrets such as `OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET`, `OAUTH2_PROXY_COOKIE_SECRET`, `OAUTH2_PROXY_REDIRECT_URL`, `OAUTH2_PROXY_ALLOWED_EMAILS_FILE`, and the pgAdmin admin credentials. The client ID/secret must come from a GitHub OAuth App (not a GitHub App) with callback URL `https://baltringuelabs.cam/oauth2/callback`. The cookie secret must be a 16/24/32 byte value; use a 32-character hex value (`openssl rand -hex 16`) to satisfy oauth2-proxy.
Ensure the oauth2-proxy scope includes `read:org` alongside `read:user` and `user:email` so GitHub allows the orgs lookup during login.

Then, update `infra/nginx/obd2-dashboard.conf` to add `location /db/`, `location /redis/`, and `/oauth2/` blocks. Each admin block should use `auth_request` to `/oauth2/auth`, proxy to the corresponding localhost port for pgAdmin or RedisInsight, and pass through `X-Forwarded-User` and `X-Auth-Request-Email` headers from oauth2-proxy so the UI can log access if needed. For pgAdmin, send `X-Script-Name: /db` and keep the `/db` prefix in the upstream URI. For RedisInsight, keep the `/redis` prefix in the upstream URI and add a WebSocket-capable location for `/redis/socket.io/`. Ensure the callback URL matches `https://baltringuelabs.cam/oauth2/callback`.

Finally, document the setup in `doc/admin-ui.md`, including how to rotate the OAuth client secret and pgAdmin password, how to add or remove allowed emails in the allowlist file, and how to disable the admin UI if needed. Update `doc/ci-secrets.md` only if the admin stack requires new GitHub Action secrets for deployment.

## Concrete Steps

Create a GitHub OAuth App (not a GitHub App) and copy the client ID/secret. Set the callback URL to `https://baltringuelabs.cam/oauth2/callback`.

On the VPS, create the allowlist file and admin environment file (allowlist must be readable by the container):

    sudo install -m 0644 /dev/null /etc/obd2-dashboard-admin-allowlist.txt
    sudo tee /etc/obd2-dashboard-admin-allowlist.txt > /dev/null <<'EOF'
    admin@example.com
    second.admin@example.com
    EOF

Generate the oauth2-proxy cookie secret (32 hex characters = 16 bytes):

    openssl rand -hex 16

Create `/etc/obd2-dashboard-admin.env` with the OAuth settings and admin UI credentials, then start the stack:

    cd /opt/obd2-dashboard
    sudo docker compose -f infra/docker-compose.admin.yml --env-file /etc/obd2-dashboard-admin.env up -d
    sudo docker compose -f infra/docker-compose.admin.yml --env-file /etc/obd2-dashboard-admin.env ps

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
    OAUTH2_PROXY_COOKIE_SECRET=... (32 hex characters)
    OAUTH2_PROXY_REDIRECT_URL=https://baltringuelabs.cam/oauth2/callback
    OAUTH2_PROXY_ALLOWED_EMAILS_FILE=/etc/obd2-dashboard-admin-allowlist.txt
    OAUTH2_PROXY_COOKIE_SECURE=true
    OAUTH2_PROXY_COOKIE_SAMESITE=lax

Example Nginx location block outline:

    location /db/ {
        auth_request /oauth2/auth;
        error_page 401 = /oauth2/start;
        proxy_set_header X-Script-Name /db;
        proxy_pass http://127.0.0.1:5050;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }

## Interfaces and Dependencies

Add `infra/docker-compose.admin.yml` defining `oauth2-proxy`, `dpage/pgadmin4`, and `redis/redisinsight` services, including `SCRIPT_NAME=/db`, `PGADMIN_CONFIG_PROXY_X_HOST_COUNT=1`, and `PGADMIN_CONFIG_PROXY_X_PROTO_COUNT=1` for pgAdmin and `RI_PROXY_PATH=/redis` plus `RI_SOCKET_PROXY_PATH=/redis` for RedisInsight. Update `infra/nginx/obd2-dashboard.conf` to proxy `/db/`, `/redis/`, `/redis/socket.io/`, and `/oauth2/` to the local admin services and oauth2-proxy while preserving the subpath prefixes. Create `/etc/obd2-dashboard-admin.env` on the VPS with OAuth secrets and admin UI credentials, and create `/etc/obd2-dashboard-admin-allowlist.txt` with one allowed email per line. The oauth2-proxy container must enforce the allowlist and use secure cookies over HTTPS.

Plan change note: Initial version created on 2025-12-26 to add secure Postgres and Redis admin UIs behind OAuth authentication.
Plan change note: Updated on 2025-12-27 to reflect subpath configuration details, OAuth App requirement, `read:org` scope, allowlist file permissions, cookie secret format, and VPS validation outcome.
