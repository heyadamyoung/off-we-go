import { ALL_DAYS } from '../../../trip-search-core'
import type { Stop, TripPhoto } from '../../../shared/model/types'

/* The bottom strip and the timeline show one list, not two: what happened on a
   day is its stops and the photographs taken at them, in order. Kept pure so
   the ordering and the search rules can be tested without a map. */

export interface TripItem {
  id: string
  kind: 'stop' | 'photo'
  title: string
  meta: string
  day: string
  time: string
  status: string
  /** the stop's place in the itinerary; a photograph inherits its stop's */
  seq: number
  stop?: Stop
  photo?: TripPhoto
}

const text = (value?: string | null) => (value || '').toLowerCase()

export function stopItem(stop: Stop): TripItem {
  return {
    id: stop.id, kind: 'stop', title: stop.name || 'Untitled stop',
    meta: [stop.time, stop.kind].filter(Boolean).join(' · ') || 'No time set',
    day: stop.day || '', time: stop.time || '', status: stop.status || 'planned',
    seq: stop.seq ?? Number.MAX_SAFE_INTEGER, stop,
  }
}

export function photoItem(photo: TripPhoto, stop?: Stop): TripItem {
  return {
    id: photo.id, kind: 'photo', title: photo.caption || 'Photo',
    meta: [photo.when, photo.by].filter(Boolean).join(' · '),
    day: stop?.day || '', time: photo.when || stop?.time || '', status: 'photo',
    seq: stop?.seq ?? Number.MAX_SAFE_INTEGER, photo, stop,
  }
}

interface ItemsInput {
  stops: Stop[]
  photos: TripPhoto[]
  day: string
  query?: string
  /** photos take up a lot of a narrow strip; the timeline wants them, the map does not */
  withPhotos?: boolean
}

/* A query searches the whole trip rather than the chosen day: looking for
   somewhere you cannot remember the date of is the whole point of searching. */
export function tripItems({ stops, photos, day, query = '', withPhotos = true }: ItemsInput): TripItem[] {
  const needle = query.trim().toLowerCase()
  const byStop = new Map(stops.map(stop => [stop.id, stop]))
  const items: TripItem[] = stops.map(stopItem)
  if (withPhotos) {
    for (const photo of photos) {
      items.push(photoItem(photo, photo.stopId ? byStop.get(photo.stopId) : undefined))
    }
  }
  const onDay = needle || day === ALL_DAYS
    ? items
    : items.filter(item => item.day === day)
  const matched = needle
    ? onDay.filter(item => text(item.title).includes(needle) || text(item.meta).includes(needle)
      || text(item.stop?.note).includes(needle) || text(item.day).includes(needle))
    : onDay
  return matched.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1
    // The itinerary's own order first: it is the one somebody chose.
    if (a.seq !== b.seq) return a.seq - b.seq
    if (a.time !== b.time) return a.time < b.time ? -1 : 1
    // A stop before the photographs taken at it, so the strip reads as a day.
    return a.kind === b.kind ? 0 : a.kind === 'stop' ? -1 : 1
  })
}

export const daysOf = (stops: Stop[]) =>
  [...new Set(stops.map(stop => stop.day).filter(Boolean))] as string[]
