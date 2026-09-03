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

# Everything the two image builds read. A release that omits one of these
# is rejected here, with the missing name, rather than failing minutes
# later as an unreadable docker cache-key error.
for required_path in docker-compose.yml package.json pnpm-lock.yaml server/Dockerfile Dockerfile.web vite.config.ts tsconfig.json src public scripts/check-release-assets.mjs deploy/Caddyfile; do
  if [[ ! -e "$staged_app/$required_path" ]]; then
    echo "Release is missing app/$required_path." >&2
    exit 66
  fi
done

# The pipeline carries the values nobody wants to edit on the box by hand.
# They are merged into the live .env before anything is built with it, and the
# copy that arrived is destroyed here so it never reaches /opt/wayfare.
readonly release_env="$staged_app/deploy/release.env"
if [[ -f "$release_env" ]]; then
  install -d -m 700 "$ROLLBACK_ROOT"
  install -m 600 "$APP_ROOT/.env" "$ROLLBACK_ROOT/env-previous"
  bash "$staged_app/deploy/merge-env.sh" "$release_env" "$APP_ROOT/.env"
fi
shred -u -- "$release_env" 2>/dev/null || rm -f -- "$release_env"

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
  --exclude='/deploy/release.env' \
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

# The attractions seed is versioned: bump the number when the seeding policy
# changes and the next deploy walks the default regions again. Detached —
# Wikipedia at two calls a second takes hours — and the marker is written only
# after a walk finishes, so an interrupted seed simply resumes next deploy.
# Marker and log live in data/ because rsync --delete sweeps everything else.
# The throwaway container installs dev dependencies (tsx) into the release
# tree; the next deploy's rsync clears that away too.
#   Version 2: no editorial filter — every geotagged article earns a row.
readonly ATTRACTIONS_SEED_VERSION=2
seed_marker="$APP_ROOT/data/attractions-seed-version"
if [[ "$(cat "$seed_marker" 2>/dev/null)" != "$ATTRACTIONS_SEED_VERSION" ]]; then
  echo "Attractions seed wants version $ATTRACTIONS_SEED_VERSION; walking the default regions in the background."
  mkdir -p "$APP_ROOT/data"
  # Stop any superseded walker first: two at once would fight over Wikipedia's
  # rate limit, and every row the old one writes is rewritten by the new one.
  docker ps -q \
    --filter label=com.docker.compose.oneoff=True \
    --filter label=com.docker.compose.service=api \
    | xargs -r docker stop || true
  setsid nohup docker compose run --rm --no-deps --user root \
    -v "$APP_ROOT:/seed" -w /seed --entrypoint sh api \
    -c "corepack enable && pnpm install --frozen-lockfile && pnpm exec tsx scripts/seed-attractions.mjs && echo $ATTRACTIONS_SEED_VERSION > /seed/data/attractions-seed-version" \
    > "$APP_ROOT/data/seed-attractions.log" 2>&1 < /dev/null &
fi

echo "Off We Go deployed at $release_sha."
