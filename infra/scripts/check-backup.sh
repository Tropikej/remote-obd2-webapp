#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (use sudo)." >&2
  exit 1
fi

ENV_FILE="/etc/obd2-dashboard-backup.env"
PROJECT_ROOT="/opt/obd2-dashboard"
DEFAULT_CACHE_DIR="${PROJECT_ROOT}/var/cache/restic"

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

RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-${DEFAULT_CACHE_DIR}}"
export RESTIC_REPOSITORY RESTIC_PASSWORD B2_ACCOUNT_ID B2_ACCOUNT_KEY RESTIC_CACHE_DIR

install -d -m 0700 "${RESTIC_CACHE_DIR}"

echo "Listing restic snapshots."
restic snapshots

echo "Running restic integrity check."
restic check --read-data-subset=5%
