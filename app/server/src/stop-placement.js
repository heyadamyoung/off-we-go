/* Which itinerary item a photograph belongs to, decided from where it was taken.

   A trip already knows where its stops are, and a photograph usually knows
   where it was taken — from its own EXIF, or from where the phone was at the
   time. So nobody should have to file anything: if a picture was taken near
   an itinerary item it belongs to it, and if it was near several it belongs
   to the closest.

   The arithmetic existed before this, in `photoPlacement` in the client's
   mobile-photos-core, and ran in the browser at upload time. That made the
   answer a property of whichever client happened to send the row: the native
   picker, a retry from a queued upload, anything talking to the API directly
   — each got its own answer or none. Worse, it was a one-shot. A stop added
   after the photographs, which is the normal way a trip gets written up, left
   every one of them filed under nothing for ever.

   So the rule lives here now, on the one machine every upload passes through,
   and it is re-runnable over rows that already exist. The client keeps its
   copy because it draws "this will be grouped at the Rijksmuseum" before
   anything is sent, and a preview that has to ask the server is a preview
   that flickers. Keep the two in step — this file is the authority, and
   `photoPlacement` is the guess it draws while you wait.

   Nothing here talks to a database or knows what a photograph is. It takes
   points and stops and returns an id. */

import { distanceMetres } from './home-zone.js'

/* How near is near enough. About five minutes' walk: close enough that a
   picture taken at that distance is plausibly of the thing, far enough that
   standing across the square from it still counts.

   It is one number rather than something clever per stop because the data to
   be clever with does not exist — a museum and a mountain pass are both a
   name and a point here. When that changes this is where it changes. */
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
 * The itinerary item a point belongs to: the nearest one within the radius,
 * or null when there is nothing near enough.
 *
 * Ties are broken by whichever came first, which is the itinerary's own order
 * — arbitrary, but stable, so the same photograph does not move between two
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
 * picture and said where it goes, which is better information than four
 * hundred metres of arithmetic, and re-deciding it at the next itinerary edit
 * would quietly undo them.
 *
 * Otherwise a row with a point is answered from the point, always — that is
 * what makes this the authority rather than a suggestion, and it is why two
 * clients that disagree still end up filed the same way.
 *
 * A row without one keeps whatever it already had. There is nothing to
 * compute from, and throwing away a link somebody or something else
 * established would be destroying information to look decisive.
 *
 * @param {{lng?: number, lat?: number, stopId?: string|null, stopPinned?: boolean}} photo
 * @param {Array<{id: string, lng: number, lat: number}>} stops
 */
export function stopForPhoto(photo, stops, options) {
  if (photo?.stopPinned) return photo.stopId ?? null
  const point = pointOf(photo)
  if (!point) return photo?.stopId ?? null
  return nearestStopId(point, stops, options)
}

/**
 * Whether a change to a photograph's filing leaves it pinned, and `undefined`
 * when it says nothing either way.
 *
 * Naming a stop is pinning it. Nothing automatic goes through this path —
 * uploads are filed by `stopForPhoto` and existing rows by a re-link — so a
 * stop arriving as an edit is always a person, or something acting for one,
 * saying where a picture belongs. Making that implicit is the point: a caller
 * that had to remember the flag is a caller that will one day forget, and
 * forgetting means the correction silently reverts.
 *
 * Passing the flag explicitly still wins, which is how a filing is handed
 * back to the rule: `{ stopPinned: false }`.
 *
 * @param {{stopId?: string|null, stopPinned?: boolean}} changes
 */
export function pinAfter(changes) {
  if (typeof changes?.stopPinned === 'boolean') return changes.stopPinned
  return changes?.stopId !== undefined ? true : undefined
}
