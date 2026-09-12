/* Which itinerary item a photograph belongs to.

   The answer used to be worked out from distance: a picture taken within four
   hundred metres of a stop was filed at it, the nearest winning when several
   were in range. Nobody had to file anything, which sounded like the feature.

   It was the bug. A photograph that knows where it was taken is already
   somewhere, and that somewhere is the most precise thing anybody has about
   it — read from the file's own EXIF block, on the server, out of the bytes.
   Filing it at a stop threw that away everywhere the trip is drawn: the map
   gathers a stop's photographs into one stack at the stop's own point, so the
   street outside the museum, the bikes, the family, the sky all collapsed onto
   the museum's pin. And because the filing re-runs whenever the itinerary
   changes, a picture could appear where it was taken and be somewhere else
   after a reload.

   So: a photograph that knows where it was taken is filed nowhere. The link is
   for the photographs that have no idea — scanned, sent over WhatsApp, taken
   with location off — where a stop is the only notion of place anyone has, and
   for the ones a person has filed by hand, which is a better answer than any
   arithmetic and must survive every pass over the rows.

   Nothing here talks to a database or knows what a photograph is. It takes a
   row and returns an id. */

const usable = value => typeof value === 'number' && Number.isFinite(value)

/** A point, or null if this row has not got one. */
export function pointOf(row) {
  if (!row) return null
  const { lng, lat } = row
  if (!usable(lng) || !usable(lat)) return null
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null
  return { lng, lat }
}

/**
 * What a photograph's stop should be, given what is known about it.
 *
 * A pinned row keeps what it has, point or no point. Somebody looked at the
 * picture and said where it goes, and re-deciding that at the next itinerary
 * edit would quietly undo them.
 *
 * A row that knows where it was taken is filed nowhere, always — that is what
 * makes this the authority rather than a suggestion, and it is why a client
 * that guesses at a stop while it draws a preview cannot make the guess stick.
 *
 * A row without a point keeps whatever it already had. There is nothing to
 * decide from, and throwing away a link somebody or something else established
 * would be destroying information to look decisive.
 *
 * @param {{lng?: number, lat?: number, stopId?: string|null, stopPinned?: boolean}} photo
 */
export function stopForPhoto(photo) {
  if (photo?.stopPinned) return photo.stopId ?? null
  if (pointOf(photo)) return null
  return photo?.stopId ?? null
}

/**
 * Whether a change to a photograph's filing leaves it pinned, and `undefined`
 * when it says nothing either way.
 *
 * Naming a stop is pinning it. Nothing automatic goes through this path — and
 * nothing automatic files a photograph at all now — so a stop arriving as an
 * edit is always a person, or something acting for one, saying where a picture
 * belongs. Making that implicit is the point: a caller that had to remember
 * the flag is a caller that will one day forget, and forgetting means the
 * correction silently reverts.
 *
 * Passing the flag explicitly still wins, which is how a filing is handed back
 * to the rule: `{ stopPinned: false }`. For a located photograph that now
 * means unfiling it, the rule having nothing to say about one.
 *
 * @param {{stopId?: string|null, stopPinned?: boolean}} changes
 */
export function pinAfter(changes) {
  if (typeof changes?.stopPinned === 'boolean') return changes.stopPinned
  return changes?.stopId !== undefined ? true : undefined
}
