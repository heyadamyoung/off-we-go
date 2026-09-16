/* When somebody actually got there, and when they actually left.

   A stop has carried its plan since the first migration — a day, and since
   031 a pair of clocks. What it has never carried is what happened. The live
   layer has been working an arrival out of the trail every few seconds for
   months, using it to decide which pin is lit, and throwing the time away.

   Two columns, because the finding must outlive the evidence. The fixes it is
   derived from are deleted after thirty days to keep a privacy promise, and a
   trip that starts forgetting itself a month after somebody gets home is not
   a trip anybody will open again.

   Nullable, and they stay null unless the trail says otherwise. Nothing may
   ever copy a planned time into one of these: the entire worth of the pair is
   that they are a different kind of fact from starts_at and ends_at, and a
   column that sometimes holds the plan is a column nobody can read. */

alter table stops add column if not exists arrived_at timestamptz;
alter table stops add column if not exists left_at timestamptz;

/* Which clock it happened on. The plan is a wall clock — "09:45", the way the
   ticket prints it — and these two are absolute instants, so saying both in
   one sentence needs the timezone of the place. The only thing that was
   definitely there is the phone that took the fix, and a phone has said which
   zone it is in since the first migration. Without this a grandmother in
   Sydney reads "arrived 19:20" about an Amsterdam morning. */
alter table stops add column if not exists visit_zone text;

/* Left null on purpose rather than backfilled. The trail for every trip older
   than thirty days is already gone, and the ones inside the window are stamped
   by the server the next time anybody loads them — from the same evidence, by
   the same rule, rather than by a second implementation written in SQL that
   would drift from the first the day either changed. */

/* A departure cannot precede an arrival, whatever a future writer believes.
   The rule lives here because this is the only place it cannot be forgotten. */
alter table stops drop constraint if exists stops_left_after_arrived;
alter table stops add constraint stops_left_after_arrived
  check (left_at is null or arrived_at is null or left_at >= arrived_at);

/* The timeline asks for a trip's stops in order and reads both. */
create index if not exists stops_arrived_idx on stops(trip_id, arrived_at);
