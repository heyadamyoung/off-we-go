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
  IMAGE_TAG=rollback docker compose up -d --no-build --force-recreate --wait --wait-timeout 900 || true
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
# The schema first, in a container of its own, before anything is recreated.
#
# It used to happen inside the api's boot, and that is fine right up until a
# migration does real work. Migration 051 builds one GiST index over ten
# million places — minutes on this box — and during those minutes the api is
# not listening, so its healthcheck does not pass, so `web` waits on
# `depends_on: api: service_healthy` until Compose gives up. That limit is
# Compose's own and is not the --wait-timeout below: deploys 363 and 365 both
# died exactly 180 seconds after the api container started, and neither had
# anything wrong with it.
#
# A container's boot is measured against timeouts that belong to containers. A
# migration is not a boot — it is something the release does once — and this
# script can wait on it for as long as it takes. The previous release keeps
# serving throughout, which is what makes this better than patience: the site
# is up for the whole of it.
#
# Not `|| true`. A schema that will not migrate is the one thing that must
# stop a release, and the ERR trap restores the previous one.
migrate_with_new_image() {
  echo "Bringing the schema up to date before anything is recreated."
  docker compose run --rm -T api node server/scripts/migrate.mjs
}

# Fifteen minutes, which is the api healthcheck's start period and not a
# number picked for comfort. The two have to agree: compose stops waiting at
# --wait-timeout, the container is only called unhealthy after start_period,
# and while the timeout was the shorter of the two a boot inside its own
# allowance was rolled back as a failure. That is exactly what happened to
# deploy 363 — a migration building one GiST index over ten million places
# ran past three minutes, compose gave up, and a release that would have come
# up perfectly well was restored away. A genuinely broken release is still
# caught: the healthcheck probes every ten seconds once the start period is
# over, so this is patience with a boot, not with a failure.
if [[ -n "$registry_token" ]]; then
  # The images the pipeline built and tested, pulled rather than rebuilt here:
  # building on this box was a minute and a half of every deploy, three on a
  # cache miss. Signed in for the moment of the pull, and out again before
  # anything else happens; only the layers that changed cross the wire.
  printf '%s' "$registry_token" | docker login ghcr.io -u "$registry_user" --password-stdin
  registry_token=""
  docker compose pull --quiet api web
  docker logout ghcr.io >/dev/null 2>&1 || true
  migrate_with_new_image
  docker compose up -d --no-build --wait --wait-timeout 900
else
  docker compose build --quiet api
  migrate_with_new_image
  docker compose up -d --build --wait --wait-timeout 900
fi
deployment_domain="$(sed -n 's/^WAYFARE_DOMAIN=//p' .env | tail -n 1)"
if [[ -z "$deployment_domain" ]]; then
  echo "WAYFARE_DOMAIN is missing from $APP_ROOT/.env." >&2
  exit 67
fi
# --retry-all-errors, because --retry alone only covers curl's built-in
# transient list (408, 429, the classic 5xx). Cloudflare answers 521 while
# the web container's host port rebinds during the up, which is not on that
# list — so a one-second flap failed the whole deploy and rolled it back.
#
# Thirty tries rather than twelve: two and a half minutes. Deploy 364 came up
# with every container healthy and then answered 502 for the sixty seconds
# this allowed, because the first thing the api does after it starts
# listening is give the planet's places their zooms and that had the one
# database on this box pinned. The pass yields between cells now — see
# places/worker.js — and this is the other half of the same lesson: a box
# doing real work on the minute after a release is not a box that has failed,
# and rolling a good release back is the more expensive mistake.
curl --fail --silent --show-error --retry 30 --retry-delay 5 --retry-all-errors \
  "https://${deployment_domain}/api/health" >/dev/null
bash -n "$APP_ROOT/deploy/github-deploy.sh"
install -o root -g root -m 755 \
  "$APP_ROOT/deploy/github-deploy.sh" /usr/local/sbin/wayfare-github-deploy
printf '%s\n' "$release_sha" > .deployed-sha
trap - ERR

# Everything from here on is after the release. None of it is the release.
#
# The deploy's job is done at the health check above: the new code is running
# and the site answers. What follows — sign-in configuration, the day census,
# the planet sweep, the media cutover, pruning old images — is housekeeping
# that was already `|| true`, already unable to fail a release, and yet still
# held the deploy open for as long as it took. Deploy 368 was twenty-five
# minutes, and the release had been live for most of them.
#
# So it runs detached, and the deploy ends. `setsid` gives it a session of
# its own so closing the SSH channel cannot signal it; the redirections are
# what actually free the channel, because ssh waits on the pipe rather than
# on the process. It keeps its own log on the box, named here so anybody
# reading a deploy knows where the rest of the story went.
#
# Nothing in it may ever become load-bearing. A step that must succeed for
# the release to be good belongs above the health check, where it can fail
# the deploy and roll it back; a step down here cannot be waited on by
# anybody and must not pretend otherwise.
AFTER_LOG=/var/log/wayfare-after-release.log
after_release() {
  cd "$APP_ROOT" || return 0
  echo "--- after the release of $release_sha, $(date -u +%FT%TZ) ---"


  # What the day repair actually did, counted rather than assumed. Migrations
  # 025 and 026 are one-time and neither says a word about what it changed, so
  # this is how anybody finds out whether it reached the trips that needed it —
  # the same discipline as the media cutover below, which reports its files and
  # its failures rather than claiming success. Read-only, and never a reason a
  # deploy fails: a census that cannot run tells nobody anything, but a release
  # that is already live and answering is not worth rolling back over it.
  # Sign-in configuration, asserted again now the release is live.
  #
  # It was above the health gate and it was three minutes of deploy 364: the
  # script waits for Logto to finish seeding its own schema, up to a minute of
  # it, on every release — and a release that is otherwise perfect must not be
  # rolled back because somebody else's container is still starting.
  #
  # It is idempotent and it has been true for three hundred releases, so being
  # a minute late is nothing and being a reason to roll back is not nothing.
  # `|| true` for the same reason as the census below: said in the log, never a
  # release undone. If sign-in configuration is genuinely wrong the line here
  # says so, and it says so on a box that is up and answering.
  bash ./deploy/configure-logto.sh || true

  docker compose exec -T api node server/scripts/day-census.mjs || true

  # The planet, filling itself in the background.
  #
  # The queue inside the API drains four one-degree cells a minute, which is the
  # right rate for the cells a trip touches and about nine days for the 53,333
  # the Overture release has data in. Panning to somewhere nobody has been yet
  # finds empty ground until then, and that was the report.
  #
  # So the other job runs here: read the sixteen Parquet parts once each and put
  # every row into the cell it falls in (server/src/places/sweep.js). Measured at
  # 7,250 places a second, which is the whole planet in under three hours and
  # about 88 GB of table and index against the 544 GB this box has free.
  #
  # Its own profiled compose service rather than an `exec` into the API, and
  # that is the reason this line can run on every release: `compose up` does not
  # touch a profiled service, so a deploy no longer kills a run three hours in.
  # --resume means a restarted one pays only for the cells still owing, and a
  # run with nothing to do exits in seconds.
  #
  # Every line ends in `|| true`, like the capacity block below: a sweep that
  # will not start is worth a sentence in the log, and is not worth rolling back
  # a release that is live and answering.
  places_ask() {
    docker compose exec -T db psql -U wayfare -d wayfare -tAc "$1" 2>/dev/null | tr -d ' ' || true
  }
  echo "places: $(places_ask 'select count(*) from places') places in $(places_ask "select count(*) from place_coverage where status in ('ready','empty')") of 53333 cells"
  # `docker ps` by label rather than `docker compose ps`, and the reason is the
  # first run: `compose ps --profile sweep --status running -q` came back empty
  # while the sweep was demonstrably running — 8,357 cells covered between one
  # release and the next — so the deploy reported starting a sweep it had not
  # started. Harmless, because `up -d` on an unchanged service is a no-op, but a
  # line in a deploy log that is wrong about what it did is worse than no line.
  # The labels are Compose's own and need no profile to be visible, which is the
  # whole point; the cleanup below already reads them the same way.
  if [ -n "$(docker ps -q --filter status=running \
    --filter label=com.docker.compose.service=places-sweep 2>/dev/null || true)" ]; then
    echo "places: a sweep is already running; left alone"
  else
    # Why the last one stopped, before starting another.
    #
    # The first live planet run exited somewhere in the Atlantic and left an
    # exited container nobody could ask, because the deploy key is restricted to
    # `deploy <sha>` and there is no shell on this box. A run that ends has to
    # say so here or it has said so nowhere. Read-only, and `|| true` throughout.
    stopped_sweep="$(docker ps -aq --filter label=com.docker.compose.service=places-sweep \
      2>/dev/null | head -n 1 || true)"
    if [ -n "$stopped_sweep" ]; then
      echo "places: the last sweep exited $(docker inspect \
        -f '{{.State.ExitCode}} after {{.State.StartedAt}} to {{.State.FinishedAt}}' \
        "$stopped_sweep" 2>/dev/null || echo '?') — its last lines:"
      docker logs --tail 15 "$stopped_sweep" 2>&1 | sed 's/^/places:   /' || true
    fi
    if docker compose --profile sweep up -d --no-build places-sweep >/dev/null 2>&1; then
      echo "places: sweep started — docker compose logs -f places-sweep"
    else
      echo "places: the sweep could not be started"
    fi
  fi

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
  echo "--- done, $(date -u +%FT%TZ) ---"
}
# The three it needs, named rather than inherited by luck: a detached shell
# gets the environment and nothing else, so anything the body reads has to be
# exported here or it is empty on the box and silently does the wrong thing.
export APP_ROOT deployment_domain image_repo release_sha
setsid bash -c "$(declare -f after_release); after_release" \
  >> "$AFTER_LOG" 2>&1 < /dev/null &
disown || true
echo "Housekeeping detached; it writes to $AFTER_LOG on the box."

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
