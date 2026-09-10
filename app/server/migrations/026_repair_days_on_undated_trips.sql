/* The same repair, for trips that never said when they were.

   025 resolves a stop's day against its trip's dates, because a label carries
   no year and a bare number carries nothing at all — without a range there is
   no date to derive. But only a title is required to start a trip, so plenty
   of them have no dates on them, and a trip whose dates were never filled in
   is exactly the sort with hand-typed days all over it. 025 left every one of
   those exactly as it found it.

   There is a year to be had, though, and it is already in the database. The
   photographs know when they were taken, and any stop somebody picked with the
   date picker holds a real date. Either is enough to say which September
   'Fri 4 Sep' means.

   So the range is inferred from what is certain, widened by a week each way —
   the first photograph of a trip is rarely its first morning, and a label is
   only findable if its date falls inside the range. This is the same guess
   trip-days-core.ts makes when it draws such a trip, deliberately: the client
   has been placing these days at read time all along, and this is that same
   answer written down so everything else can rely on it.

   Where a trip has one end of its range and not the other, the end it has
   wins and the missing one is inferred, which is again what the client does.

   Nothing is written back to the trip. A range inferred from photographs is
   good enough to read a label by and not good enough to fence a date picker
   with, and a trip's own dates are the traveller's to state. */

with certain as (
  -- Dates this trip is sure of: what a camera recorded, and what somebody
  -- picked. Both are real dates rather than something to be read.
  select p.trip_id, (p.taken_at at time zone 'UTC')::date as day
  from photos p
  where p.taken_at is not null
  union all
  select s.trip_id, substring(btrim(s.day) from 1 for 10)::date
  from stops s
  where s.day ~ '^\d{4}-\d{2}-\d{2}$'
),
inferred as (
  select
    t.id as trip_id,
    coalesce(t.starts_on, min(c.day) - 7) as starts_on,
    coalesce(t.ends_on, max(c.day) + 7) as ends_on
  from trips t
  join certain c on c.trip_id = t.id
  where t.starts_on is null or t.ends_on is null
  group by t.id, t.starts_on, t.ends_on
),
ranged as (
  select s.id, btrim(s.day) as text, i.starts_on, i.ends_on
  from stops s
  join inferred i on i.trip_id = s.trip_id
  where s.day is not null
    and btrim(s.day) <> ''
    and btrim(s.day) !~ '^\d{4}-\d{2}-\d{2}'
    and i.ends_on - i.starts_on between 0 and 750
),
candidates as (
  select
    r.id,
    -- A stale weekday is a typo about a date, not a different date. See 025.
    regexp_replace(
      lower(btrim(r.text)),
      '^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?[[:space:]]+',
      ''
    ) as bare,
    d::date as day
  from ranged r
  cross join lateral generate_series(r.starts_on, r.ends_on, interval '1 day') as d
),
matches as (
  select c.id, c.day
  from candidates c
  where
    c.bare = lower(to_char(c.day, 'FMDD Mon'))
    or c.bare = lower(to_char(c.day, 'DD Mon'))
    or c.bare = lower(to_char(c.day, 'Mon FMDD'))
    or c.bare = lower(to_char(c.day, 'FMDD FMMonth'))
    or c.bare = lower(to_char(c.day, 'FMMonth FMDD'))
    or (c.bare ~ '^\d{1,2}$' and c.bare::int = extract(day from c.day)::int)
),
decided as (
  select id, min(day) as day
  from matches
  group by id
  -- One answer or none. An inferred range is a fortnight wider than the trip,
  -- so it is likelier than a declared one to hold the same number twice, and
  -- that is exactly when guessing must not happen.
  having count(distinct day) = 1
)
update stops s
set day = to_char(d.day, 'YYYY-MM-DD')
from decided d
where s.id = d.id;
