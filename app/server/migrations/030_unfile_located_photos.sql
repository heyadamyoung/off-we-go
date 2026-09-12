/* Give back the photographs that were filed at an itinerary item near them.

   Migration 024 did the opposite of this, and for a while it read as the
   feature: a picture taken within four hundred metres of a stop was filed at
   it, nearest winning, so nobody had to file anything.

   What it actually did was throw away the best thing known about a
   photograph. A picture that knows where it was taken — read from its own
   EXIF block, out of the bytes, on the server — is already somewhere precise.
   The map draws a stop's photographs as one stack at the stop's own point, so
   being filed there replaced that precise somewhere with the museum's pin: the
   street outside it, the bikes, the family, the sky, all collapsed onto one
   marker. And the filing re-runs whenever the itinerary changes shape, so a
   photograph could appear where it was taken and be somewhere else after a
   reload. That is what was reported, in those words.

   So the rule is inverted from here on — stop-placement.js files a located
   photograph nowhere — and this hands back the rows 024 took. Everything else
   about them is untouched: the coordinates were never overwritten, only
   overruled, so unfiling is all it takes to put every one of these back where
   it was taken.

   Two things are deliberately left alone.

   A photograph nobody can place keeps its stop. It has no coordinates, so the
   itinerary item is the only notion of where it was that anybody has, and
   clearing it would lose that for nothing.

   A pinned photograph keeps its stop, coordinates and all. Somebody looked at
   the picture and said where it goes — that is the one thing here better than
   what the file itself knows, and undoing it is exactly what pinning exists to
   prevent. Migration 027 added the flag with a default of false and backfilled
   nothing, on the grounds that every row until then was computed rather than
   chosen. That is still true, and it is what makes this statement safe: the
   only rows carrying `stop_pinned` are ones a person has pinned since. */

update photos
set stop_id = null
where stop_id is not null
  and stop_pinned is not true
  and lng is not null
  and lat is not null;
