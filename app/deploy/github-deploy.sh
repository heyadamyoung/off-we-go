#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT=/opt/wayfare
readonly ROLLBACK_ROOT=/root/wayfare-rollback
readonly LOCK_FILE=/run/lock/wayfare-deploy.lock

# This script runs twice, and the second time it is the copy that was just
# pushed.
#
# It used to run once, as the copy installed by the last deploy that
# succeeded — and that was the worst property this repository had. A fix to
# the deploy could not take effect until a deploy had already worked, which
# is exactly the case in which nobody needs one. Releases 363 through 367
# all failed on the same line and every fix for it sat in the repository
# unread, because none of those five deploys reached the install at the
# bottom of this file. The loop could only be broken by a release that
# happened not to need the fix.
#
# It bought nothing, either. `backup.sh`, `configure-logto.sh` and
# `object-storage.sh` are all run from the pushed copy on the same deploy
# that pushes them; only this one file had the lag. What actually restricts
# this key is the forced command — `deploy <40 hex>` and nothing else — and
# that is enforced below, on every pass, before anything is read.
#
# So: the first pass is a bootstrap that never changes. It checks the
# command, takes the lock, receives the archive, refuses any path outside
# app/, unpacks it, and hands over to the deploy script inside it. The
# handover happens before a single byte of /opt/wayfare has been touched, so
# a release carrying a broken script fails having changed nothing — which is
# a better failure than today's, where a broken script could be installed by
# a deploy that happened to succeed and then break every deploy after it.
#
# The second pass is everything below the handover, and it is this release's
# own. Keep the bootstrap small; it is the only part that still takes a
# deploy to update.
if [[ -z "${WAYFARE_STAGED:-}" ]]; then
  original_command="${SSH_ORIGINAL_COMMAND:-}"
  if [[ ! "$original_command" =~ ^deploy[[:space:]]+([0-9a-f]{40})$ ]]; then
    echo "Refusing unauthorized deploy command." >&2
    exit 64
  fi
  bootstrap_sha="${BASH_REMATCH[1]}"

  # Ninety seconds, not ten minutes.
  #
  # One release at a time on this box is right; waiting out a predecessor is
  # not. Deploy 370 spent 2m06s here before it printed a single line, because
  # 369 had been cancelled and its script was still holding the lock — a run
  # nobody was watching, whose work was already superseded, charging the run
  # that replaced it. Ten minutes of patience cannot distinguish that from a
  # healthy deploy, and either way the answer is the same: this release is
  # not going out in the next ninety seconds, so fail now and say what is
  # holding it, rather than eating the budget in silence.
  #
  # The lock is an open file description on fd 9, so it is held across the
  # exec below rather than dropped and retaken — the two passes are one
  # process and one PID.
  exec 9>"$LOCK_FILE"
  if ! flock -w 90 9; then
    echo "Another Off We Go deployment is still running:" >&2
    fuser -v "$LOCK_FILE" >&2 2>&1 || true
    exit 75
  fi

  # A handover that fails to exec leaves its staging directory behind, which
  # is the one path out of here that cannot clean up after itself.
  find /opt -maxdepth 1 -name 'wayfare-release.*' -mtime +1 -exec rm -rf -- {} + 2>/dev/null || true

  bootstrap_staging="$(mktemp -d /opt/wayfare-release.XXXXXX)"
  bootstrap_archive="$(mktemp /opt/wayfare-release.XXXXXX.tgz)"
  trap 'rm -rf -- "$bootstrap_staging" "$bootstrap_archive"' EXIT

  cat > "$bootstrap_archive"

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
  done < <(tar -tzf "$bootstrap_archive")

  tar --no-same-owner --no-same-permissions -xzf "$bootstrap_archive" -C "$bootstrap_staging"
  rm -f -- "$bootstrap_archive"

  readonly handover="$bootstrap_staging/app/deploy/github-deploy.sh"
  if [[ ! -f "$handover" ]]; then
    echo "Release is missing app/deploy/github-deploy.sh." >&2
    exit 66
  fi
  sed -i 's/\r$//' "$handover"

  # Nothing on the box has changed yet, and from here it is the release's
  # own script that decides what does.
  trap - EXIT
  export WAYFARE_STAGED="$bootstrap_staging" WAYFARE_RELEASE_SHA="$bootstrap_sha"
  exec bash "$handover"
fi

# ---------------------------------------------------------------------------
# The release's own deploy, with its tree already unpacked and the lock held.
# ---------------------------------------------------------------------------
readonly release_sha="$WAYFARE_RELEASE_SHA"

readonly staging_dir="$WAYFARE_STAGED"
cleanup() {
  rm -rf -- "$staging_dir"
}
trap cleanup EXIT
readonly staged_app="$staging_dir/app"

while IFS= read -r -d '' shell_script; do
  sed -i 's/\r$//' "$shell_script"
done < <(find "$staged_app/deploy" -type f -name '*.sh' -print0)

# Everything the two image builds read. A release that omits one of these
# is rejected here, with the missing name, rather than failing minutes
# later as an unreadable docker cache-key error.
for required_path in docker-compose.yml package.json pnpm-lock.yaml server/Dockerfile Dockerfile.web vite.config.ts tsconfig.json src public scripts/check-release-assets.mjs deploy/github-deploy.sh deploy/Caddyfile deploy/alloy.config deploy/object-storage.sh server/scripts/migrate-media-to-bucket.mjs server/scripts/day-census.mjs; do
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
# The schema is applied by the api as it boots, and the deploy creates no
# container to do it.
#
# It was a step here for four releases, and the measurements say it should not
# have been. Creating the one-off container cost 1m56s in deploy 370 and 2m51s
# in 374, either side of two seconds of SQL — so the fix in 372 was to strip
# that container to a service with no volumes, no instrumentation and no
# dependencies. It made no difference; 374's 2m51s is the stripped one. And
# deploy 373 created the *unstripped* container, with all four mounts, in 8.8
# seconds.
#
# Same box, same command, 8.8 seconds against 2m51s, six minutes apart. The
# container was never the variable. What is running beside it is: the planet
# sweep has been going since deploy 370, reading sixteen Parquet parts at
# 7,250 records a second across all sixteen cores, and a container create
# queues behind it for the disk. Which is why the sweep is paused below for
# the length of the swap.
#
# The reason this was ever extracted from the boot is gone. It was migration
# 051 building a GiST index over ten million rows: the api could not listen
# while it ran, so its healthcheck could not pass, so `web` sat on
# `depends_on: api: service_healthy` until Compose gave up at three minutes —
# deploys 363 and 365, both dead exactly 180 seconds in with nothing wrong
# with them. That index is built by the worker now, online and after the api
# is serving, and migration 051 is one `create extension` line.
#
# What makes it safe to put back is not that, though. It is the guard from
# 201: a migration changes the schema and never does work whose size depends
# on how much data there is. Every migration is bounded by rule, the whole
# set of 53 applies in 0.4 seconds, and the api has always migrated on boot
# anyway — index.js does it before it listens, which is what makes a fresh box
# and a hand start work. So the deploy step was applying a schema that the
# container it was about to start would have applied itself, and paying a
# container create for the privilege.
#
# server/scripts/migrate.mjs and the profiled `migrate` service stay, for a
# schema that has to be moved by hand without recreating anything:
#
#     docker compose --profile migrate run --rm migrate

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
#
# The planet sweep stands aside for the length of the swap.
#
# Not a cap — there was one for a release, four cores of sixteen, and it was
# the wrong lever on a box with sixteen cores and sixty-two gigabytes. This is
# the right one: the two are not made to share, they are made to take turns.
# A container create on this box is 8.8 seconds with the sweep between phases
# and 2m51s with it reading Parquet, and a deploy is a person waiting while a
# backfill that nobody is waiting for holds the disk.
#
# It costs the sweep the cell in flight and nothing else — `--resume` means the
# run started again in the housekeeping below pays for that one cell — against
# a deploy that is the same length every time instead of a lottery. `stop` is
# how the service is meant to be stopped; the coverage rows are the record of
# what is done, and a half-written cell is abandoned rather than committed.
docker compose --profile sweep stop -t 20 places-sweep >/dev/null 2>&1 || true
if [[ -n "$registry_token" ]]; then
  # The images the pipeline built and tested, pulled rather than rebuilt here:
  # building on this box was a minute and a half of every deploy, three on a
  # cache miss. Signed in for the moment of the pull, and out again before
  # anything else happens; only the layers that changed cross the wire.
  printf '%s' "$registry_token" | docker login ghcr.io -u "$registry_user" --password-stdin
  registry_token=""
  docker compose pull --quiet api web
  docker logout ghcr.io >/dev/null 2>&1 || true
  docker compose up -d --no-build --wait --wait-timeout 900
else
  docker compose build --quiet api
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
# The bootstrap, kept current. It is no longer what decides how a release is
# deployed — the handover at the top of this file means every deploy runs the
# script it shipped with — so what this keeps up to date is only the first
# thirty lines: the forced command's check, the lock, and unpacking the
# archive. Still installed, for two reasons. A hand deploy or install.sh has
# to start somewhere. And if a release ever arrives with no deploy script
# inside it, the copy here refuses it by name rather than the box having
# nothing to run at all.
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
  # Why the last one stopped, if it did.
  #
  # The first live planet run exited somewhere in the Atlantic and left an
  # exited container nobody could ask, because the deploy key is restricted to
  # `deploy <sha>` and there is no shell on this box. A run that ends has to
  # say so here or it has said so nowhere. Read-only, and `|| true` throughout.
  if [ -z "$(docker ps -q --filter status=running \
    --filter label=com.docker.compose.service=places-sweep 2>/dev/null || true)" ]; then
    stopped_sweep="$(docker ps -aq --filter label=com.docker.compose.service=places-sweep \
      2>/dev/null | head -n 1 || true)"
    if [ -n "$stopped_sweep" ]; then
      echo "places: the last sweep exited $(docker inspect \
        -f '{{.State.ExitCode}} after {{.State.StartedAt}} to {{.State.FinishedAt}}' \
        "$stopped_sweep" 2>/dev/null || echo '?') — its last lines:"
      docker logs --tail 15 "$stopped_sweep" 2>&1 | sed 's/^/places:   /' || true
    fi
  fi

  # And then `up`, whether or not one is running.
  #
  # This used to be skipped entirely when a sweep was up, so that a release
  # could not kill a run three hours in. That is what the profile is for —
  # `compose up` does not touch a profiled service — and naming the service
  # here does not undo it: `up -d` on a service whose configuration has not
  # changed is a no-op, and a running sweep is left exactly alone.
  #
  # What the skip also prevented was a configuration change ever reaching it.
  # The sweep has just been given four cores of sixteen and a low block-IO
  # weight, precisely so it cannot pin the box during a deploy — and with the
  # skip in place the container already running would have kept the whole
  # machine until the day it happened to exit. A recreate costs the cell in
  # flight; `--resume` means the next run pays for that one and nothing else.
  # The restart is not here any more. It is above the detach, beside the
  # census, because the census reports on it: with the start down here the
  # deploy said "no sweep running" on every release — true for the second it
  # was asked, false a moment later, and indistinguishable from a sweep that
  # had genuinely died. See "the sweep goes back to work" above.

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

# The sweep goes back to work.
#
# It was stopped before the swap so it could not hold the disk while the
# containers changed over — see the stop above — and this is the other half of
# that. `--resume` means it pays for the cell that was in flight and nothing
# else.
#
# Above the census rather than in the detached housekeeping, and that ordering
# is the whole point: the census reports whether a sweep is running, and with
# the start detached it raced and lost every time. Deploy 380 read "no sweep
# running; the last one exited 1" ninety seconds after the stop — true at the
# instant it was asked, false a moment later, and identical to what a sweep
# that had genuinely died would print. `up -d` returns as soon as the
# container is started; what takes hours is the running, and nothing waits for
# that.
if docker compose --profile sweep up -d --no-build places-sweep >/dev/null 2>&1; then
  echo "places: the sweep is back at work — docker compose logs -f places-sweep"
else
  echo "places: the sweep could not be started"
fi

# Where the planet has got to, in the log a person actually reads.
#
# This used to be here and #202 took it with the rest of the housekeeping,
# which was the wrong call: the other lines down there are things the deploy
# *does*, and a detached log is the right place for those. This is the one
# thing the deploy *reports*, on a box with no shell and a key restricted to
# one command — so sending it to a file nobody can open means the only answer
# to "is the sweep still going, and how much of the world do we hold" is the
# size of a docker volume.
#
# One statement, read-only, `|| true`: a release that is live and answering is
# not rolled back over a count.
#
# The zoom backlog is two numbers and the first version of this reported one
# of them. `zoom_policy is null` is a cell the pass has never touched; a cell
# ranked under an older rule is equally owing, and rank.js ZOOM_POLICY had
# just gone from 2 to 3, so twelve thousand cells were backlog the census
# could not see and the deploy log said 617. A report that undercounts the
# thing it exists to report is the failure this whole block was added to fix.
#
# Against `max(zoom_policy)` rather than a number copied into bash: the
# newest rule any cell has been placed under is a fact the table already
# holds, and a constant duplicated here is a constant that drifts.
#
# `ingesting` is here for the same reason — the pass skips those cells by
# design, because another process is inside their transaction, so a cell
# wedged in `ingesting` is backlog that looks like nothing at all.
places_now() {
  docker compose exec -T db psql -U wayfare -d wayfare -tAc "$1" 2>/dev/null | tr -d ' ' || true
}
echo "places: $(places_now 'select count(*) from places') places in \
$(places_now "select count(*) from place_coverage where status in ('ready','empty')") of 53333 cells"
echo "places: $(places_now "
  select
    count(*) filter (where zoom_policy is null) || ' never zoomed, ' ||
    count(*) filter (
      where zoom_policy is not null
        and zoom_policy <> (select max(zoom_policy) from place_coverage)
    ) || ' under an older rule, ' ||
    count(*) filter (where status = 'ingesting') || ' mid-ingest'
  from place_coverage")"
if [ -n "$(docker ps -q --filter status=running \
  --filter label=com.docker.compose.service=places-sweep 2>/dev/null || true)" ]; then
  echo "places: the sweep is running"
else
  last_sweep="$(docker ps -aq --filter label=com.docker.compose.service=places-sweep \
    --latest 2>/dev/null || true)"
  if [ -n "$last_sweep" ]; then
    echo "places: no sweep running; the last one exited $(docker inspect \
      --format '{{.State.ExitCode}} at {{.State.FinishedAt}}' "$last_sweep" 2>/dev/null || echo '?')"
  else
    echo "places: no sweep has ever run on this box"
  fi
fi

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
