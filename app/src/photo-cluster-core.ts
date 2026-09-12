/* Photographs on the map, in a number the browser can actually draw.

   Every marker is a DOM element. Photographs taken at a stop were already
   gathered into one stack per stop — bounded, because a trip has tens of
   stops — but a photograph taken anywhere else got a marker of its own. A
   walk through a city with the camera out is a thousand of those, and a
   thousand absolutely positioned elements re-projected on every frame is a
   map that stops moving.

   So the loose ones are gathered by where they are on the screen rather than
   by what they belong to: a grid whose cells are a fixed size in pixels, so
   it subdivides as you zoom in and photographs separate out exactly when
   there is room to show them apart. What is off-screen is not drawn at all —
   a marker outside the viewport costs the same as one inside it and shows
   nobody anything. */

import type { Coordinates, Id, Stop, TripPhoto } from './shared/model/types'
import { dayIsoOf, photoDayIso } from './trip-days-core'

export interface PhotoGroup {
  key: string
  lng: number
  lat: number
  items: TripPhoto[]
  /* Placed by the day it was taken rather than by where it was taken — see
     `dayAnchors` below. Drawn differently, because a picture put somewhere by
     inference must not look like one that knows where it was. */
  approximate?: boolean
  /** The day it was placed by, for what the marker says when you hold it. */
  day?: string
}

/** Web-mercator degrees per pixel at a zoom, which is what sets the cell. */
export const degreesPerPixel = (zoom: number) => 360 / (256 * 2 ** Math.max(0, zoom))

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const placed = (photo: { lng?: number | null; lat?: number | null }) =>
  finite(photo.lng) && finite(photo.lat) && Math.abs(photo.lat) <= 90 && Math.abs(photo.lng) <= 180

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

/* Grown by a cell on every side, so a stack whose anchor is just outside the
   window still exists while it is half visible, and panning does not make
   markers pop in at the edge. */
export const within = (bounds: Bounds | null, lng: number, lat: number, margin = 0) => {
  if (!bounds) return true
  if (lat < bounds.south - margin || lat > bounds.north + margin) return false
  // A window straddling the date line has its west greater than its east.
  return bounds.west <= bounds.east
    ? lng >= bounds.west - margin && lng <= bounds.east + margin
    : lng >= bounds.west - margin || lng <= bounds.east + margin
}

interface ClusterOptions {
  zoom: number
  bounds?: Bounds | null
  /* How close two photographs have to be on screen before they become one
     stack. Sixty is a little over the width of the stack itself, so markers
     stop overlapping rather than merely stop colliding. */
  radiusPx?: number
}

/**
 * Where the trip was on each of its days, as one point per day: the middle of
 * that day's stops.
 *
 * This exists because of the photographs that know nothing. A picture sent
 * over WhatsApp, scanned, or taken with location off has no coordinates; if
 * nobody has filed it at a stop it has no place either, and the map simply
 * dropped it — for ever, silently, however many of them there were. On a trip
 * where most pictures arrive that way, "photos on the map" is a feature that
 * appears not to exist.
 *
 * It does know when it was taken, though, and the itinerary knows where the
 * trip was that day. That is not where the photograph was taken and must
 * never be drawn as though it were — but it is a great deal better than
 * nowhere, and it is the place from which somebody can file it properly.
 */
export function dayAnchors(stops: Stop[]): Map<string, Coordinates> {
  const sums = new Map<string, { lng: number; lat: number; count: number }>()
  for (const stop of stops) {
    const day = dayIsoOf(stop.day)
    if (!day || !placed(stop)) continue
    const held = sums.get(day)
    if (held) {
      held.lng += stop.lng
      held.lat += stop.lat
      held.count += 1
    } else sums.set(day, { lng: stop.lng, lat: stop.lat, count: 1 })
  }
  const anchors = new Map<string, Coordinates>()
  for (const [day, sum] of sums) anchors.set(day, [sum.lng / sum.count, sum.lat / sum.count])
  return anchors
}

/**
 * One marker per stop that has photographs, plus one per screen-sized cell of
 * everything else. Ordered so the result is stable across renders.
 */
export function clusterPhotos(
  photos: TripPhoto[],
  stops: Stop[],
  { zoom, bounds = null, radiusPx = 60 }: ClusterOptions,
): PhotoGroup[] {
  const byStop = new Map<Id, TripPhoto[]>()
  const loose: TripPhoto[] = []
  /* Nothing to place them by except when they were taken. */
  const byDay = new Map<string, TripPhoto[]>()
  const anchors = dayAnchors(stops)
  for (const photo of photos) {
    if (photo.stopId) {
      const held = byStop.get(photo.stopId)
      if (held) held.push(photo)
      else byStop.set(photo.stopId, [photo])
    } else if (placed(photo)) loose.push(photo)
    else {
      const day = photoDayIso(photo, null)
      if (!day || !anchors.has(day)) continue
      const held = byDay.get(day)
      if (held) held.push(photo)
      else byDay.set(day, [photo])
    }
  }

  const out: PhotoGroup[] = []
  const stopById = new Map(stops.map(stop => [stop.id, stop]))
  for (const [stopId, items] of byStop) {
    const anchor = stopById.get(stopId) || items.find(placed)
    if (!anchor || !placed(anchor)) continue
    items.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
    if (
      !within(bounds, anchor.lng as number, anchor.lat as number, degreesPerPixel(zoom) * radiusPx)
    )
      continue
    out.push({
      key: `g${stopId}`,
      lng: anchor.lng as number,
      lat: anchor.lat as number,
      items,
    })
  }

  /* The cell is a fixed number of pixels, so it halves with every zoom level
     and photographs come apart precisely when the screen has room for them. */
  const cell = degreesPerPixel(zoom) * radiusPx
  const margin = cell
  const cells = new Map<string, TripPhoto[]>()
  for (const photo of loose) {
    const lng = photo.lng as number
    const lat = photo.lat as number
    if (!within(bounds, lng, lat, margin)) continue
    const key = `${Math.round(lng / cell)}:${Math.round(lat / cell)}`
    const held = cells.get(key)
    /* Every photograph in the cell is kept, however many there are. What
       costs is the marker, not what is behind it: a stack draws three
       thumbnails and a number whether it holds four or four hundred, and
       dropping the rest would make that number a lie and put the
       photographs somewhere nobody could reach them. */
    if (held) held.push(photo)
    else cells.set(key, [photo])
  }

  for (const [key, items] of cells) {
    items.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
    /* Anchored on the newest rather than the cell's centre: a stack that
       jumps to a grid intersection reads as being somewhere nobody stood. */
    out.push({ key: `c${key}`, lng: items[0].lng as number, lat: items[0].lat as number, items })
  }

  /* One stack per day, last, so a day's worth of unplaced pictures draws over
     the stops it was inferred from rather than under them — it is the thing
     with something to say. */
  for (const [day, items] of byDay) {
    const anchor = anchors.get(day) as Coordinates
    if (!within(bounds, anchor[0], anchor[1], margin)) continue
    items.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
    out.push({
      key: `d${day}`,
      lng: anchor[0],
      lat: anchor[1],
      items,
      approximate: true,
      day,
    })
  }
  return out
}

/** Where a group sits, for callers that only want the point. */
export const groupPoint = (group: PhotoGroup): Coordinates => [group.lng, group.lat]
