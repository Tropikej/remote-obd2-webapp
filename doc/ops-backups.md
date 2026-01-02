# Backups (Backblaze B2 + restic)

This document describes how to set up and operate daily Postgres backups using
restic with Backblaze B2. Backups are encrypted on the VPS and stored offsite.

## Overview

- Source of truth: Postgres (Redis is treated as cache and not backed up here).
- Backup tool: restic.
- Storage: Backblaze B2 bucket (free tier).
- Schedule: daily backup + weekly integrity check via systemd timers.
- Staging paths (on VPS):
  - `/opt/obd2-dashboard/var/backups` for temporary dump files.
  - `/opt/obd2-dashboard/var/cache/restic` for restic cache.

## Prerequisites

- VPS has the project at `/opt/obd2-dashboard`.
- Docker and `docker compose` are installed (Postgres runs via Docker Compose).
- Backblaze account with a private bucket and a restricted application key.
- `restic` installed on the VPS.
- `postgresql-client` installed on the VPS for restore drills.

## Backblaze B2 setup

1) Create a Backblaze account.
2) Create a Project for infrastructure backups.
3) Create a private bucket, for example `obd2-dashboard-backups`.
4) Create an application key restricted to that bucket with read/write access.
   Do not use the master application key.
5) Record:
   - Key ID (application key ID)
   - Application Key

## Secrets file

Create `/etc/obd2-dashboard-backup.env` using the interactive helper:

```
sudo bash /opt/obd2-dashboard/infra/scripts/setup-backup-env.sh
```

This writes the env file with 0600 permissions and prompts for:

```
RESTIC_REPOSITORY
RESTIC_PASSWORD
B2_ACCOUNT_ID
B2_ACCOUNT_KEY
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_PORT
```

The script reads `/etc/obd2-dashboard.env` if present and reuses its
`POSTGRES_*` values by default.

## Install restic and initialize the repository

```
sudo apt-get update
sudo apt-get install -y restic postgresql-client
sudo install -d -m 0700 /opt/obd2-dashboard/var/backups
sudo install -d -m 0700 /opt/obd2-dashboard/var/cache/restic
sudo bash -lc 'set -a; . /etc/obd2-dashboard-backup.env; set +a; restic init'
```

If the repository already exists, `restic init` will fail; in that case, skip
initialization.

## Enable systemd timers

Systemd units live in the project folder. Link them and enable timers:

```
sudo systemctl link /opt/obd2-dashboard/infra/systemd/obd2-dashboard-backup.service
sudo systemctl link /opt/obd2-dashboard/infra/systemd/obd2-dashboard-backup.timer
sudo systemctl link /opt/obd2-dashboard/infra/systemd/obd2-dashboard-backup-check.service
sudo systemctl link /opt/obd2-dashboard/infra/systemd/obd2-dashboard-backup-check.timer
sudo systemctl daemon-reload
sudo systemctl enable --now obd2-dashboard-backup.timer
sudo systemctl enable --now obd2-dashboard-backup-check.timer
```

Confirm scheduling:

```
systemctl list-timers | grep obd2-dashboard-backup
```

## Run a manual backup

```
sudo systemctl start obd2-dashboard-backup.service
sudo journalctl -u obd2-dashboard-backup.service -n 200 --no-pager
sudo bash -lc 'set -a; . /etc/obd2-dashboard-backup.env; set +a; restic snapshots'
```

## Restore drill (test)

Run a restore into a temporary database and verify it:

```
sudo bash
set -a; . /etc/obd2-dashboard-backup.env; set +a
restic restore latest --target /opt/obd2-dashboard/var/backups/restore --include /opt/obd2-dashboard/var/backups/pgdump-*.dump
set -a; . /etc/obd2-dashboard.env; set +a
DUMP_FILE=$(ls /opt/obd2-dashboard/var/backups/restore/opt/obd2-dashboard/var/backups/pgdump-*.dump | tail -n 1)
export PGPASSWORD="$POSTGRES_PASSWORD"
createdb -h localhost -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" obd2_dashboard_restore
pg_restore -h localhost -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -d obd2_dashboard_restore "$DUMP_FILE"
exit
```

If the restore database already exists, drop it first:

```
dropdb -h localhost -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" obd2_dashboard_restore
```

## Retention policy

The backup script prunes snapshots after each backup using:

```
restic forget --prune --keep-daily 14 --keep-weekly 8 --keep-monthly 6
```

Adjust these values in `infra/scripts/backup-postgres.sh` if the B2 free tier
limits are too tight or if you need longer retention.

## Migrations and rollbacks

Before applying database migrations on the VPS, trigger a backup:

```
sudo systemctl start obd2-dashboard-backup.service
```

If you need to roll back, restore the latest snapshot into a new database,
confirm it looks correct, and point the app to it or restore over the original
database as part of a controlled recovery.

## Troubleshooting

- `restic` errors about missing repository: ensure `restic init` ran and that
  `RESTIC_REPOSITORY` in `/etc/obd2-dashboard-backup.env` matches the bucket.
- `permission denied` on `/etc/obd2-dashboard-backup.env`: file must be 0600
  and readable by root.
- `docker compose` errors: confirm `/opt/obd2-dashboard/infra/docker-compose.ops.yml`
  exists and the Postgres container is running.
