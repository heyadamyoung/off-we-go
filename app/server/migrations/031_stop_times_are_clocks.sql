/* Give a stop two clocks and a note, instead of a box somebody typed into.

   A stop's time has been free text for the whole of this app's life. Whatever
   was typed went into the column and came back out onto the screen untouched,
   which is why one itinerary item read `11:20-11:50` and the next one read
   `2:30 PM`: the same trip, two clocks, because two different hands filled the
   boxes in and nothing anywhere made them agree.

   It was worse than untidy. The rule that decides whether a stop is behind you
   took the last `HH:MM` it could find in that text and ignored any AM or PM
   sitting beside it, so `1:30 pm – 3:00 pm` was read as ending at three in the
   morning — past, all day, every day, and stepped over by whatever came next.
   That is a stop nobody could get the trip to advance past.

   So the same move the day went through in 025: the stored value becomes the
   fact, and the label is worked out when it is drawn. `starts_at` and `ends_at`
   are times of day. `time_note` takes the words that were sharing the box with
   them — `Check-in`, `Doors`, `Evening` — because those were never a time and
   there is nothing to parse out of them.

   Local times, not instants, and deliberately so. A stop's time is what the
   ticket says, and a ticket printed in Amsterdam says the Amsterdam time even
   when the phone reading it is still in Regina. The day beside it makes the
   moment; that pairing belongs to whatever is asking, not to the column.

   What is recognised as a time, in the text that is there now:

     a clock                 '14:00', '8.30'    -> as written
     a clock with a meridiem '2:30 PM'          -> 14:30
     an hour with one        '7pm', '9 am'      -> 19:00, 09:00
     a range, any separator  '9:30 - 12:30', '11:20-11:50',
                             '10:00 to 13:00', '9am–5pm'
     words beside any of it  'Check-in 14:00'   -> 14:00, note 'Check-in'
     words instead of it     'Evening', 'tbc'   -> no times, note kept whole

   A bare number is never a time. 'Flight AC 1234' and 'Room 3' keep their text
   and get no clocks, because a column that guessed at those would be the same
   mistake as the one that read the PM off the end of an afternoon.

   Where more than two are found the first and the last are taken, which reads
   '9:00 – 12:00, 14:00 – 17:00' as the day it plainly is. An hour that cannot
   exist is dropped rather than clamped — '25:00', '13pm' — and whatever else
   was in the string still stands.

   Nothing worth having is lost. A row whose text yields no time keeps every
   character of it in the note; a row that yields one loses only the separators
   between the numbers. Afterwards the text column is gone, because two places
   to look for a stop's time is how there came to be two ways of writing one.

   Like 024 and 025 this spells the rule out in SQL, because it has to run
   before any application code can. A migration is immutable — checksummed,
   never edited again — so this is the record of the rule on the day it ran,
   not a second copy competing with stop-time-core.ts. The test alongside it
   checks the two agree today, which is when it matters. */

alter table stops add column if not exists starts_at time;
alter table stops add column if not exists ends_at time;
alter table stops add column if not exists time_note text;

/* A clock carrying a colon or a full stop, with an optional meridiem, or a
   bare hour that carries one. Written once and used twice below — first to
   find the times, then to take them back out of the words. */
create or replace function pg_temp.stop_time_pattern() returns text
  language sql immutable as
$$ select '(\d{1,2})[:.]([0-5]\d)(?:\s*([ap])\.?m\.?)?|(\d{1,2})\s*([ap])\.?m\.?' $$;

with found as (
  select
    s.id,
    t.ordinality as n,
    coalesce(t.m[1], t.m[4]) as hour,
    coalesce(t.m[2], '00') as minute,
    coalesce(t.m[3], t.m[5]) as meridiem
  from stops s
  cross join lateral regexp_matches(lower(s.time), pg_temp.stop_time_pattern(), 'g')
    with ordinality as t(m, ordinality)
  where s.time is not null
),
clocks as (
  select
    id,
    /* Ranked after the impossible ones are dropped, not before: a string
       opening with '25:00' must not leave the hour that follows it stranded
       in second place with nothing in first. */
    row_number() over (partition by id order by n) as rank,
    count(*) over (partition by id) as howmany,
    make_time(
      case
        -- Noon and midnight are the two the twelve-hour clock gets backwards.
        when meridiem = 'p' and hour::int < 12 then hour::int + 12
        when meridiem = 'a' and hour::int = 12 then 0
        else hour::int
      end,
      minute::int,
      0
    ) as at
  from found
  where hour::int <= 23
    and (meridiem is null or hour::int <= 12)
),
paired as (
  select
    id,
    max(at) filter (where rank = 1) as starts_at,
    max(at) filter (where rank = howmany and howmany > 1) as ends_at
  from clocks
  group by id
)
update stops s
set starts_at = paired.starts_at,
    ends_at = paired.ends_at
from paired
where paired.id = s.id;

/* What is left once the numbers are taken out: the words, with the separator
   that was holding the two times apart taken out as well. The separator is
   only ever removed where it stands alone — otherwise 'Check-in' would come
   out of this as 'Checkin'. */
update stops
set time_note = nullif(
  btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(time, ''), pg_temp.stop_time_pattern(), '', 'gi'),
        '(^|\s)(?:[-–—]+|to)(\s|$)', ' ', 'gi'
      ),
      '\s+', ' ', 'g'
    ),
    ' ,;:.'
  ),
  ''
)
where time is not null;

-- Kept to the same eighty characters the door allows, so a row that came from
-- here and a row that came from the API cannot be different shapes.
update stops set time_note = left(time_note, 80) where length(time_note) > 80;

alter table stops drop column time;
