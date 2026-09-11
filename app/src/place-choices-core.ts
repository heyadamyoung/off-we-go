/* The places a photograph can be filed at, arranged for somebody choosing.

   A dropdown would have been an hour's work and it would have been useless:
   twenty stops named "Day 3", no idea which is the one in the photograph, no
   sense of how far away any of them is. What somebody actually needs to pick
   the right one is the trip they remember — in its own order, with the day
   attached, with a picture already filed there to recognise it by, and with
   how far it is from wherever these ones were taken.

   Working that out is arithmetic over lists, so it is here rather than in a
   component: what a row says can then be argued with in a test.

   Itinerary order, always. Sorting by distance would put the best guess first
   and the trip in an order nobody recognises — and the guess is exactly what
   was wrong in the case this feature exists for. */

import { metresBetween } from './segments-core'
import type { Coordinates, Stop, TripPhoto } from './shared/model/types'

export interface PlaceChoice {
  stop: Stop
  /** How many photographs are already filed here. */
  count: number
  /** One of them, to recognise the place by. */
  thumb: TripPhoto | null
  /** From the middle of what is being moved, when both ends are known. */
  metres: number | null
  /** Whether everything being moved is already here. */
  current: boolean
}

const pointOf = (row: { lng?: number | null; lat?: number | null }): Coordinates | null => {
  const { lng, lat } = row
  if (typeof lng !== 'number' || typeof lat !== 'number') return null
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null
  return [lng, lat]
}

/**
 * Where a set of photographs was taken, as one point — the mean of the ones
 * that know. Good enough to say "about 300 m from here", which is all it is
 * for, and null when not one of them has a coordinate, which is the case this
 * whole feature exists to rescue.
 */
export function middleOf(photos: readonly TripPhoto[]): Coordinates | null {
  let lng = 0
  let lat = 0
  let known = 0
  for (const photo of photos) {
    const point = pointOf(photo)
    if (!point) continue
    lng += point[0]
    lat += point[1]
    known++
  }
  return known ? [lng / known, lat / known] : null
}

/** Distances read the way somebody says them, not to the metre. */
export function roughly(metres: number | null): string {
  if (metres == null) return ''
  if (metres < 100) return 'here'
  if (metres < 950) return `${Math.round(metres / 50) * 50} m`
  if (metres < 10_000) return `${(metres / 1000).toFixed(1)} km`
  return `${Math.round(metres / 1000)} km`
}

/** Loose matching, so "rijks" finds the Rijksmuseum and case never matters. */
const matches = (stop: Stop, query: string) => {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return true
  return `${stop.name} ${stop.day ?? ''} ${stop.note ?? ''}`.toLowerCase().includes(wanted)
}

/**
 * Every itinerary item, in the trip's own order, with what a person needs to
 * recognise it.
 *
 * @param stops the itinerary, in its own order
 * @param photos every photograph on the trip, for the counts and the faces
 * @param moving the ones being filed, for the distances
 * @param query what has been typed into the search box, if anything
 */
export function placeChoices(
  stops: readonly Stop[],
  photos: readonly TripPhoto[],
  moving: readonly TripPhoto[] = [],
  query = '',
): PlaceChoice[] {
  const middle = middleOf(moving)
  const counts = new Map<string, number>()
  const faces = new Map<string, TripPhoto>()
  for (const photo of photos) {
    if (!photo.stopId) continue
    counts.set(photo.stopId, (counts.get(photo.stopId) ?? 0) + 1)
    /* A still, not a film: a video's poster is the frame it happens to start
       on, and half of them are a blur of somebody's shoe. */
    const already = faces.get(photo.stopId)
    if (!already || (already.kind === 'video' && photo.kind !== 'video'))
      faces.set(photo.stopId, photo)
  }
  const everyoneAt = (id: string) => moving.length > 0 && moving.every(p => p.stopId === id)

  return stops
    .filter(stop => matches(stop, query))
    .map(stop => {
      const here = pointOf(stop)
      return {
        stop,
        count: counts.get(stop.id) ?? 0,
        thumb: faces.get(stop.id) ?? null,
        metres: middle && here ? metresBetween(middle, here) : null,
        current: everyoneAt(stop.id),
      }
    })
}

/**
 * Whether handing this selection back to the distance rule would do anything.
 *
 * With no coordinates anywhere in it the rule has nothing to work from and
 * would leave everything exactly as it is, so offering it would be offering a
 * button that does nothing — worse than not offering it, because somebody
 * would press it and conclude the feature is broken.
 */
export const canDecideByLocation = (moving: readonly TripPhoto[]) =>
  moving.some(photo => pointOf(photo) != null)

/** Whether the whole selection is already filed by hand. */
export const allPinned = (moving: readonly TripPhoto[]) =>
  moving.length > 0 && moving.every(photo => photo.stopPinned === true)
