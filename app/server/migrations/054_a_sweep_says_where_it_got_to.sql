-- A planet sweep that can be watched from outside the box.
--
-- The question was "the sweep seems to have slowed or stopped", and it could
-- not be answered. The sweep knows exactly where it is — it builds a full
-- progress record every twenty-five row groups, with groups read, rows read,
-- cells loaded, places written, reads retried and groups set aside — and it
-- hands all of it to a log line on a box with no shell. The only way anybody
-- had to read it was to push a release and grep the deploy's output, which
-- gives one sample, of whatever moment the release happened to land on, and
-- so can never answer a question about a rate.
--
-- So the run writes itself down. One row per run, updated in place as it
-- goes: the plan it was given, how far through that plan it is, and a
-- heartbeat. Two reads a minute apart are a rate; a heartbeat that has not
-- moved is a stall, and telling those apart is the whole point.
--
-- Deliberately not a log table. A run is a single fact that changes, not a
-- stream of events — the events already exist, in the spans and in Loki — and
-- a table with one row per run per release is a table anybody can read at a
-- glance without a time window or an aggregation.

create table if not exists place_sweeps (
  id uuid primary key default gen_random_uuid(),
  -- Which release's bytes this run is reading, so a run against a release
  -- that has since been deleted is recognisable as such rather than as a
  -- mystery stall. Overture keeps two and deletes the older at about sixty
  -- days, which is a thing that has already happened to us mid-run.
  release text not null,
  started_at timestamptz not null default now(),
  -- The heartbeat, and the field that answers the question. Moved on every
  -- progress report, so `now() - seen_at` is how long since the run last got
  -- anywhere. A live run touches this every twenty-five row groups; a wedged
  -- one does not touch it at all.
  seen_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Null while it runs. Then one of: done, owing, interrupted, release moved,
  -- failed. Written by the script rather than constrained here, because the
  -- set of ways a planet run can end is a thing that has grown twice and a
  -- check constraint would have turned each of those into a migration.
  outcome text,
  note text,

  -- The plan, known before a byte is fetched.
  groups_planned integer not null default 0,
  rows_planned bigint not null default 0,
  cells_planned integer not null default 0,

  -- How far through it. rows_read against rows_planned is the honest measure
  -- of progress; cells_loaded is the one people care about and is bursty and
  -- back-loaded, because a square is only finished when the last group that
  -- overlaps it has been read.
  groups_read integer not null default 0,
  rows_read bigint not null default 0,
  cells_loaded integer not null default 0,
  places_written bigint not null default 0,
  cells_open integer not null default 0,

  -- The two that say the network or the bucket is the problem rather than us.
  -- A climbing retried with a still rows_read is exactly the shape of the
  -- reads against part-00004 that prompted all this.
  retried integer not null default 0,
  set_aside integer not null default 0
);

-- One question is ever asked of this table — "the most recent run" — and it
-- is asked by a public route, so it gets an index rather than a sort over
-- however many runs a year of restarts leaves behind.
create index if not exists place_sweeps_recent on place_sweeps (started_at desc);
