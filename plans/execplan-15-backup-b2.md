# Production Backups with Backblaze B2 (Daily, Encrypted, Tested)

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the VPS runs a daily, encrypted offsite backup of the Postgres database to Backblaze B2 using the free tier, with a clear, repeatable restore process. The backup system meets an RPO of 24 hours (maximum acceptable data loss) and targets a short RTO (time to restore service) by using restic snapshots and a documented restore drill. You can see it working by triggering a backup, seeing a new restic snapshot and B2 objects, and restoring into a temporary database that you can query within a measured restore window.

## Progress

- [x] (2025-12-27 19:30Z) Rewrite the ExecPlan to be fully self-contained and aligned with `.agent/PLANS.md`, including B2 setup, retention, restore drills, and dependencies.
- [x] (2025-12-27 19:55Z) Add an interactive backup env setup script and document it.
- [x] (2025-12-27 20:20Z) Implement backup scripts, systemd timers, and documentation updates described in this plan.
- [x] (2025-12-28 09:20Z) Validate backups by running a backup, checking restic integrity, and performing a restore drill.

## Surprises & Discoveries

- Observation: restic restores absolute-path backups under the target directory, preserving the full path.
  Evidence: restore drill failed to find the dump at `/opt/obd2-dashboard/var/backups/restore/pgdump-*.dump`; the file was restored under `/opt/obd2-dashboard/var/backups/restore/opt/obd2-dashboard/var/backups/`.

## Decision Log

- Decision: Use restic with Backblaze B2 as the backup backend.
  Rationale: Restic provides client-side encryption, deduplication, retention pruning, and integrity checks while supporting B2 without extra services.
  Date/Author: 2025-12-27 / Codex
- Decision: Take daily logical backups using `pg_dump` in custom format, stored in restic snapshots.
  Rationale: A daily logical dump meets the 24h RPO without the complexity of continuous WAL archiving, and restores are straightforward.
  Date/Author: 2025-12-27 / Codex
- Decision: Do not implement PITR (point-in-time recovery) in this plan.
  Rationale: PITR requires continuous WAL archiving and a more complex restore pipeline; the user requirement is a 24h RPO, which daily dumps satisfy.
  Date/Author: 2025-12-27 / Codex
- Decision: Use systemd services and timers with `Persistent=true` for scheduling.
  Rationale: Timers are standard on Ubuntu, survive reboots, and make missed runs visible and recoverable.
  Date/Author: 2025-12-27 / Codex
- Decision: Store B2 credentials and the restic repository password in `/etc/obd2-dashboard-backup.env` with 0600 permissions.
  Rationale: Keeps secrets off the repository and aligns with the existing `/etc/obd2-dashboard.env` pattern.
  Date/Author: 2025-12-27 / Codex
- Decision: Back up Postgres only, treating Redis as non-authoritative cache data.
  Rationale: Redis data can be rebuilt from Postgres and backing it up increases storage and complexity without improving the stated RPO/RTO for the source of truth.
  Date/Author: 2025-12-27 / Codex
- Decision: Default retention uses `restic forget --prune --keep-daily 14 --keep-weekly 8 --keep-monthly 6` and can be tuned after observing snapshot sizes.
  Rationale: The free tier provides limited storage and egress, so conservative retention avoids unexpected charges while still providing recovery depth.
  Date/Author: 2025-12-27 / Codex
- Decision: Provide an interactive shell script to create `/etc/obd2-dashboard-backup.env`.
  Rationale: Operators may not be able to paste secrets easily over SSH; an interactive script reduces errors and improves repeatability.
  Date/Author: 2025-12-27 / Codex

## Outcomes & Retrospective

Backups are now validated on the VPS: restic repository initialized, daily backup ran, integrity check passed, and a restore drill successfully loaded into a temporary database with a verification query. Remaining work is operational: keep secrets secure, monitor timers, and adjust retention as data grows.

## Context and Orientation

The dashboard runs on a VPS with Postgres and Redis provisioned via Docker Compose in `infra/docker-compose.ops.yml`. Postgres and Redis are bound to localhost and store data in Docker volumes `obd2-dashboard-postgres` and `obd2-dashboard-redis`. The VPS stores runtime secrets in `/etc/obd2-dashboard.env` as described in `doc/ops-secrets.md`, and operational steps in `doc/ops-deploy.md` currently mention manual `pg_dump` before migrations.

This plan adds a production-grade backup pipeline for Postgres only. Postgres is the system of record; Redis is configured with AOF for durability but is not treated as authoritative data for backups in this plan. If Redis later stores durable data that cannot be reconstructed, a follow-up plan should add Redis backups.

Definitions used in this plan:

RPO (Recovery Point Objective) is the maximum acceptable data loss after a failure. An RPO of 24 hours means the newest backup must be less than one day old.

RTO (Recovery Time Objective) is the maximum acceptable time to restore service after a failure. This plan targets a short RTO by providing a simple restore command flow.

PITR (Point-In-Time Recovery) is the ability to restore the database to a specific moment in time by continuously archiving Postgres write-ahead logs. PITR is not implemented here because a daily dump meets the requirement.

Restic is a backup tool that creates encrypted snapshots of files and uploads them to a repository. Backblaze B2 is a cloud object storage service with a free tier; restic stores encrypted blobs in a B2 bucket. The free tier currently offers limited storage and daily download allowances, so retention and integrity checks must be conservative to avoid charges. At the time of writing, the free tier is commonly described as 10 GB storage and 1 GB/day downloads, but the exact limits can change, so confirm in the B2 console before relying on it.

Systemd is the service manager on Ubuntu. A systemd timer is a scheduled job that triggers a systemd service at specific times and can catch up after downtime.

## Milestones

Milestone 1 defines the backup architecture and makes the plan self-contained. At the end of this milestone, a new developer can explain where backups live, how to create the B2 bucket and key, what data is captured, and how restore steps work.

Milestone 2 implements the backup system in the repository: backup scripts, restic configuration, systemd services and timers, and documentation updates. At the end, a VPS can install the scripts and timers with no ad-hoc changes.

Milestone 3 validates the implementation by running a backup, inspecting B2 for uploaded objects, and restoring into a temporary database that can be queried. At the end, the restore drill proves the RTO workflow.

## Plan of Work

Create a dedicated backup environment file at `/etc/obd2-dashboard-backup.env` that contains only backup-related secrets and database connection values. This file must be root-owned and 0600. Define a restic repository path using the `b2:` backend with a clear prefix, for example `b2:obd2-dashboard-backups:/postgres`, so multiple environments can co-exist in one bucket if needed. Also set `RESTIC_CACHE_DIR` to a local cache directory to reduce B2 API calls. The backup scripts and systemd unit files themselves live inside the project folder on the VPS at `/opt/obd2-dashboard/infra`, while secrets stay outside the repo in `/etc` for security. Use the interactive helper script `infra/scripts/setup-backup-env.sh` to generate the file and reduce manual copy/paste errors.

Add a backup script under `infra/scripts/backup-postgres.sh`. The script should load `/etc/obd2-dashboard-backup.env`, create a temporary dump directory under `/opt/obd2-dashboard/var/backups`, run `pg_dump` from inside the Postgres container with a custom format (`-Fc`) and a timestamped file name, then run `restic backup` on the dump file followed by `restic forget --prune --keep-daily 14 --keep-weekly 8 --keep-monthly 6`. Use `pg_dump --no-owner --no-privileges` so restores do not require the original role ownership. Use `set -euo pipefail`, `umask 077`, and a `flock`-based lock to avoid concurrent runs. After a successful restic backup, delete the local dump file to conserve disk.

Add a verification script under `infra/scripts/check-backup.sh`. It should run `restic snapshots` and `restic check --read-data-subset=5%` to validate repository integrity while minimizing B2 egress. It must exit non-zero on failure so systemd marks the unit as failed.

Add systemd units and timers under `infra/systemd` for daily backups and weekly checks. The backup timer should run once per day at a fixed off-peak time (for example 03:30 local time) and include `Persistent=true` so missed runs occur after downtime. The check timer should run weekly at another off-peak time. Services must read `EnvironmentFile=/etc/obd2-dashboard-backup.env` and log to journald. Use `systemctl link` so systemd references the unit files directly from `/opt/obd2-dashboard/infra/systemd`, keeping the mechanism in the project folder.

Update documentation so a new operator can set up Backblaze B2, add secrets, install restic, install scripts, and run a restore. Add a new `doc/ops-backups.md` (or extend `doc/ops-deploy.md` if preferred) and update `doc/ops-secrets.md` to describe the new backup secrets. Ensure the docs do not leak real secrets and provide placeholder values. The restore drill uses `postgresql-client` on the VPS; document that dependency explicitly.

## Concrete Steps

Create a Backblaze account, then in the B2 web console create a Project to hold infrastructure backups. Inside that Project, create a private bucket named `obd2-dashboard-backups` (or a name you choose). In the Project's Application Keys section, create an application key restricted to that bucket with read and write access, and do not use the master application key. Record two values: the Key ID (sometimes called application key ID) and the Application Key. These are the credentials restic uses.

On the VPS, create the backup environment file. This file is separate from `/etc/obd2-dashboard.env` and must be root-only. Copy the `POSTGRES_*` values from `/etc/obd2-dashboard.env` so the backup script uses the same credentials. Generate a restic password with a strong random value (for example, `openssl rand -hex 32`) and store it here. You can either use the interactive helper script or create the file manually.

Interactive script:

    sudo bash /opt/obd2-dashboard/infra/scripts/setup-backup-env.sh

Manual file creation:

    sudo install -m 0600 /dev/null /etc/obd2-dashboard-backup.env
    sudo tee /etc/obd2-dashboard-backup.env > /dev/null <<'EOF'
    RESTIC_REPOSITORY=b2:obd2-dashboard-backups:/postgres
    RESTIC_PASSWORD=<long-random-secret>
    RESTIC_CACHE_DIR=/opt/obd2-dashboard/var/cache/restic
    B2_ACCOUNT_ID=<b2-key-id>
    B2_ACCOUNT_KEY=<b2-application-key>
    POSTGRES_DB=obd2_dashboard
    POSTGRES_USER=obd2_user
    POSTGRES_PASSWORD=change-me
    EOF

Create backup and cache directories inside the project folder, install restic, and initialize the repository:

    sudo install -d -m 0700 /opt/obd2-dashboard/var/backups
    sudo install -d -m 0700 /opt/obd2-dashboard/var/cache/restic
    sudo apt-get update
    sudo apt-get install -y restic
    sudo bash -lc 'set -a; . /etc/obd2-dashboard-backup.env; set +a; restic init'

Add the backup scripts and systemd units to the repository, then link them on the VPS from the project folder:

    sudo chmod 0750 /opt/obd2-dashboard/infra/scripts/backup-postgres.sh
    sudo chmod 0750 /opt/obd2-dashboard/infra/scripts/check-backup.sh
    sudo systemctl link /opt/obd2-dashboard/infra/systemd/obd2-dashboard-backup.service
    sudo systemctl link /opt/obd2-dashboard/infra/systemd/obd2-dashboard-backup.timer
    sudo systemctl link /opt/obd2-dashboard/infra/systemd/obd2-dashboard-backup-check.service
    sudo systemctl link /opt/obd2-dashboard/infra/systemd/obd2-dashboard-backup-check.timer
    sudo systemctl daemon-reload
    sudo systemctl enable --now obd2-dashboard-backup.timer
    sudo systemctl enable --now obd2-dashboard-backup-check.timer

Trigger a manual backup and inspect the logs:

    sudo systemctl start obd2-dashboard-backup.service
    sudo journalctl -u obd2-dashboard-backup.service -n 200 --no-pager
    sudo bash -lc 'set -a; . /etc/obd2-dashboard-backup.env; set +a; restic snapshots'

Perform a restore drill to a temporary database and verify data:

    sudo apt-get install -y postgresql-client
    sudo bash
    set -a; . /etc/obd2-dashboard-backup.env; set +a
    restic restore latest --target /opt/obd2-dashboard/var/backups/restore --include /opt/obd2-dashboard/var/backups/pgdump-*.dump
    set -a; . /etc/obd2-dashboard.env; set +a
    DUMP_FILE=$(ls /opt/obd2-dashboard/var/backups/restore/opt/obd2-dashboard/var/backups/pgdump-*.dump | tail -n 1)
    export PGPASSWORD="$POSTGRES_PASSWORD"
    createdb -h localhost -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" obd2_dashboard_restore
    pg_restore -h localhost -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -d obd2_dashboard_restore "$DUMP_FILE"
    exit

## Validation and Acceptance

A successful backup run produces a restic snapshot whose timestamp matches the run time and a corresponding object set in the B2 bucket. `systemctl list-timers` should show both timers enabled, and `journalctl -u obd2-dashboard-backup.service` should show a clean exit code.

The restore drill should succeed without errors, and you should be able to connect to the restored database and run a simple query, such as counting rows in a known table. The restore time should be measured and recorded to confirm the practical RTO for the current database size.

## Idempotence and Recovery

Running the backup script multiple times is safe because restic deduplicates data. Re-enabling timers is safe and does not duplicate schedules. If `restic init` is run on an existing repository, it fails cleanly; in that case, skip initialization and proceed with backups.

If a backup fails, rerun the backup service after fixing the error and inspect logs for failure context. If the B2 key is rotated, update `/etc/obd2-dashboard-backup.env` and rerun. If the restore drill fails because `obd2_dashboard_restore` already exists, drop it with `dropdb` before retrying. If the VPS is lost, reinstall restic on a new VPS, recreate `/etc/obd2-dashboard-backup.env`, and restore from the latest snapshot using the same commands.

## Artifacts and Notes

Example restic snapshot output:

    snapshot 3c1b9f1d saved at 2025-12-27 03:30:00
    backup targets: /var/backups/obd2-dashboard/pgdump-2025-12-27-033000.dump

Example systemd timer listing:

    NEXT                         LEFT          LAST                         PASSED     UNIT                          ACTIVATES
    Sat 2025-12-28 03:30:00 UTC  10h left      Fri 2025-12-27 03:30:01 UTC  13h ago    obd2-dashboard-backup.timer    obd2-dashboard-backup.service

## Interfaces and Dependencies

Add these files to the repository:

    infra/scripts/backup-postgres.sh
    infra/scripts/check-backup.sh
    infra/scripts/setup-backup-env.sh
    infra/systemd/obd2-dashboard-backup.service
    infra/systemd/obd2-dashboard-backup.timer
    infra/systemd/obd2-dashboard-backup-check.service
    infra/systemd/obd2-dashboard-backup-check.timer
    doc/ops-backups.md

Update existing documentation:

    doc/ops-secrets.md
    doc/ops-deploy.md

The backup scripts depend on `docker compose` and the `postgres` service defined in `infra/docker-compose.ops.yml`, and on `restic` being installed on the VPS. The restore drill depends on `postgresql-client` on the VPS. The backup environment file must define `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `B2_ACCOUNT_ID`, `B2_ACCOUNT_KEY`, `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`. The systemd units must call the scripts from `/opt/obd2-dashboard/infra/scripts` and read `/etc/obd2-dashboard-backup.env` for secrets. The setup script depends on `openssl` to generate a restic password when one is not provided.

Plan change note: 2025-12-27 - Rewrote the ExecPlan to be fully self-contained and production-grade for daily B2 backups, adding B2 setup steps, explicit definitions (RPO, RTO, PITR), and detailed restore validation, per the new requirement.
Plan change note: 2025-12-27 - Refined the plan with restic cache and retention details, clarified free-tier constraints, updated restore drills to use the host postgresql client for correct file access, and moved backup working directories into the `/opt/obd2-dashboard` project tree.
Plan change note: 2025-12-27 - Added an interactive backup env setup script and documented its usage to ease secret provisioning over SSH.
Plan change note: 2025-12-28 - Corrected the restore drill to account for restic restoring absolute paths under the target directory.
