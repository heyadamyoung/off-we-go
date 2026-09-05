#!/bin/sh
# The routing engine's supervisor: nobody names an extract by hand. The api
# derives the wanted list from where the trips' stops actually are
# (server/src/coverage.js) and writes it to the shared tiles volume; this loop
# downloads the extracts, rebuilds, and (re)starts the service. Plan a trip
# somewhere new and the roads follow.
#
# Two lessons paid for in verification time, kept here so nobody re-learns
# them: the image only downloads extracts "if no PBFs were found", so growth
# must download its own; and its incremental build/tar paths silently discard
# a grown region (the tar the service loads is only written when absent) —
# force_rebuild=True is the image's own path that both rebuilds and re-tars
# with --overwrite. Growth is rare; correctness beats incrementalism.
set -u

WANTED=/custom_files/wanted_tile_urls
BUILT=/custom_files/.built_tile_urls

# The api container (uid 1000) must be able to write the wanted list into a
# volume this image created as root.
mkdir -p /custom_files
chmod 777 /custom_files

# The clean-slate lever, pulled from compose: bump SUPERVISOR_REV and the next
# start throws away every extract and marker for a from-scratch download and
# build. The volume once held truncated pbfs from an era of silent downloads,
# and the build died in two seconds saying almost nothing.
REV="${SUPERVISOR_REV:-0}"
if [ "$REV" != "$(cat /custom_files/.rev 2>/dev/null)" ]; then
  echo "valhalla supervisor: rev $REV - clearing extracts and tiles for a clean rebuild"
  rm -rf /custom_files/*.osm.pbf /custom_files/valhalla_tiles /custom_files/valhalla_tiles.tar "$BUILT"
  printf %s "$REV" >/custom_files/.rev
fi

SERVICE_PID=""
launch() { # $1: force_rebuild for the image's entrypoint
  if [ -n "$SERVICE_PID" ]; then
    kill "$(pidof valhalla_service)" "$SERVICE_PID" 2>/dev/null
    wait "$SERVICE_PID" 2>/dev/null
  fi
  # use_tiles_ignore_pbf=False is trap (2) from the verification notes: the
  # image's True default serves whatever tiles exist and ignores new pbfs.
  tile_urls="$(tr '\n' ' ' <"$WANTED")" serve_tiles=True force_rebuild="$1" \
    use_tiles_ignore_pbf=False \
    /valhalla/scripts/docker-entrypoint.sh build_tiles &
  SERVICE_PID=$!
}

echo "valhalla supervisor: waiting for coverage at $WANTED"
while true; do
  if [ -s "$WANTED" ] && ! cmp -s "$WANTED" "$BUILT" 2>/dev/null; then
    echo "valhalla supervisor: coverage changed, building: $(tr '\n' ' ' <"$WANTED")"
    while IFS= read -r url; do
      fp="/custom_files/$(basename "$url")"
      if [ ! -s "$fp" ]; then
        echo "valhalla supervisor: downloading $url"
        # A failed download says so and leaves nothing behind: a truncated pbf
        # passes -s forever and poisons every build after it, silently.
        curl --location --fail -o "$fp" "$url" || {
          echo "valhalla supervisor: download FAILED for $url"
          rm -f "$fp"
        }
      fi
    done <"$WANTED"
    cp "$WANTED" "$BUILT"
    launch True
  elif [ -s "$WANTED" ] && [ -z "$SERVICE_PID" ]; then
    # A container restart with unchanged coverage: the tiles and tar are on
    # the volume already — serve them, build nothing.
    echo "valhalla supervisor: coverage unchanged, serving existing tiles"
    launch False
  fi
  sleep 60
done
