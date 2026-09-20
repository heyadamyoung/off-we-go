/* Which zoom policy the stored zooms were computed under.
 *
 * label_zoom is computed once and read for ever, which is the point of it —
 * a tile is `label_zoom <= z` and nothing thinks at read time. The cost is
 * that changing how the number is decided leaves a table full of numbers
 * decided the old way, and nothing in the system can tell.
 *
 * The first time this bit, the column had just been added and every row was
 * null, so "has anything got no zoom" was an adequate question. It is not a
 * general one. This row is the general one: the worker compares it with the
 * policy the running code holds, and re-runs the whole pass when they differ.
 *
 * One row, no key, because there is exactly one answer and a table with a key
 * invites a second.
 */
create table if not exists place_zoom_policy (
  version int not null,
  applied_at timestamptz not null default now()
);

/* Nothing in it yet: an empty table reads as "computed under a policy nobody
   recorded", which is true of every row written before this migration and is
   exactly the case that must trigger a re-run. */
