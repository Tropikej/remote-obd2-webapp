#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (use sudo)." >&2
  exit 1
fi

ENV_FILE="/etc/obd2-dashboard-backup.env"
SOURCE_ENV="/etc/obd2-dashboard.env"
PROJECT_ROOT="/opt/obd2-dashboard"
DEFAULT_REPO="b2:obd2-dashboard-backups:/postgres"
DEFAULT_CACHE_DIR="${PROJECT_ROOT}/var/cache/restic"

if [[ -f "${ENV_FILE}" ]]; then
  read -r -p "Backup env file exists at ${ENV_FILE}. Overwrite? [y/N] " overwrite
  case "${overwrite}" in
    y|Y) ;;
    *) echo "Aborting without changes."; exit 0;;
  esac
fi

if [[ -f "${SOURCE_ENV}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${SOURCE_ENV}"
  set +a
fi

read -r -p "RESTIC_REPOSITORY [${DEFAULT_REPO}]: " restic_repo
restic_repo="${restic_repo:-${DEFAULT_REPO}}"

read -r -s -p "RESTIC_PASSWORD (leave empty to generate): " restic_password
echo
if [[ -z "${restic_password}" ]]; then
  restic_password="$(openssl rand -hex 32)"
  echo "Generated RESTIC_PASSWORD."
fi

read -r -p "B2_ACCOUNT_ID (key ID): " b2_account_id
if [[ -z "${b2_account_id}" ]]; then
  echo "B2_ACCOUNT_ID is required." >&2
  exit 1
fi

read -r -s -p "B2_ACCOUNT_KEY (application key): " b2_account_key
echo
if [[ -z "${b2_account_key}" ]]; then
  echo "B2_ACCOUNT_KEY is required." >&2
  exit 1
fi

if [[ -z "${POSTGRES_DB:-}" ]]; then
  read -r -p "POSTGRES_DB: " POSTGRES_DB
fi

if [[ -z "${POSTGRES_USER:-}" ]]; then
  read -r -p "POSTGRES_USER: " POSTGRES_USER
fi

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  read -r -s -p "POSTGRES_PASSWORD: " POSTGRES_PASSWORD
  echo
fi

POSTGRES_PORT="${POSTGRES_PORT:-5432}"

umask 077
cat > "${ENV_FILE}" <<EOF
RESTIC_REPOSITORY=${restic_repo}
RESTIC_PASSWORD=${restic_password}
RESTIC_CACHE_DIR=${DEFAULT_CACHE_DIR}
B2_ACCOUNT_ID=${b2_account_id}
B2_ACCOUNT_KEY=${b2_account_key}
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_PORT=${POSTGRES_PORT}
EOF

chmod 0600 "${ENV_FILE}"
echo "Wrote ${ENV_FILE} with 0600 permissions."
