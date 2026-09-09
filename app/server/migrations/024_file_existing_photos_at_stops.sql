/* File the photographs that were taken before anything could file them.

   Which itinerary item a photograph belongs to is decided by the server now,
   at upload, and re-decided whenever the itinerary changes shape. Neither of
   those reaches backwards. Every photograph already in the database was filed
   by whichever client happened to send it — or, if it was taken before its
   stop existed, filed under nothing and left there for ever.

   So this is the one-time catch-up, and it is deliberately a migration rather
   than a script somebody has to remember: it runs once per database, in the
   same transaction as everything else, and there is nothing to run afterwards.

   The rule is spelled out again here, in SQL, and that is the one thing worth
   being uneasy about. It is not drift-prone in the way a second implementation
   usually is: a migration is immutable — checksummed, never edited again — so
   this is a historical record of what the rule was on the day it ran, not a
   second copy competing with the first. From the next upload onwards
   stop-placement.js is the only thing that decides. The test alongside it
   checks the two agree today, which is when it matters.

   Only rows with coordinates are touched. A photograph with no point has
   nothing to decide from, and whatever link it already carries was put there
   by somebody who knew more than this statement does. */

with distances as (
  select
    p.id as photo_id,
    s.id as stop_id,
    s.seq as stop_seq,
    s.created_at as stop_created_at,
    /* Haversine, the same 6371km sphere as distanceMetres in home-zone.js. */
    2 * 6371000 * asin(sqrt(
      power(sin(radians(s.lat - p.lat) / 2), 2)
      + cos(radians(p.lat)) * cos(radians(s.lat))
        * power(sin(radians(s.lng - p.lng) / 2), 2)
    )) as metres
  from photos p
  join stops s on s.trip_id = p.trip_id
  where p.lat is not null and p.lng is not null
    and s.lat is not null and s.lng is not null
),
nearest as (
  select distinct on (photo_id) photo_id, stop_id
  from distances
  where metres < 400
  /* Nearest wins; ties go to the earlier stop, which is how the itinerary is
     ordered when the same decision is made in JavaScript. */
  order by photo_id, metres, stop_seq, stop_created_at
)
update photos p
set stop_id = nearest.stop_id
from nearest
where p.id = nearest.photo_id
  and p.stop_id is distinct from nearest.stop_id;

/* And the other half: a photograph with coordinates that is near nothing must
   end up filed at nothing, even if a client once said otherwise. Without this
   the statement above can only ever add links, never clear a wrong one. */
update photos p
set stop_id = null
where p.stop_id is not null
  and p.lat is not null and p.lng is not null
  and not exists (
    select 1 from stops s
    where s.trip_id = p.trip_id
      and s.lat is not null and s.lng is not null
      and 2 * 6371000 * asin(sqrt(
            power(sin(radians(s.lat - p.lat) / 2), 2)
            + cos(radians(p.lat)) * cos(radians(s.lat))
              * power(sin(radians(s.lng - p.lng) / 2), 2)
          )) < 400
  );
