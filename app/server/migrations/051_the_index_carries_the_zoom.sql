/* The spatial index carries the zoom, because the query asks for both.
 *
 * Every query a map makes asks two things at once: what is inside this box,
 * and what of it belongs on screen at this scale. The first was indexed and
 * the second was not, so Postgres fetched every row in the box from the heap
 * and then threw almost all of them away. Measured on one cell of 302,979
 * places, a phone-sized viewport over central Paris:
 *
 *     places the box contains    84,227
 *     places the zoom wants          56
 *     /api/places/in-view        98 ms   (parallel sequential scan)
 *     one z11 tile              155 ms
 *
 * The 56 were never in doubt. The 98 ms was the other 84,171 being read to
 * be discarded — and it grows with the city, which is why Toronto took four
 * seconds and Regina two hundred milliseconds for the same screen.
 *
 * A GiST index can hold a scalar beside the geometry (that is what btree_gist
 * is for), and then both halves of the question are answered in the index and
 * only the rows that survive both are fetched:
 *
 *     /api/places/in-view      2.09 ms   Bitmap Index Scan, 371 buffers
 *     one z11 tile             1.45 ms
 *
 * Two agreements make that happen and neither of them fails loudly — a query
 * written any other way is merely slow, never wrong, which is how this went
 * unnoticed in the first place. Both are stated in places/store.js beside the
 * statements that keep them, and both are covered by a test that reads the
 * query plan:
 *
 *   1. the expression is written identically here and in the query, literal
 *      for literal — `coalesce(label_zoom, 11::real)`, never a parameter in
 *      place of the 11, because the planner matches an expression index by
 *      its text and not by its meaning;
 *   2. the comparison is against `real`. `<= $1::double precision` widens the
 *      column instead of narrowing the constant, the index condition is lost,
 *      and the 155 ms tile above is exactly that cast.
 *
 * It replaces the geometry-only index rather than joining it. Measured on the
 * same cell, the two are indistinguishable on every other statement in the
 * layer — nearest-first 50.7 ms against 50.1 ms, ST_DWithin and && the same —
 * so a second copy of the same tree would be a gigabyte of disk and a second
 * write on every one of ten million ingested rows to buy nothing.
 */
create extension if not exists btree_gist;

/* And that is the whole of the migration. The index itself is built by the
 * worker, online, after the api is listening — places/worker.js buildTheIndex
 * and places/store.js PLACE_VIEW_INDEX, which is the one definition of it.
 *
 * It was here, and five releases in a row died of it. A migration runs inside
 * the api's boot; a boot is waited on by `compose up --wait` and by `web`'s
 * `depends_on: api: service_healthy`, and both of those give up in minutes.
 * Building a GiST index over ten million rows is not minutes on that box, so
 * the api never became healthy, the deploy restored the previous release, and
 * the half-built index rolled back with it. Then the next release did it all
 * again. The loop could not be broken from inside the migration, because the
 * deploy script that would have fixed it is only installed once a deploy
 * succeeds.
 *
 * So it is not a migration's kind of work and it is not written as one. The
 * worker builds it with CREATE INDEX CONCURRENTLY — no transaction, no
 * ACCESS EXCLUSIVE, writes carry on throughout — and drops the geometry-only
 * index it replaces once it is there. Until that has run the map's queries
 * use the old index and are slower. Slower is a thing you can ship; a boot
 * that never finishes is not.
 *
 * The extension stays here because it must exist before anything can build
 * that index, it costs milliseconds, and a schema is exactly where a thing
 * like that belongs.
 */
