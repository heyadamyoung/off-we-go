#!/usr/bin/env bash
# Fold a file of KEY=VALUE lines into an existing .env: a key already in the
# file has its line replaced, a key that is not there is appended, and every
# other line is left exactly as it was. The values are secrets that arrive
# from the deployment pipeline, so they are copied through byte for byte —
# they hold ~, $ and \ — and never printed.
set -Eeuo pipefail

additions=${1:?usage: merge-env.sh ADDITIONS TARGET}
target=${2:?usage: merge-env.sh ADDITIONS TARGET}

if [[ ! -f "$additions" ]]; then
  echo "No release values at $additions." >&2
  exit 2
fi
if [[ ! -f "$target" ]]; then
  echo "No environment file at $target." >&2
  exit 2
fi

applied=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line=${line%$'\r'}
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  key=${line%%=*}
  value=${line#*=}
  if [[ "$key" == "$line" ]] || [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "Ignoring a release line that is not KEY=VALUE." >&2
    continue
  fi
  # A secret that is not configured must leave whatever is already on the box
  # alone, rather than blanking a working value.
  [[ -z "$value" ]] && continue

  scratch="$(mktemp "${target}.XXXXXX")"
  # The value goes through the environment, not -v, because awk expands
  # backslash escapes in a -v assignment and these are opaque bytes.
  MERGE_ENV_VALUE="$value" awk -v key="$key" '
    BEGIN { prefix = key "=" }
    !replaced && index($0, prefix) == 1 {
      print key "=" ENVIRON["MERGE_ENV_VALUE"]; replaced = 1; next
    }
    { print }
    END { if (!replaced) print key "=" ENVIRON["MERGE_ENV_VALUE"] }
  ' "$target" > "$scratch"
  chmod --reference="$target" "$scratch" 2>/dev/null || chmod 600 "$scratch"
  mv -f "$scratch" "$target"
  applied=$((applied + 1))
done < "$additions"

echo "Applied $applied release value(s) to $target."
