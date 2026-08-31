#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="backups/$STAMP"
PARTIAL="backups/.${STAMP}.partial"
install -d -m 750 "$PARTIAL"
restart_services() { docker compose up -d api logto >/dev/null 2>&1 || true; }
trap restart_services EXIT
docker compose stop api logto >/dev/null
docker compose exec -T db pg_dump -U wayfare -d wayfare -Fc > "$PARTIAL/database.dump"
docker compose exec -T logto-db pg_dump -U logto -d logto -Fc > "$PARTIAL/logto.dump"
tar -C data -czf "$PARTIAL/uploads.tar.gz" uploads
docker compose exec -T db pg_restore --list < "$PARTIAL/database.dump" >/dev/null
docker compose exec -T logto-db pg_restore --list < "$PARTIAL/logto.dump" >/dev/null
tar -tzf "$PARTIAL/uploads.tar.gz" >/dev/null
mv "$PARTIAL" "$TARGET"
restart_services
trap - EXIT
find backups -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
echo "$TARGET"
