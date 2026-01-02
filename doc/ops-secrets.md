# Secrets and Key Material

This document describes required secret values for the dashboard services. Store secrets outside the repository. For production, keep them in `/etc/obd2-dashboard.env` with permissions `0600` owned by root.

## Dongle Token Master Keys

Dongle tokens are encrypted at rest using AES-256-GCM. Provide one or more master keys as base64 strings that decode to exactly 32 bytes.

Required:
- `DONGLE_TOKEN_MASTER_KEY_V1` (base64, 32 bytes)

Optional for rotation:
- `DONGLE_TOKEN_MASTER_KEY_V2`, `DONGLE_TOKEN_MASTER_KEY_V3`, etc.
- `DONGLE_TOKEN_MASTER_KEY_DEFAULT_VERSION` to select the default version for new encryptions (defaults to the highest available version).
- `DONGLE_TOKEN_MASTER_KEY_TARGET_VERSION` for rotation jobs.

Example key generation:

    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

Example env snippet:

    DONGLE_TOKEN_MASTER_KEY_V1=base64value==
    DONGLE_TOKEN_MASTER_KEY_DEFAULT_VERSION=1

## Sessions

Set a session secret to protect cookie signing:

    SESSION_SECRET=your-long-random-value

## Database and Redis credentials

When running Postgres and Redis locally on the VPS (via Docker Compose), set these values in `/etc/obd2-dashboard.env`:

    POSTGRES_DB=obd2_dashboard
    POSTGRES_USER=obd2_user
    POSTGRES_PASSWORD=change-me
    POSTGRES_PORT=5432
    DATABASE_URL=postgresql://obd2_user:change-me@localhost:5432/obd2_dashboard
    REDIS_URL=redis://localhost:6379

## Admin UI (pgAdmin + RedisInsight)

Store admin UI secrets in `/etc/obd2-dashboard-admin.env`:

    OAUTH2_PROXY_CLIENT_ID=...
    OAUTH2_PROXY_CLIENT_SECRET=...
    OAUTH2_PROXY_COOKIE_SECRET=hex_32_chars
    OAUTH2_PROXY_REDIRECT_URL=https://baltringuelabs.cam/oauth2/callback
    OAUTH2_PROXY_ALLOWED_EMAILS_FILE=/etc/obd2-dashboard-admin-allowlist.txt
    PGADMIN_DEFAULT_EMAIL=admin@example.com
    PGADMIN_DEFAULT_PASSWORD=change-me

The client ID/secret must come from a GitHub OAuth App (not a GitHub App). Use
callback URL `https://baltringuelabs.cam/oauth2/callback`.

Create the allowlist file with one email per line (0644 so the container can read it):

    sudo install -m 0644 /dev/null /etc/obd2-dashboard-admin-allowlist.txt
    sudo tee /etc/obd2-dashboard-admin-allowlist.txt > /dev/null <<'EOF'
    admin@example.com
    second.admin@example.com
    EOF

Generate the cookie secret (32 hex characters = 16 bytes):

    openssl rand -hex 16

## Backups (Backblaze B2)

Backups use restic with Backblaze B2. Secrets live in
`/etc/obd2-dashboard-backup.env` (0600, root-owned). You can populate the file
with the interactive helper script:

    sudo bash /opt/obd2-dashboard/infra/scripts/setup-backup-env.sh

The script prompts for:

    RESTIC_REPOSITORY
    RESTIC_PASSWORD
    B2_ACCOUNT_ID
    B2_ACCOUNT_KEY
    POSTGRES_DB
    POSTGRES_USER
    POSTGRES_PASSWORD
    POSTGRES_PORT

## SMTP (planned)

SMTP delivery for password reset is planned in the auth plan. When implemented, expected values include:

    EMAIL_PROVIDER=smtp
    SMTP_HOST=smtp.example.com
    SMTP_PORT=587
    SMTP_USER=...
    SMTP_PASS=...
    SMTP_FROM="Dashboard <no-reply@example.com>"
