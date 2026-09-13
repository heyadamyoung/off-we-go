/* Renumber every trip's stops so the sequence reads the way the day does.

   The sequence number decides where a stop sits when the clock cannot, and it
   has been quietly broken for as long as there have been two ways to add a
   stop. The map's own button numbered a new stop after the last one; the API
   and the assistant's add_stop both defaulted it to zero — which is not "no
   opinion", it is the front of the entire trip. A castle added on the Sunday
   afternoon therefore sat ahead of everything from that Sunday morning, and
   because the number is invisible there was nothing on the screen to explain
   why. That is what was reported, in a photograph of the strip.

   The reading order is fixed above this: the hour a stop happens at now
   outranks its sequence number, carried forward across the stops that name no
   hour, so most of the damage stops showing the moment that ships. This is for
   what the clock cannot reach — the half-planned days, where several stops sit
   on zero together and nothing tells them apart.

   Ordered by the same rule the app now reads by, so the two agree from here:

     the day it is on          undated stops last, as everywhere else
     the hour it happens at    carried forward across the stops that name none
     the number it already has which is what settles the rest
     when the row was written  a last resort, so the result is deterministic

   The carry is the part that is easy to get wrong, and getting it wrong here
   rearranges somebody's day rather than repairing it. Breakfast, the museum at
   half nine, lunch: sorting the two untimed ones to the front of the day gives
   Breakfast, Lunch, Museum — a different morning from the one that was
   written down, and a different one again from what the app would then draw.
   Carried, lunch happens after the museum because that is where it was put,
   and the stored order and the drawn order say the same thing.

   That preserves every ordering anybody actually chose. Two stops already in a
   sensible order stay in it — they differ on day, or hour, or on a sequence
   somebody set with the move arrows — and the only rows that move are the ones
   that were tied on all three, which is precisely the pile of zeroes.

   Numbered from zero per trip, densely, so `max(seq) + 1` is the next one and
   the move arrows have room to swap. */

/* The hour each stop is ordered by, carried across the ones that name none.

   Postgres has no IGNORE NULLS on a window frame, so the carry is done the
   standard way: a running count of the non-null hours puts every stop into a
   group that begins at the last stop which named one, and the group's own hour
   is then the carried one. Everything before the day's first timed stop lands
   in group zero and carries nothing, which is the front of the day — where it
   was put. */
with grouped as (
  select
    id,
    trip_id,
    day,
    seq,
    created_at,
    starts_at,
    count(starts_at) over (
      partition by trip_id, day
      order by seq, created_at, id
      rows between unbounded preceding and current row
    ) as carried_group
  from stops
),
carried as (
  select
    id,
    trip_id,
    day,
    seq,
    created_at,
    max(starts_at) over (partition by trip_id, day, carried_group) as happens_at
  from grouped
),
ranked as (
  select
    id,
    row_number() over (
      partition by trip_id
      order by
        /* Undated last, matching the strip and the timeline. An empty string
           is not a date and must not sort among them either. */
        (day is null or btrim(day) = ''),
        day,
        happens_at nulls first,
        seq,
        created_at,
        id
    ) - 1 as position
  from carried
)
update stops s
set seq = ranked.position
from ranked
where ranked.id = s.id
  and s.seq is distinct from ranked.position;
