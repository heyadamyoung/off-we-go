/* Every built tile, thrown away once.
 *
 * Reported from the road: pins at one zoom, nothing a zoom in, and it never
 * came back. The cause was in how tiles were kept rather than how they were
 * built. A square over ground nobody had ingested yet built empty — correctly,
 * there was nothing there — and then that emptiness was cached for ever,
 * because `place_tiles` was written `on conflict do nothing` and the only
 * thing that ever removed a row was an ingest of the exact ground under it.
 * A traveller panning over Scotland before Scotland was loaded therefore
 * cached a hole at every zoom they looked at, and the ground filling in half
 * an hour later did not fill the holes.
 *
 * The code no longer does either half of that: a tile whose cells are not all
 * ready is answered and not kept, a tile whose ground moved while it was
 * being encoded is declined, and a tile that is wrong can now be replaced
 * rather than only deleted. None of that repairs the rows already written, and
 * they are a cache — the worker rebuilds the warm ones within a tick and the
 * rest are built on first sight. So they go.
 *
 * Cheap, and safe to run again: the table is derived data with no foreign
 * keys pointing at it. */
truncate table place_tiles;
