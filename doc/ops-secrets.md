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

## SMTP (planned)

SMTP delivery for password reset is planned in the auth plan. When implemented, expected values include:

    EMAIL_PROVIDER=smtp
    SMTP_HOST=smtp.example.com
    SMTP_PORT=587
    SMTP_USER=...
    SMTP_PASS=...
    SMTP_FROM="Dashboard <no-reply@example.com>"
