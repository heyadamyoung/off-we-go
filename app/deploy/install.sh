#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root: sudo bash deploy/install.sh" >&2
  exit 1
fi
EXISTING_ENV=false
if [[ -f .env ]]; then EXISTING_ENV=true; fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Engine and the Compose plugin must be installed from your distribution or Docker's signed package repository before running this installer." >&2
  exit 1
fi
docker compose version >/dev/null

install -d -m 750 data/uploads backups
chown -R 1000:1000 data/uploads

if [[ "$EXISTING_ENV" == true ]]; then
  WAYFARE_DOMAIN="$(sed -n 's/^WAYFARE_DOMAIN=//p' .env | tail -n 1)"
  WAYFARE_ADMIN_EMAIL="$(sed -n 's/^WAYFARE_ADMIN_EMAIL=//p' .env | tail -n 1)"
  if ! grep -q '^WAYFARE_OAUTH_SECRET=.' .env; then
    printf 'WAYFARE_OAUTH_SECRET=%s\n' "$(openssl rand -base64 48 | tr -d '\n')" >> .env
    chmod 600 .env
  fi
  for required in WAYFARE_DOMAIN WAYFARE_ADMIN_EMAIL APPLE_TEAM_ID POSTGRES_PASSWORD WAYFARE_SESSION_SECRET WAYFARE_OAUTH_SECRET SMTP_HOST SMTP_FROM; do
    grep -q "^${required}=." .env || { echo ".env is missing ${required}; add it before rerunning." >&2; exit 1; }
  done
  echo "Reusing the existing .env and preserving its database, session, and SMTP secrets."
else
  read -rp "Wayfare domain [wayfare.threadway.ai]: " WAYFARE_DOMAIN
  WAYFARE_DOMAIN="${WAYFARE_DOMAIN:-wayfare.threadway.ai}"
  read -rp "Initial owner email: " WAYFARE_ADMIN_EMAIL
  read -rp "Apple Developer Team ID [R65UN25Q64]: " APPLE_TEAM_ID
  APPLE_TEAM_ID="${APPLE_TEAM_ID:-R65UN25Q64}"
  if [[ ! "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
    echo "Apple Team ID must be 10 uppercase letters/numbers." >&2
    exit 1
  fi
  read -rp "SMTP host: " SMTP_HOST
  read -rp "SMTP port [587]: " SMTP_PORT
  SMTP_PORT="${SMTP_PORT:-587}"
  read -rp "Use implicit SMTP TLS? [y/N]: " SMTP_TLS
  [[ "$SMTP_TLS" =~ ^[Yy]$ ]] && SMTP_SECURE=true || SMTP_SECURE=false
  read -rp "SMTP username (blank if none): " SMTP_USER
  read -rsp "SMTP password (blank if none): " SMTP_PASS
  echo
  read -rp "From address [Wayfare <$WAYFARE_ADMIN_EMAIL>]: " SMTP_FROM
  SMTP_FROM="${SMTP_FROM:-Wayfare <$WAYFARE_ADMIN_EMAIL>}"

  POSTGRES_PASSWORD="$(openssl rand -hex 32)"
  WAYFARE_SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  WAYFARE_OAUTH_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  SMTP_PASS_B64="$(printf '%s' "$SMTP_PASS" | base64 | tr -d '\n')"
  unset SMTP_PASS

  umask 077
  {
    printf 'WAYFARE_DOMAIN=%s\n' "$WAYFARE_DOMAIN"
    printf 'WAYFARE_ADMIN_EMAIL=%s\n' "$WAYFARE_ADMIN_EMAIL"
    printf 'APPLE_TEAM_ID=%s\n' "$APPLE_TEAM_ID"
    printf 'APPLE_BUNDLE_ID=ai.threadway.wayfare\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
    printf 'WAYFARE_SESSION_SECRET=%s\n' "$WAYFARE_SESSION_SECRET"
    printf 'WAYFARE_OAUTH_SECRET=%s\n' "$WAYFARE_OAUTH_SECRET"
    printf 'SMTP_HOST=%s\n' "$SMTP_HOST"
    printf 'SMTP_PORT=%s\n' "$SMTP_PORT"
    printf 'SMTP_SECURE=%s\n' "$SMTP_SECURE"
    printf 'SMTP_USER=%s\n' "$SMTP_USER"
    printf 'SMTP_PASS_B64=%s\n' "$SMTP_PASS_B64"
    printf 'SMTP_FROM=%s\n' "$SMTP_FROM"
    printf 'LOG_LEVEL=info\n'
  } > .env
  chmod 600 .env
fi

docker compose up -d --build
for _ in $(seq 1 60); do
  if curl -fsS "https://${WAYFARE_DOMAIN}/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "https://${WAYFARE_DOMAIN}/api/health" >/dev/null

cat > /etc/cron.d/wayfare-backup <<EOF
17 3 * * * root cd $ROOT_DIR && /bin/bash deploy/backup.sh >/var/log/wayfare-backup.log 2>&1
47 3 * * * root cd $ROOT_DIR && docker compose exec -T db psql -U wayfare -d wayfare -c "select wayfare_prune_positions(interval '30 days');" >/var/log/wayfare-gps-prune.log 2>&1
EOF
chmod 644 /etc/cron.d/wayfare-backup

echo "Wayfare is running at https://${WAYFARE_DOMAIN}"
echo "Sign in with ${WAYFARE_ADMIN_EMAIL}; the first login link will create the owner account."
