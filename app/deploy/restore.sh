#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
SOURCE="${1:-}"
if [[ -z "$SOURCE" || ! -f "$SOURCE/database.dump" || ! -f "$SOURCE/logto.dump" || ! -f "$SOURCE/uploads.tar.gz" ]]; then
  echo "Usage: $0 backups/YYYYMMDDTHHMMSSZ" >&2
  exit 1
fi
read -rp "This replaces Off We Go's current database, Logto identities, and uploads. Type RESTORE: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || exit 1

# Validate both archives before the live service is touched.
docker compose exec -T db pg_restore --list < "$SOURCE/database.dump" >/dev/null
docker compose exec -T logto-db pg_restore --list < "$SOURCE/logto.dump" >/dev/null
UPLOAD_LIST="$(mktemp)"
trap 'rm -f "$UPLOAD_LIST"' EXIT
tar -tzf "$SOURCE/uploads.tar.gz" > "$UPLOAD_LIST"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$UPLOAD_LIST" || grep -Evq '^uploads(/|$)' "$UPLOAD_LIST"; then
  echo "The upload archive contains an unsafe path." >&2
  exit 1
fi

UPLOADS_DIR="$ROOT_DIR/data/uploads"
[[ "$UPLOADS_DIR" == "$ROOT_DIR/data/uploads" && -d "$ROOT_DIR/data" ]] || exit 1
STAGED_UPLOADS="$ROOT_DIR/data/uploads.restore.$$"
OLD_UPLOADS="$ROOT_DIR/data/uploads.before-restore.$$"
install -d -m 750 "$STAGED_UPLOADS"
tar -C "$STAGED_UPLOADS" --strip-components=1 -xzf "$SOURCE/uploads.tar.gz"
chown -R 1000:1000 "$STAGED_UPLOADS"

# Restore into separate databases and prove both application schemas exist.
docker compose exec -T db dropdb -U wayfare --if-exists wayfare_restore
docker compose exec -T db createdb -U wayfare wayfare_restore
docker compose exec -T db pg_restore -U wayfare -d wayfare_restore --no-owner --no-privileges < "$SOURCE/database.dump"
docker compose exec -T db psql -U wayfare -d wayfare_restore -v ON_ERROR_STOP=1 -c 'select count(*) from schema_migrations' >/dev/null
docker compose exec -T logto-db dropdb -U logto --if-exists logto_restore
docker compose exec -T logto-db createdb -U logto logto_restore
docker compose exec -T logto-db pg_restore -U logto -d logto_restore --no-owner --no-privileges < "$SOURCE/logto.dump"
docker compose exec -T logto-db psql -U logto -d logto_restore -v ON_ERROR_STOP=1 -c 'select count(*) from applications' >/dev/null

docker compose stop api logto >/dev/null
docker compose exec -T db dropdb -U wayfare --if-exists wayfare_before_restore
docker compose exec -T db psql -U wayfare -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select pg_terminate_backend(pid) from pg_stat_activity where datname='wayfare' and pid<>pg_backend_pid();
alter database wayfare rename to wayfare_before_restore;
alter database wayfare_restore rename to wayfare;
SQL
docker compose exec -T logto-db dropdb -U logto --if-exists logto_before_restore
docker compose exec -T logto-db psql -U logto -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select pg_terminate_backend(pid) from pg_stat_activity where datname='logto' and pid<>pg_backend_pid();
alter database logto rename to logto_before_restore;
alter database logto_restore rename to logto;
SQL
mv "$UPLOADS_DIR" "$OLD_UPLOADS"
mv "$STAGED_UPLOADS" "$UPLOADS_DIR"
docker compose up -d api logto >/dev/null

READY=false
for _ in $(seq 1 30); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    && docker compose exec -T logto node -e "fetch('http://127.0.0.1:3001/oidc/.well-known/openid-configuration').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    READY=true
    break
  fi
  sleep 2
done
if [[ "$READY" != true ]]; then
  echo "Restored service failed health checks; rolling back." >&2
  docker compose stop api logto >/dev/null || true
  rm -rf -- "$UPLOADS_DIR"
  mv "$OLD_UPLOADS" "$UPLOADS_DIR"
  docker compose exec -T db psql -U wayfare -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select pg_terminate_backend(pid) from pg_stat_activity where datname='wayfare' and pid<>pg_backend_pid();
alter database wayfare rename to wayfare_failed_restore;
alter database wayfare_before_restore rename to wayfare;
SQL
  docker compose exec -T logto-db psql -U logto -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select pg_terminate_backend(pid) from pg_stat_activity where datname='logto' and pid<>pg_backend_pid();
alter database logto rename to logto_failed_restore;
alter database logto_before_restore rename to logto;
SQL
  docker compose up -d api logto >/dev/null
  exit 1
fi

docker compose exec -T db dropdb -U wayfare wayfare_before_restore
docker compose exec -T logto-db dropdb -U logto logto_before_restore
rm -rf -- "$OLD_UPLOADS"
rm -f "$UPLOAD_LIST"
trap - EXIT
echo "Restore completed from $SOURCE"
