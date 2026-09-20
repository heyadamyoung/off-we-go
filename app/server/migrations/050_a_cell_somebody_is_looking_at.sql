/* Which cell the drain takes next, when a person is waiting on one of them.
 *
 * The queue had one ordering it could express: oldest ask first. That was
 * right when the queue was the cells travellers had asked about. It stopped
 * being right the moment the planet went in: there are 53,333 cells, the
 * drain takes four a minute, and a cell somebody is looking at right now
 * joins the back of a line forty-two thousand long. London was `pending`
 * with a traveller looking at it and nothing in the system would have
 * reached it for days — the sweep would have got there first, and the sweep
 * is measured in hours.
 *
 * So the same shape the enrichment queue already uses: a person beats a
 * batch. A viewport or a trip asking for a cell sets priority 0; the planet
 * backfill leaves it at 1. The claim orders by priority before requested_at,
 * so "oldest ask first" still decides between equals and a traveller never
 * waits behind the backfill.
 *
 * Existing rows default to 1, which is what they are: the planet, queued by
 * nobody in particular.
 */
alter table place_coverage add column if not exists priority smallint not null default 1;

/* The claim reads this every tick, so it is worth an index of its own. */
create index if not exists place_coverage_queue_idx
  on place_coverage (priority, requested_at)
  where status in ('pending', 'stale');
