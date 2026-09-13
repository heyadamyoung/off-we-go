/* File the photographs at the itinerary item they were taken near, again.

   030 unfiled every located photograph, and that was the wrong half of the
   fix. What was actually reported was that the map drew a picture at the
   stop's pin instead of where it was taken: a stop's photographs were gathered
   into one stack on the stop's own point, so the street outside the museum,
   the bikes, the family and the sky all collapsed onto the museum. Unfiling
   them stopped that — and took the gallery's whole shape with it. One card per
   place, the afternoon at the Rijksmuseum together, a stop's card showing what
   was taken there: all of it came from the link, and none of it was the bug.

   The coordinates were never the problem. They were never written to — only
   overruled on the way to the screen — and that is what changed instead: a
   photograph with a point of its own is now drawn at that point whatever it is
   filed under, and the stack at a stop is for the pictures with no idea where
   they were, which is the only case a stop's pin is the best answer for.

   So filing and placing are two different questions, and this restores the
   answer to the first. Nearest stop within four hundred metres wins, ties to
   whichever comes first in the itinerary — the same rule stop-placement.js
   applies to every photograph that arrives from here on.

   Left alone, as always: a pinned photograph. Somebody looked at the picture
   and said where it goes, and 030 was careful not to disturb those. Re-deciding
   them now would undo a person in order to agree with some arithmetic.

   Also left alone: a photograph with no coordinates. There is nothing to
   measure, and whatever link it already carries is the only notion of place
   anybody has for it.

   Four hundred metres on a sphere, without PostGIS. The longitude degree is
   narrowed by the latitude it is measured at, which at the fifty-two degrees
   most of this trip sits at makes a degree of longitude about three-fifths of
   a degree of latitude — ignoring it would stretch the radius sideways into an
   ellipse a kilometre wide. Close enough over four hundred metres that the
   flat approximation and a great circle disagree by centimetres, which is far
   under the accuracy of the GPS chip that wrote the point.

   Strictly inside the radius, matching the rule in stop-placement.js, which
   keeps the earlier stop when two are equidistant by never taking a tie. At
   exactly four hundred metres the two arithmetics disagree by centimetres
   anyway; the point of spelling it the same way is that the intent is the
   same, so a reader comparing them finds one rule rather than two. */

with candidates as (
  select
    p.id as photo_id,
    s.id as stop_id,
    /* Equirectangular, metres. 111320 is a degree of latitude; the cosine
       narrows the longitude degree at the latitude being measured. */
    (
      power((s.lat - p.lat) * 111320.0, 2) +
      power((s.lng - p.lng) * 111320.0 * cos(radians((s.lat + p.lat) / 2)), 2)
    ) as metres_squared,
    s.seq,
    s.created_at
  from photos p
  join stops s on s.trip_id = p.trip_id
  where p.lng is not null
    and p.lat is not null
    and p.stop_pinned is not true
    and s.lng is not null
    and s.lat is not null
),
nearest as (
  select distinct on (photo_id)
    photo_id,
    stop_id,
    metres_squared
  from candidates
  -- Ties to the itinerary's own order, so a photograph equidistant from two
  -- stops does not move between them depending on how the rows came back.
  order by photo_id, metres_squared, seq, created_at
)
update photos p
set stop_id = case when nearest.metres_squared < 400.0 * 400.0 then nearest.stop_id else null end
from nearest
where nearest.photo_id = p.id
  and p.stop_id is distinct from
      (case when nearest.metres_squared < 400.0 * 400.0 then nearest.stop_id else null end);
