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
for required_path in docker-compose.yml package.json pnpm-lock.yaml server/Dockerfile Dockerfile.web vite.config.ts tsconfig.json src public scripts/check-release-assets.mjs deploy/Caddyfile deploy/alloy.config deploy/object-storage.sh server/scripts/migrate-media-to-bucket.mjs server/scripts/day-census.mjs; do
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

# The pipeline's own short-lived token, for pulling the images it built and
# tested. Read from the staged copy, used once below, and destroyed: it never
# reaches /opt/wayfare, and a release that carries none — install.sh, a hand
# deploy — builds the images here from the same Dockerfiles instead.
readonly registry_env="$staged_app/deploy/registry.env"
registry_user=""
registry_token=""
if [[ -f "$registry_env" ]]; then
  registry_user="$(sed -n 's/^REGISTRY_USER=//p' "$registry_env" | tail -n 1)"
  registry_token="$(sed -n 's/^REGISTRY_TOKEN=//p' "$registry_env" | tail -n 1)"
fi
shred -u -- "$registry_env" 2>/dev/null || rm -f -- "$registry_env"
rm -f -- "$APP_ROOT/deploy/registry.env"
image_repo="$(sed -n 's/^IMAGE_REPO=//p' "$APP_ROOT/.env" | tail -n 1)"
image_repo="${image_repo:-ghcr.io/heyadamyoung/off-we-go}"

install -d -m 700 "$ROLLBACK_ROOT/source-current"
rsync -a --delete \
  --exclude='/.env' \
  --exclude='/data/' \
  --exclude='/backups/' \
  --exclude='/.deployed-sha' \
  "$APP_ROOT/" "$ROLLBACK_ROOT/source-current/"

cd "$APP_ROOT"
# The databases, before anything is touched, without stopping anything: the
# full backup with the uploads is the nightly run's, and taking the site down
# for a minute and a half on every release to archive a volume was most of
# the deploy.
bash ./deploy/backup.sh quick

# The way back is whatever is running now, by image rather than by tag: a
# pulled release and a built one both leave it on the box, and a rollback
# starts it again under this one name.
for image in api web; do
  running="$(docker compose images -q "$image" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$running" ]]; then
    docker tag "$running" "$image_repo/$image:rollback"
  fi
done

rsync -a --delete \
  --exclude='/deploy/release.env' \
  --exclude='/deploy/registry.env' \
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

  cd "$APP_ROOT"
  # The images that were running, under the tag the release replaced; written
  # to .env too, so the box and its file agree until the next release.
  printf 'IMAGE_TAG=rollback\n' > "$ROLLBACK_ROOT/env-rollback"
  bash ./deploy/merge-env.sh "$ROLLBACK_ROOT/env-rollback" "$APP_ROOT/.env" || true
  IMAGE_TAG=rollback docker compose up -d --no-build --force-recreate --wait --wait-timeout 180 || true
  exit "$exit_code"
}
trap rollback ERR

cd "$APP_ROOT"
# Credentials and the compose profile for the object store, made here on the
# first deploy that sees none and read back from .env on every one after. It
# does nothing once media is already served from the bucket.
bash ./deploy/object-storage.sh prepare "$APP_ROOT/.env"
docker compose config --quiet
# The release sha reaches the web build so browser telemetry can be sliced
# by deploy.
export RELEASE_SHA="$release_sha"
if [[ -n "$registry_token" ]]; then
  # The images the pipeline built and tested, pulled rather than rebuilt here:
  # building on this box was a minute and a half of every deploy, three on a
  # cache miss. Signed in for the moment of the pull, and out again before
  # anything else happens; only the layers that changed cross the wire.
  printf '%s' "$registry_token" | docker login ghcr.io -u "$registry_user" --password-stdin
  registry_token=""
  docker compose pull --quiet api web
  docker logout ghcr.io >/dev/null 2>&1 || true
  docker compose up -d --no-build --wait --wait-timeout 180
else
  docker compose up -d --build --wait --wait-timeout 180
fi
bash ./deploy/configure-logto.sh
deployment_domain="$(sed -n 's/^WAYFARE_DOMAIN=//p' .env | tail -n 1)"
if [[ -z "$deployment_domain" ]]; then
  echo "WAYFARE_DOMAIN is missing from $APP_ROOT/.env." >&2
  exit 67
fi
# --retry-all-errors, because --retry alone only covers curl's built-in
# transient list (408, 429, the classic 5xx). Cloudflare answers 521 while
# the web container's host port rebinds during the up, which is not on that
# list — so a one-second flap failed the whole deploy and rolled it back.
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors \
  "https://${deployment_domain}/api/health" >/dev/null
bash -n "$APP_ROOT/deploy/github-deploy.sh"
install -o root -g root -m 755 \
  "$APP_ROOT/deploy/github-deploy.sh" /usr/local/sbin/wayfare-github-deploy
printf '%s\n' "$release_sha" > .deployed-sha
trap - ERR

# What the day repair actually did, counted rather than assumed. Migrations
# 025 and 026 are one-time and neither says a word about what it changed, so
# this is how anybody finds out whether it reached the trips that needed it —
# the same discipline as the media cutover below, which reports its files and
# its failures rather than claiming success. Read-only, and never a reason a
# deploy fails: a census that cannot run tells nobody anything, but a release
# that is already live and answering is not worth rolling back over it.
docker compose exec -T api node server/scripts/day-census.mjs || true

# Media onto the object store, once, with the release already live and
# answering. Deliberately after the trap comes off: a copy that will not
# finish must not roll back a deploy that is otherwise perfectly good, and
# this leaves the app reading the volume when anything goes wrong.
bash ./deploy/object-storage.sh cutover "$APP_ROOT/.env" "$deployment_domain" || true

# The attractions seed is gone, and a walker left running from a previous
# release is stopped here.
#
# It walked Wikipedia's geosearch at two calls a second to fill a table the
# map drew its pins from — but only for the regions it was ever pointed at,
# which were the Netherlands and Scotland. Everywhere else the map asked
# Wikipedia live from somebody's phone and got rate-limited. The places layer
# answers anywhere from our own database now (see docs/places-layer.md), so
# the walk is hours of somebody else's bandwidth for two countries we already
# cover better.
#
# The table and its route stay for this release so a rollback has something to
# roll back to; migration 044 drops them.
docker ps -q \
  --filter label=com.docker.compose.oneoff=True \
  --filter label=com.docker.compose.service=api \
  | xargs -r docker stop || true
rm -f "$APP_ROOT/data/attractions-seed-version" || true

# The disk is the quietest way this box dies: dangling images and build
# cache from many deploys a day. Dangling only — the :rollback tags must
# survive — and the builder keeps a working set so rebuilds stay quick.
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --keep-storage 8GB >/dev/null 2>&1 || true
# Pulled releases are kept by commit; the newest two are the running one and
# the way back, and the rest are disk.
for image in api web; do
  docker image ls --format '{{.Tag}}' "$image_repo/$image" 2>/dev/null \
    | grep -E '^[0-9a-f]{40}$' | tail -n +3 \
    | xargs -r -I{} docker image rm "$image_repo/$image:{}" >/dev/null 2>&1 || true
done

# What the box has left, in the deploy log.
#
# Nothing else reports this. The deploy key is restricted to this one
# command — deliberately, and a capacity probe over SSH is rightly refused —
# so the deploy is the only place on the machine that can say. It matters
# now: the places layer holds tens of gigabytes of open data, and the
# honest answer to "will the planet fit" has until now been a guess.
echo
echo "--- capacity ---"
# Every line below ends in `|| true`. The script runs under `set -Eeuo
# pipefail`, so a df against a path that is not a mount, or a du over a
# directory root cannot read, would fail the pipeline and fail a deploy that
# had already succeeded — a release rolled back to report a disk reading.
df -h / /var/lib/docker 2>/dev/null | awk 'NR==1 || !seen[$1]++' || true
free -h 2>/dev/null | awk '/^Mem:/{print "memory: "$2" total, "$7" available"}' || true
echo "cores: $(nproc 2>/dev/null || echo unknown)"
du -sh /var/lib/docker/volumes/* 2>/dev/null | sort -h | tail -5 | sed 's/^/volume: /' || true
echo "--- end capacity ---"
echo

echo "Off We Go deployed at $release_sha."
