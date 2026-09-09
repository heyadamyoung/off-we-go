#!/usr/bin/env bash
# Object storage, turned on by the deploy rather than by a person.
#
# This used to be a runbook: invent two secrets, put them in .env, set a
# compose profile, deploy, exec a migration, read its output, set one more
# variable, deploy again. Four steps, in an order that mattered, on a box
# somebody has to be logged into — and getting step three wrong meant every
# photograph on the volume with nothing pointing at it.
#
# None of it needed a person. The secrets can be made here and never leave
# the box; the migration already knows what it has and has not moved; and
# whether to switch over is answerable from the state of the bucket rather
# than from somebody's memory of whether they ran it.
#
# So it runs on every deploy and does nothing on almost all of them. There is
# no marker file and nothing to remember: the bucket's own contents are the
# progress, and S3_BUCKET in .env is the record of it being finished.
#
#   prepare  — before the stack comes up: credentials and the profile, so the
#              object store starts alongside everything else.
#   cutover  — after the release is live and answering: copy what is on the
#              volume, then point the app at the bucket, then prove it.
#
# Both are safe to run again, and neither can lose a photograph: the copy only
# ever copies, so the volume still holds everything until somebody deliberately
# reclaims it.
set -Eeuo pipefail

phase=${1:?usage: object-storage.sh prepare|cutover ENV_FILE [DOMAIN]}
env_file=${2:?usage: object-storage.sh prepare|cutover ENV_FILE [DOMAIN]}
domain=${3:-}
bucket_name=${OBJECT_STORE_BUCKET:-offwego-media}
# Long enough that a slow first copy finishes, bounded so a stuck one does not
# hold the deploy lock all night. An unfinished copy is not a failure: it has
# moved whatever it moved, and the next deploy carries on from there.
copy_timeout=${OBJECT_STORE_COPY_TIMEOUT:-1200}

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

value_of() { sed -n "s/^$1=//p" "$env_file" | tail -n 1; }

# One implementation of "set a key in .env", the same one the pipeline's own
# secrets go through: it replaces a line that is there and appends one that is
# not, and leaves every other byte alone.
apply() {
  local scratch
  scratch="$(mktemp)"
  cat > "$scratch"
  bash "$here/merge-env.sh" "$scratch" "$env_file" >/dev/null
  rm -f -- "$scratch"
}

# Hex rather than base64: this ends up in a URL signature and an .env line,
# and a secret containing / or + is a secret that eventually breaks one of them.
make_secret() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

already_live() { [[ -n "$(value_of S3_BUCKET)" ]]; }

case "$phase" in
  prepare)
    if already_live; then exit 0; fi

    root_password="$(value_of MINIO_ROOT_PASSWORD)"
    app_secret="$(value_of S3_SECRET_ACCESS_KEY)"
    [[ -z "$root_password" ]] && root_password="$(make_secret)"
    [[ -z "$app_secret" ]] && app_secret="$(make_secret)"

    profiles="$(value_of COMPOSE_PROFILES)"
    case ",$profiles," in
      *,objectstore,*) ;;
      *) profiles="${profiles:+$profiles,}objectstore" ;;
    esac

    # Only the two above are secret, and they are written once and read back
    # from the file on every deploy after this one.
    apply <<EOF
MINIO_ROOT_PASSWORD=$root_password
S3_SECRET_ACCESS_KEY=$app_secret
S3_ACCESS_KEY_ID=offwego-api
S3_ENDPOINT=http://minio:9000
S3_FORCE_PATH_STYLE=true
S3_REGION=auto
S3_BUCKET_NAME=$bucket_name
COMPOSE_PROFILES=$profiles
EOF
    echo "Object storage is configured; it comes up with this release."
    ;;

  cutover)
    if already_live; then exit 0; fi

    if ! docker compose ps --services --status running 2>/dev/null | grep -qx minio; then
      echo "The object store is not running yet; media stays on the volume." >&2
      exit 0
    fi

    # The copy is told the bucket by name rather than reading the app's own
    # configuration, because the app is deliberately still on the volume at
    # this point. Nothing is deleted and nothing points anywhere new until
    # this has finished and said so.
    echo "Copying media into the bucket before anything reads from it."
    if ! timeout "$copy_timeout" docker compose exec -T \
      -e S3_BUCKET="$bucket_name" api \
      node server/scripts/migrate-media-to-bucket.mjs; then
      echo "The media copy did not finish. Media stays on the volume, what was copied stays copied, and the next deploy carries on from there." >&2
      exit 0
    fi

    apply <<EOF
S3_BUCKET=$bucket_name
EOF
    docker compose up -d --wait --wait-timeout 120 api || true

    # Proved, not assumed. /api/health asks the file store whether it is
    # there, so a bucket the app cannot actually reach fails this — and the
    # one thing worse than not switching over is switching over into a trip
    # full of grey squares.
    if [[ -n "$domain" ]] && ! curl --fail --silent --show-error \
      --retry 6 --retry-delay 5 --retry-all-errors \
      "https://${domain}/api/health" >/dev/null; then
      echo "The app did not come back with the bucket configured; putting it back on the volume." >&2
      sed -i 's/^S3_BUCKET=.*/S3_BUCKET=/' "$env_file"
      docker compose up -d --wait --wait-timeout 120 api || true
      exit 0
    fi

    echo "Media is being served from the bucket. The volume still holds every byte until somebody reclaims it."
    ;;

  *)
    echo "usage: object-storage.sh prepare|cutover ENV_FILE [DOMAIN]" >&2
    exit 64
    ;;
esac
