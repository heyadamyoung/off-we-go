#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT=/opt/wayfare
readonly ROLLBACK_ROOT=/root/wayfare-rollback
readonly LOCK_FILE=/run/lock/wayfare-deploy.lock

original_command="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$original_command" =~ ^deploy[[:space:]]+([0-9a-f]{40})$ ]]; then
  echo "Refusing unauthorized deploy command." >&2
  exit 64
fi
readonly release_sha="${BASH_REMATCH[1]}"

exec 9>"$LOCK_FILE"
if ! flock -w 600 9; then
  echo "Another Off We Go deployment is still running." >&2
  exit 75
fi

staging_dir="$(mktemp -d /opt/wayfare-release.XXXXXX)"
archive_path="$(mktemp /opt/wayfare-release.XXXXXX.tgz)"
cleanup() {
  rm -rf -- "$staging_dir"
  rm -f -- "$archive_path"
}
trap cleanup EXIT

cat > "$archive_path"

while IFS= read -r entry; do
  case "$entry" in
    app|app/*) ;;
    *)
      echo "Archive contains a path outside app/: $entry" >&2
      exit 65
      ;;
  esac

  case "/$entry/" in
    *'/../'*|*'/./'*)
      echo "Archive contains an unsafe path: $entry" >&2
      exit 65
      ;;
  esac
done < <(tar -tzf "$archive_path")

tar --no-same-owner --no-same-permissions -xzf "$archive_path" -C "$staging_dir"
readonly staged_app="$staging_dir/app"

while IFS= read -r -d '' shell_script; do
  sed -i 's/\r$//' "$shell_script"
done < <(find "$staged_app/deploy" -type f -name '*.sh' -print0)

for required_path in docker-compose.yml package.json pnpm-lock.yaml server/Dockerfile Dockerfile.web deploy/Caddyfile; do
  if [[ ! -e "$staged_app/$required_path" ]]; then
    echo "Release is missing app/$required_path." >&2
    exit 66
  fi
done

install -d -m 700 "$ROLLBACK_ROOT/source-current"
rsync -a --delete \
  --exclude='/.env' \
  --exclude='/data/' \
  --exclude='/backups/' \
  --exclude='/.deployed-sha' \
  "$APP_ROOT/" "$ROLLBACK_ROOT/source-current/"

cd "$APP_ROOT"
bash ./deploy/backup.sh

if docker image inspect wayfare-api:latest >/dev/null 2>&1; then
  docker tag wayfare-api:latest wayfare-api:rollback
fi
if docker image inspect wayfare-web:latest >/dev/null 2>&1; then
  docker tag wayfare-web:latest wayfare-web:rollback
fi

rsync -a --delete \
  --exclude='/.env' \
  --exclude='/data/' \
  --exclude='/backups/' \
  --exclude='/.deployed-sha' \
  "$staged_app/" "$APP_ROOT/"

rollback() {
  local exit_code=$?
  trap - ERR
  echo "Deployment failed; restoring the previous release." >&2

  rsync -a --delete \
    --exclude='/.env' \
    --exclude='/data/' \
    --exclude='/backups/' \
    --exclude='/.deployed-sha' \
    "$ROLLBACK_ROOT/source-current/" "$APP_ROOT/"

  docker image inspect wayfare-api:rollback >/dev/null 2>&1 && docker tag wayfare-api:rollback wayfare-api:latest
  docker image inspect wayfare-web:rollback >/dev/null 2>&1 && docker tag wayfare-web:rollback wayfare-web:latest
  cd "$APP_ROOT"
  docker compose up -d --no-build --force-recreate --wait --wait-timeout 180 || true
  exit "$exit_code"
}
trap rollback ERR

cd "$APP_ROOT"
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
bash ./deploy/configure-logto.sh
deployment_domain="$(sed -n 's/^WAYFARE_DOMAIN=//p' .env | tail -n 1)"
if [[ -z "$deployment_domain" ]]; then
  echo "WAYFARE_DOMAIN is missing from $APP_ROOT/.env." >&2
  exit 67
fi
curl --fail --silent --show-error --retry 12 --retry-delay 5 \
  "https://${deployment_domain}/api/health" >/dev/null
bash -n "$APP_ROOT/deploy/github-deploy.sh"
install -o root -g root -m 755 \
  "$APP_ROOT/deploy/github-deploy.sh" /usr/local/sbin/wayfare-github-deploy
printf '%s\n' "$release_sha" > .deployed-sha
trap - ERR

echo "Off We Go deployed at $release_sha."
