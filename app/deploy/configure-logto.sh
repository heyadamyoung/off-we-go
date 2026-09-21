#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
DATABASE="${1:-logto}"
if [[ "$DATABASE" != "logto" && "$DATABASE" != "logto_restore" ]]; then
  echo "Refusing to configure an unexpected Logto database: $DATABASE" >&2
  exit 64
fi

# Thirty tries, a minute. It used to be sixty, which is two minutes of a
# deploy spent waiting for Logto to seed its own schema — worth it when this
# ran before the release was let through, pointless now that it runs after.
# A box where Logto needs longer than a minute has something else wrong with
# it, and the line below says so rather than waiting in silence.
for attempt in $(seq 1 30); do
  if docker compose exec -T logto-db \
    psql -v ON_ERROR_STOP=1 -U logto -d "$DATABASE" < deploy/configure-logto.sql; then
    echo "Logto email and password sign-in is configured in $DATABASE."
    exit 0
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "Logto did not become ready for sign-in configuration." >&2
    exit 1
  fi
  sleep 2
done
