#!/usr/bin/env bash
# The nightly backup, and the deploy's own safety net.
#
# In full, it stops the api and Logto, dumps both databases, tars the uploads
# and starts everything again — stopped so the databases and the files agree
# with each other. Called with `quick`, it dumps the databases only and stops
# nothing: a dump is consistent on its own, and the deploy that runs one
# before every release was taking the site down for a minute and a half each
# time to archive a volume the nightly run already keeps. A quick backup
# restores the databases and leaves the uploads as they are.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
QUICK=0
if [[ "${1:-}" == "quick" ]]; then QUICK=1; fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="backups/$STAMP"
PARTIAL="backups/.${STAMP}.partial"
install -d -m 750 "$PARTIAL"
restart_services() { docker compose up -d api logto >/dev/null 2>&1 || true; }
if (( ! QUICK )); then
  trap restart_services EXIT
  docker compose stop api logto >/dev/null
fi
docker compose exec -T db pg_dump -U wayfare -d wayfare -Fc > "$PARTIAL/database.dump"
docker compose exec -T logto-db pg_dump -U logto -d logto -Fc > "$PARTIAL/logto.dump"
if (( ! QUICK )); then
  tar -C data -czf "$PARTIAL/uploads.tar.gz" uploads
fi
docker compose exec -T db pg_restore --list < "$PARTIAL/database.dump" >/dev/null
docker compose exec -T logto-db pg_restore --list < "$PARTIAL/logto.dump" >/dev/null
if (( ! QUICK )); then
  tar -tzf "$PARTIAL/uploads.tar.gz" >/dev/null
fi
mv "$PARTIAL" "$TARGET"
if (( ! QUICK )); then
  restart_services
  trap - EXIT
fi
find backups -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
echo "$TARGET"
