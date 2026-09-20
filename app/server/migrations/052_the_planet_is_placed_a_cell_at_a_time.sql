/* Which zoom policy each cell was placed under, so the pass can be resumed.
 *
 * Migration 049 recorded that number once for the whole planet, and the
 * worker read it as "redo everything" — one statement over every place there
 * is. On ten million rows that is six zooms of window function over sixty-two
 * million rows and two full-table updates, and it was measured at eighteen
 * seconds for the single densest degree on Earth. It never once finished:
 * every deploy restarts the api, the api restarts the pass, and four deploys
 * in an evening meant four runs from zero and a carpet of dots still on the
 * phone. Nothing that takes longer than the gap between two releases may be
 * written as one statement that cannot be resumed.
 *
 * So the unit of work is the cell, which is the unit everything else in this
 * layer already uses: one degree, its own transaction, committed before the
 * next one starts. A restart costs the cell in flight and nothing else. The
 * rule is unchanged — the ingest has always placed a freshly loaded cell
 * against that cell's own bounds, and this makes the backfill do exactly what
 * the ingest does rather than a second, grander thing that only works on a
 * box nobody redeploys.
 *
 * Null means never placed, which is true of every cell loaded before the
 * column existed and is exactly the set that needs the work.
 */
alter table place_coverage add column if not exists zoom_policy smallint;

/* The queue this drains. Tiny — one row a degree, 53,333 of them — but it is
   read once per placed cell, and an index turns that from a scan into a
   lookup. Ordered as the worker orders it: what somebody is looking at
   first, then the densest, because the carpet is worst where the places are.
   */
create index if not exists place_coverage_zoom_idx
  on place_coverage (zoom_policy, priority, place_count desc);

/* Cells holding nothing need no pass and are marked in one statement by the
   worker rather than backfilled here, because the number to mark them with
   is the running code's policy and a migration must not have to know it. */
