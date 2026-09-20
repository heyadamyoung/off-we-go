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

/* Larger than the default for the duration of the build only; this is one
   index over every place we hold and the sort is the whole of the cost. */
set local maintenance_work_mem = '256MB';

/* The old one first, then the new one. Nothing reads either while this runs
   — the api has not started listening — and building the replacement with
   its predecessor still on disk is a second copy of the same tree to hold
   and no benefit at all. */
drop index if exists places_geom_idx;

create index if not exists places_view_idx
  on places using gist (geom, (coalesce(label_zoom, 11::real)));

/* Every tile again. The ones already built are correct — this migration
   changes how they are found, not what is in them — so they stay. */
