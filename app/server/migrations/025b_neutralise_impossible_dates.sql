/* Day text shaped like a date that is not one.

   026 reads a stop's day as a date when it matches ^\d{4}-\d{2}-\d{2}, and
   that pattern says nothing about whether the number it matched is a day
   anybody could have travelled on. '2026-13-45' matches it. So does
   '2026-02-31'. Casting either to a date raises, a raising migration takes the
   whole boot down with it, and a server that will not start is a worse
   afternoon than any day label.

   Production never had such a row — 026 ran there and the API came back up,
   which is the proof — but a restore of an older backup, or a database seeded
   from a dump, would meet it on the way through. This runs first, so by the
   time 026 casts anything, everything shaped like a date is one.

   Cleared rather than corrected. '2026-02-31' is somebody's typo and there is
   no honest way to decide whether they meant the 28th, the 1st of March, or
   the 3rd — and the day it names does not exist, so no chip can hold it. An
   empty day is a stop the timeline still draws, under "No date yet", where
   somebody can put it right.

   The reconstruction below never raises whatever it is handed: every part is
   clamped into a range make_date accepts before it gets there, and the day of
   the month is added afterwards, which is always valid arithmetic. If what
   comes back out does not match what went in, what went in was not a date. */

update stops
set day = null
where day ~ '^\d{4}-\d{2}-\d{2}'
  and to_char(
        make_date(
          least(greatest(substring(btrim(day) from 1 for 4)::int, 1), 9999),
          least(greatest(substring(btrim(day) from 6 for 2)::int, 1), 12),
          1
        ) + (least(greatest(substring(btrim(day) from 9 for 2)::int, 1), 31) - 1),
        'YYYY-MM-DD'
      ) <> substring(btrim(day) from 1 for 10);
