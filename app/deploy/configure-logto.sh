#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
DATABASE="${1:-logto}"
if [[ "$DATABASE" != "logto" && "$DATABASE" != "logto_restore" ]]; then
  echo "Refusing to configure an unexpected Logto database: $DATABASE" >&2
  exit 64
fi

for attempt in $(seq 1 60); do
  if docker compose exec -T logto-db \
    psql -v ON_ERROR_STOP=1 -U logto -d "$DATABASE" < deploy/configure-logto.sql; then
    echo "Logto email and password sign-in is configured in $DATABASE."
    exit 0
  fi
  if [[ "$attempt" -eq 60 ]]; then
    echo "Logto did not become ready for sign-in configuration." >&2
    exit 1
  fi
  sleep 2
done
