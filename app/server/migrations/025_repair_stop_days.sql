/* Repair the days that were typed before there was anywhere to pick one.

   A stop's day is stored as text, and for most of this app's life that text
   was whatever somebody typed into a box: 'Fri 4 Sep', '4', 'Sep 4', 'tbc'.
   Then a date picker arrived and started writing proper labels, and the two
   kinds of text have been sitting side by side ever since. That is why the
   day bar came out reading "THU 3 SEP | 4 | 8 | 5 | FRI 4 SEP" — five chips
   for three days, because '4' and 'Fri 4 Sep' were being told apart as
   strings rather than recognised as one date.

   Worse, some rows hold 'all' or 'all-days'. Those are the filter's sentinel
   for "every day", which two different modules spelled two different ways;
   while they disagreed, a stop added with no day chosen was saved with the
   sentinel itself as its day. It was never a day and there is nothing to
   derive from it.

   So: resolve every stop's day against its own trip's dates, and store the
   ISO date it turns out to mean. Afterwards the stored value IS the date —
   the identity, the sort key and what the picker shows — and the label is
   worked out when it is drawn.

   What is derivable, in the order it is tried:

     already a date          '2026-09-04'  -> itself
     the label the app writes 'Fri 4 Sep'  -> the date in range that wears it
     a label with the wrong weekday 'Tue 4 Sep' -> matched on the day and
                                    month alone, because a stale weekday is a
                                    typo about a date, not a different date
     written out             'Sep 4', '4 September'
     a bare number           '4'           -> the fourth, of the one month the
                                             trip has a fourth in
     the filter's sentinel   'all'         -> nothing; it was never a day

   Only ever when the trip's range makes the answer unambiguous. A number that
   two months of a long trip both answer to is left exactly as it is: a stop
   moved to the wrong day is worse than a stop still showing odd text, and the
   text is still there to be read and fixed by hand.

   Rows whose text nothing can place keep it. 'tbc' is a day somebody meant,
   and the app groups it under its own heading rather than losing it.

   Like 024 this spells the rule out in SQL because it has to run before any
   application code can. A migration is immutable — checksummed, never edited
   again — so this is the record of what the rule was on the day it ran, not a
   second copy competing with trip-days-core.ts. The test alongside it checks
   the two agree today, which is when it matters. */

-- The sentinel is not a day. Nothing to derive, and leaving it would draw a
-- chip labelled "all" next to the real ones.
update stops set day = null where day in ('all', 'all-days');

with ranged as (
  select
    s.id,
    btrim(s.day) as text,
    t.starts_on,
    t.ends_on
  from stops s
  join trips t on t.id = s.trip_id
  where s.day is not null
    and btrim(s.day) <> ''
    -- Already an ISO date: nothing to do, and no range needed to know it.
    and btrim(s.day) !~ '^\d{4}-\d{2}-\d{2}'
    and t.starts_on is not null
    and t.ends_on is not null
    -- Two years of trip is the honesty cap the client uses; a wider range is
    -- a typo, and generating a series across it helps nobody.
    and t.ends_on - t.starts_on between 0 and 750
),
candidates as (
  select
    r.id,
    r.text,
    /* The weekday is decoration on a date, and by the time anybody looks it is
       often decoration that has gone stale — an itinerary imported from
       another year, or a trip whose dates moved after it was planned. So it is
       taken off before matching: 'Tue 4 Sep' on a trip whose fourth is a
       Friday is a typo about a date, not a different date. What is left, and
       what the day is compared against, is the day and the month. */
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
  select
    c.id,
    c.day
  from candidates c
  where
    -- '4 Sep' and '04 Sep', 'Sep 4', and the same spelled out in full.
    c.bare = lower(to_char(c.day, 'FMDD Mon'))
    or c.bare = lower(to_char(c.day, 'DD Mon'))
    or c.bare = lower(to_char(c.day, 'Mon FMDD'))
    or c.bare = lower(to_char(c.day, 'FMDD FMMonth'))
    or c.bare = lower(to_char(c.day, 'FMMonth FMDD'))
    -- A bare number, read as the day of the month: that is what the number in
    -- a label means, so it is the reading that makes '4' and 'Fri 4 Sep' the
    -- one day they plainly are.
    or (c.bare ~ '^\d{1,2}$' and c.bare::int = extract(day from c.day)::int)
),
decided as (
  select id, min(day) as day
  from matches
  group by id
  -- One answer or none. A trip spanning two months has two fourths, and
  -- guessing between them moves a stop to a day nobody put it on.
  having count(distinct day) = 1
)
update stops s
set day = to_char(d.day, 'YYYY-MM-DD')
from decided d
where s.id = d.id;

-- And the rows that already held a date: trim them to the date itself, so
-- every stored day is the same shape from here on.
update stops
set day = substring(btrim(day) from 1 for 10)
where day ~ '^\d{4}-\d{2}-\d{2}' and btrim(day) <> substring(btrim(day) from 1 for 10);
