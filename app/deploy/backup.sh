#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="backups/$STAMP"
install -d -m 750 "$TARGET"
docker compose exec -T db pg_dump -U wayfare -d wayfare -Fc > "$TARGET/database.dump"
tar -C data -czf "$TARGET/uploads.tar.gz" uploads
find backups -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
echo "$TARGET"
