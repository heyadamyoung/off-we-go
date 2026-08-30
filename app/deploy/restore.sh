#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
SOURCE="${1:-}"
if [[ -z "$SOURCE" || ! -f "$SOURCE/database.dump" || ! -f "$SOURCE/uploads.tar.gz" ]]; then
  echo "Usage: $0 backups/YYYYMMDDTHHMMSSZ" >&2
  exit 1
fi
read -rp "This replaces Wayfare's current database and uploads. Type RESTORE: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || exit 1
docker compose stop api web
docker compose exec -T db dropdb -U wayfare --if-exists wayfare
docker compose exec -T db createdb -U wayfare wayfare
docker compose exec -T db pg_restore -U wayfare -d wayfare --no-owner --no-privileges < "$SOURCE/database.dump"
UPLOADS_DIR="$ROOT_DIR/data/uploads"
[[ "$UPLOADS_DIR" == "$ROOT_DIR/data/uploads" && -d "$ROOT_DIR/data" ]] || exit 1
install -d "$UPLOADS_DIR"
find "$UPLOADS_DIR" -mindepth 1 -delete
tar -C data -xzf "$SOURCE/uploads.tar.gz"
docker compose up -d api web
echo "Restore completed from $SOURCE"
