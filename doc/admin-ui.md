# Admin UI (Postgres + Redis)

This guide explains how to run pgAdmin and RedisInsight behind oauth2-proxy at
`/db` and `/redis` on the same domain as the dashboard.

## Overview

- Docker Compose stack: `infra/docker-compose.admin.yml`
- Nginx config: `infra/nginx/obd2-dashboard.conf`
- OAuth provider: GitHub via oauth2-proxy
- OAuth scope: `read:user,user:email,read:org` (required for GitHub org lookup)

## Secrets and allowlist

Create `/etc/obd2-dashboard-admin.env` (0600, root-owned) with:

```
OAUTH2_PROXY_CLIENT_ID=your-github-oauth-client-id
OAUTH2_PROXY_CLIENT_SECRET=your-github-oauth-client-secret
OAUTH2_PROXY_COOKIE_SECRET=hex_32_chars
OAUTH2_PROXY_REDIRECT_URL=https://baltringuelabs.cam/oauth2/callback
OAUTH2_PROXY_ALLOWED_EMAILS_FILE=/etc/obd2-dashboard-admin-allowlist.txt
PGADMIN_DEFAULT_EMAIL=admin@example.com
PGADMIN_DEFAULT_PASSWORD=change-me
```

Create a GitHub OAuth App (not a GitHub App) to obtain the client ID/secret:

- Settings -> Developer settings -> OAuth Apps -> New OAuth App
- Homepage URL: `https://baltringuelabs.cam`
- Authorization callback URL: `https://baltringuelabs.cam/oauth2/callback`

Generate the cookie secret (32 hex characters = 16 bytes):

```
openssl rand -hex 16
```

Create the allowlist file referenced above (one email per line). The file must
be readable by the container (0644 is fine):

```
sudo install -m 0644 /dev/null /etc/obd2-dashboard-admin-allowlist.txt
sudo tee /etc/obd2-dashboard-admin-allowlist.txt > /dev/null <<'EOF'
admin@example.com
second.admin@example.com
EOF
```

## Start the admin stack

```
cd /opt/obd2-dashboard
sudo docker compose -f infra/docker-compose.admin.yml --env-file /etc/obd2-dashboard-admin.env up -d
sudo docker compose -f infra/docker-compose.admin.yml --env-file /etc/obd2-dashboard-admin.env ps
```

## Nginx

Install or update the Nginx config. On the VPS, the active file is
`/etc/nginx/sites-available/dashboard.conf` (installed from
`infra/nginx/obd2-dashboard.conf`), then:

```
sudo nginx -t
sudo systemctl reload nginx
```

## Access

Visit `https://baltringuelabs.cam/db` or `https://baltringuelabs.cam/redis`.
Unauthenticated requests should redirect to GitHub OAuth, and allowed users
should land in pgAdmin or RedisInsight after login.

When adding connections in the UIs, use `postgres` and `redis` as hostnames if
the ops stack is running via `infra/docker-compose.ops.yml` from the same
project directory. Otherwise, use the host address reachable from the container
network (for example `host.docker.internal`).

## Connect to Postgres (pgAdmin)

Register the database server in pgAdmin:

1) Register -> Server...
2) General tab: Name `obd2-dashboard` (any name works).
3) Connection tab:
   - Host name/address: `postgres` (or `host.docker.internal` / `172.17.0.1`)
   - Port: `5432`
   - Maintenance database: value of `POSTGRES_DB`
   - Username: value of `POSTGRES_USER`
   - Password: value of `POSTGRES_PASSWORD`
   - Check "Save password"

The Postgres credentials come from `/etc/obd2-dashboard.env`.

## Connect to Redis (RedisInsight)

Open `https://baltringuelabs.cam/redis` and add a database:

1) Click "Add Redis Database".
2) Connection:
   - Host: `redis` (or `host.docker.internal` / `172.17.0.1`)
   - Port: `6379`
   - Username: leave blank (unless Redis ACLs are enabled)
   - Password: leave blank (unless `REDIS_PASSWORD` is set)

If you use a managed Redis instance, set the host and port from `REDIS_URL`.

## View data (RedisInsight)

- Use the Browser tab to explore keys.
- Use the CLI/Workbench to run Redis commands, e.g.:

```
SCAN 0 MATCH * COUNT 100
GET your:key
```

## View data (pgAdmin)

- Navigate to Schemas -> public -> Tables, then right-click a table and choose
  "View/Edit Data" -> "All Rows".
- Or open the Query Tool and run:

```
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

## Troubleshooting

- OAuth error 500 with message `Resource not accessible by integration` means a
  GitHub App was used. Create a GitHub OAuth App and update the client ID/secret.
- OAuth error 500 mentioning `read:org` means the OAuth app scope does not allow
  listing organizations; ensure oauth2-proxy requests `read:org` and re-auth.
- Blank pgAdmin page or CSRF errors like `The referrer does not match the host`
  mean pgAdmin is not trusting forwarded host/proto headers. Ensure the
  container has `PGADMIN_CONFIG_PROXY_X_HOST_COUNT=1` and
  `PGADMIN_CONFIG_PROXY_X_PROTO_COUNT=1`, then restart pgAdmin.
- oauth2-proxy error `permission denied` for the allowlist file means the file
  is too restrictive; set `/etc/obd2-dashboard-admin-allowlist.txt` to `0644`.

## Rotate secrets

- Rotate OAuth client secret in GitHub, then update
  `/etc/obd2-dashboard-admin.env` and restart the admin stack.
- Rotate the cookie secret by generating a new hex value and restarting the
  admin stack (this will sign out existing sessions).
- Rotate pgAdmin credentials by updating the env file and restarting the
  pgAdmin container.

## Disable the admin UI

```
cd /opt/obd2-dashboard
sudo docker compose -f infra/docker-compose.admin.yml --env-file /etc/obd2-dashboard-admin.env down
```

Remove the `/db` and `/redis` locations from `infra/nginx/obd2-dashboard.conf`
and reload Nginx.
