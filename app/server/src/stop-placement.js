/* Which itinerary item a photograph belongs to.

   A picture taken within four hundred metres of a stop is filed at it, the
   nearest winning when several are in range. Nobody has to file anything, and
   the gallery reads as the trip: one card per place, the afternoon at the
   Rijksmuseum together, the stop's own card showing what was taken there.

   The filing is a *link*, and the whole of the trouble it once caused came
   from treating it as a position. The map used to gather a stop's photographs
   into one stack on the stop's own point, so a picture filed at the museum was
   drawn at the museum: the street outside it, the bikes, the family and the
   sky all collapsed onto one pin, and a photograph that appeared where it was
   taken had moved somewhere else after a reload.

   The coordinates were never the problem — they were never written to, only
   overruled on the way to the screen. So the drawing is what changed: a
   photograph with a point of its own is now drawn at that point whatever it is
   filed under, and the stack is for the ones with no idea where they were,
   where the stop is the only notion of place anybody has. Filing and placing
   are two different questions, and this only ever answers the first.

   A photograph a person filed by hand is left alone entirely. That is better
   information than four hundred metres of arithmetic, and a correction the
   next itinerary edit undoes is not a correction.

   Nothing here talks to a database or knows what a photograph is. It takes
   points and stops and returns an id. */

import { distanceMetres } from './home-zone.js'

/* How near is near enough. About five minutes' walk: close enough that a
   picture taken at that distance is plausibly of the thing, far enough that
   standing across the square from it still counts.

   It is one number rather than something clever per stop because the data to
   be clever with does not exist — a museum and a mountain pass are both a name
   and a point here. When that changes this is where it changes. */
export const STOP_RADIUS_METRES = 400

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
 * The itinerary item a point belongs to: the nearest one within the radius, or
 * null when there is nothing near enough.
 *
 * Ties are broken by whichever came first, which is the itinerary's own order —
 * arbitrary, but stable, so the same photograph does not move between two
 * equidistant stops depending on how the rows came back.
 *
 * @param {{lng: number, lat: number} | null} point
 * @param {Array<{id: string, lng: number, lat: number}>} stops
 * @param {{radiusMetres?: number}} [options]
 */
export function nearestStop(point, stops, { radiusMetres = STOP_RADIUS_METRES } = {}) {
  if (!point || !stops?.length) return null
  let closest = null
  let best = radiusMetres
  for (const stop of stops) {
    const here = pointOf(stop)
    if (!here) continue
    const distance = distanceMetres(here, point)
    // Strictly nearer, so an equal distance leaves the earlier stop in place.
    if (distance < best) {
      best = distance
      closest = stop
    }
  }
  return closest
}

/** The same answer as an id, which is what a row actually stores. */
export const nearestStopId = (point, stops, options) =>
  nearestStop(point, stops, options)?.id ?? null

/**
 * What a photograph's stop should be, given what is known about it.
 *
 * A pinned row keeps what it has, point or no point. Somebody looked at the
 * picture and said where it goes, and re-deciding that at the next itinerary
 * edit would quietly undo them.
 *
 * A row with a point of its own is answered from that point, always — that is
 * what makes this the authority rather than a suggestion, and it is why a
 * client that guesses at a stop while it draws a preview cannot make the guess
 * stick. Near nothing means filed at nothing, which is a real answer: the
 * gallery has a card for those and the map draws them where they were taken.
 *
 * A row without a point keeps whatever it already had. There is nothing to
 * decide from, and throwing away a link somebody or something else established
 * would be destroying information to look decisive.
 *
 * @param {{lng?: number, lat?: number, stopId?: string|null, stopPinned?: boolean}} photo
 * @param {Array<{id: string, lng: number, lat: number}>} stops
 * @param {{radiusMetres?: number}} [options]
 */
export function stopForPhoto(photo, stops, options) {
  if (photo?.stopPinned) return photo.stopId ?? null
  const point = pointOf(photo)
  if (point) return nearestStopId(point, stops, options)
  return photo?.stopId ?? null
}

/**
 * Whether a change to a photograph's filing leaves it pinned, and `undefined`
 * when it says nothing either way.
 *
 * Naming a stop is pinning it. Nothing automatic goes through this path — the
 * rule above runs over rows, not over edits — so a stop arriving as an edit is
 * always a person, or something acting for one, saying where a picture belongs.
 * Making that implicit is the point: a caller that had to remember the flag is
 * a caller that will one day forget, and forgetting means the correction
 * silently reverts at the next itinerary change.
 *
 * Passing the flag explicitly still wins, which is how a filing is handed back
 * to the rule: `{ stopPinned: false }`.
 *
 * @param {{stopId?: string|null, stopPinned?: boolean}} changes
 */
export function pinAfter(changes) {
  if (typeof changes?.stopPinned === 'boolean') return changes.stopPinned
  return changes?.stopId !== undefined ? true : undefined
}
