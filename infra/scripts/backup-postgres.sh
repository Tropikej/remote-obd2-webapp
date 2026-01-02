#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (use sudo)." >&2
  exit 1
fi

ENV_FILE="/etc/obd2-dashboard-backup.env"
PRIMARY_ENV="/etc/obd2-dashboard.env"
PROJECT_ROOT="/opt/obd2-dashboard"
BACKUP_DIR="${PROJECT_ROOT}/var/backups"
LOCK_DIR="${PROJECT_ROOT}/var/lock"
DEFAULT_CACHE_DIR="${PROJECT_ROOT}/var/cache/restic"
COMPOSE_FILE="${PROJECT_ROOT}/infra/docker-compose.ops.yml"
KEEP_DAILY=14
KEEP_WEEKLY=8
KEEP_MONTHLY=6

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Run setup-backup-env.sh first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: ${name}" >&2
    exit 1
  fi
}

require_var RESTIC_REPOSITORY
require_var RESTIC_PASSWORD
require_var B2_ACCOUNT_ID
require_var B2_ACCOUNT_KEY
require_var POSTGRES_DB
require_var POSTGRES_USER
require_var POSTGRES_PASSWORD

RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-${DEFAULT_CACHE_DIR}}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

export RESTIC_REPOSITORY RESTIC_PASSWORD B2_ACCOUNT_ID B2_ACCOUNT_KEY RESTIC_CACHE_DIR

install -d -m 0700 "${BACKUP_DIR}" "${LOCK_DIR}" "${RESTIC_CACHE_DIR}"

exec 9>"${LOCK_DIR}/backup-postgres.lock"
if ! flock -n 9; then
  echo "Backup already running; exiting."
  exit 0
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Missing ${COMPOSE_FILE}. Cannot run pg_dump." >&2
  exit 1
fi

compose_env="${ENV_FILE}"
if [[ -f "${PRIMARY_ENV}" ]]; then
  compose_env="${PRIMARY_ENV}"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for pg_dump via docker compose." >&2
  exit 1
fi

timestamp="$(date -u +%Y-%m-%d-%H%M%S)"
dump_file="${BACKUP_DIR}/pgdump-${timestamp}.dump"
success=false

cleanup() {
  if [[ "${success}" == "true" && -f "${dump_file}" ]]; then
    rm -f "${dump_file}"
  fi
}
trap cleanup EXIT

echo "Starting pg_dump for ${POSTGRES_DB}."
docker compose -f "${COMPOSE_FILE}" --env-file "${compose_env}" exec -T \
  -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc --no-owner --no-privileges \
  > "${dump_file}"

echo "Uploading ${dump_file} to restic repository."
restic backup "${dump_file}" --tag postgres --tag obd2-dashboard

echo "Pruning old snapshots (daily=${KEEP_DAILY} weekly=${KEEP_WEEKLY} monthly=${KEEP_MONTHLY})."
restic forget --prune --keep-daily "${KEEP_DAILY}" --keep-weekly "${KEEP_WEEKLY}" --keep-monthly "${KEEP_MONTHLY}"

success=true
echo "Backup completed successfully."
