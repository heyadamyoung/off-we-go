/* A stop's day is a date, and now it is only ever a date.

   Migration 025 converted everything people had typed into the day box before
   there was a calendar to pick from — 'Fri 4 Sep', '4', 'Sep 4', 'tbc' — and
   026 did the same for trips that never declared their own dates. What neither
   could do is stop more arriving, and more did: the assistant's create_stop
   and update_stop tools declared `day` as an integer, so asked to put a stop on
   today's date it set the day to a number. One field's type, quietly
   reintroducing the exact shape a whole migration had just removed.

   That type is a date now, the REST routes refuse anything else, and the
   client's parser for the old spellings is gone with them — which is what
   makes this the last of it rather than the third round.

   Two steps, in this order.

   First, rescue what is rescuable. A bare number is the only shape the
   assistant could write, and it is the one 025 already knew how to read: on a
   trip covering exactly one date with that day of the month, '10' means the
   tenth. Where two months of a long trip both answer to it, nothing is
   guessed — a stop moved to the wrong day is worse than a stop with none.

   Then clear the rest. This is the part 025 deliberately did not do: it kept
   unreadable text because the app still grouped it under its own heading, so
   the text was worth more than the tidiness. That is no longer true. Nothing
   can read it, nothing can write it, and a row still holding one would draw a
   chip labelled 'tbc' beside the real days and answer to no date at all. The
   stop keeps everything else it has and simply has no day, which is an
   ordinary thing for a stop to be and something the picker can now fix in a
   tap. */

with numbered as (
  select
    s.id,
    btrim(s.day) as text,
    t.starts_on,
    t.ends_on
  from stops s
  join trips t on t.id = s.trip_id
  where s.day is not null
    and btrim(s.day) ~ '^[0-9]{1,2}$'
    and btrim(s.day)::int between 1 and 31
    and t.starts_on is not null
    and t.ends_on is not null
    -- The same honesty cap the client uses: wider than two years is a typo.
    and t.ends_on - t.starts_on between 0 and 750
),
matched as (
  select
    n.id,
    -- Every date in the trip wearing that day of the month. Exactly one, or
    -- this stop is left alone.
    array_agg(day::date order by day) as days
  from numbered n
  cross join lateral generate_series(n.starts_on::date, n.ends_on::date, interval '1 day') as day
  where extract(day from day) = n.text::int
  group by n.id
)
update stops s
set day = to_char(m.days[1], 'YYYY-MM-DD')
from matched m
where s.id = m.id
  and array_length(m.days, 1) = 1;

-- And anything that is still not a date is not a day.
update stops
set day = null
where day is not null
  and btrim(day) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
