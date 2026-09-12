import { ALL_DAYS } from '../../../trip-search-core'
import { clockLabel, dayLabelOf } from '../../../day-label-core'
import { dayIsoOf, photoDayIso, tripDays } from '../../../trip-days-core'
import type { Stop, TripPhoto } from '../../../shared/model/types'

/* The bottom strip and the timeline show one list, not two: what happened on a
   day is its stops and the photographs taken at them, in order. Kept pure so
   the ordering and the search rules can be tested without a map. */

export interface TripItem {
  id: string
  kind: 'stop' | 'photo'
  title: string
  meta: string
  /** For showing and for searching: the label, or the stored text when
      nothing can place it. Never for comparing — that is what dayIso is. */
  day: string
  /** The day this actually falls on. The identity and the sort key. */
  dayIso: string | null
  time: string
  status: string
  /** the stop's place in the itinerary; a photograph inherits its stop's */
  seq: number
  stop?: Stop
  photo?: TripPhoto
}

const text = (value?: string | null) => (value || '').toLowerCase()

/** Whether a row belongs under the chosen chip. Two dates, compared as dates. */
export function itemOnDay(item: TripItem, day: string): boolean {
  const wanted = dayIsoOf(day)
  return !!item.dayIso && !!wanted && item.dayIso === wanted
}

/* A day is stored as a date and shown as a label. Searching goes through the
   label too — somebody looking for what they did on the Friday types 'Fri',
   not '2026-09-04'. A stored value that is not a date is not a day, so it is
   shown as no day rather than as itself: it can only be a leftover now. */
const dayFields = (iso: string | null) => ({
  day: iso ? dayLabelOf(iso) : '',
  dayIso: iso,
})

/* Nothing on this trip is ever "Untitled": a stop without a name is at least
   its kind, and a photograph without a caption is at least its time and place.
   The fallback happens here, at render time — stored data stays honest. */
export function stopItem(stop: Stop): TripItem {
  return {
    id: stop.id,
    kind: 'stop',
    title: stop.name || stop.kind || 'Stop',
    meta: [stop.time, stop.kind].filter(Boolean).join(' · ') || 'No time set',
    ...dayFields(dayIsoOf(stop.day)),
    time: stop.time || '',
    status: stop.status || 'planned',
    seq: stop.seq ?? Number.MAX_SAFE_INTEGER,
    stop,
  }
}

export function photoItem(photo: TripPhoto, stop?: Stop): TripItem {
  return {
    id: photo.id,
    kind: 'photo',
    title:
      photo.caption ||
      [clockLabel(photo.when), stop?.name].filter(Boolean).join(' · ') ||
      (photo.kind === 'video' ? 'Video' : 'Photo'),
    meta: [clockLabel(photo.when), photo.by].filter(Boolean).join(' · '),
    /* Its stop's day, or its own: a photograph filed nowhere still happened on
       a day, and taking the day only from the stop meant it could never appear
       under one. */
    ...dayFields(photoDayIso(photo, stop?.day)),
    time: photo.when || stop?.time || '',
    status: 'photo',
    seq: stop?.seq ?? Number.MAX_SAFE_INTEGER,
    photo,
    stop,
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
export function tripItems({
  stops,
  photos,
  day,
  query = '',
  withPhotos = true,
}: ItemsInput): TripItem[] {
  const needle = query.trim().toLowerCase()
  const byStop = new Map(stops.map(stop => [stop.id, stop]))
  const items: TripItem[] = stops.map(stop => stopItem(stop))
  if (withPhotos) {
    for (const photo of photos) {
      items.push(photoItem(photo, photo.stopId ? byStop.get(photo.stopId) : undefined))
    }
  }
  /* Both sides already hold a date, so compare those. Comparing the chip
     against the row's LABEL instead is how every chip came to select nothing:
     a label carries no year, so on a trip that never declared its dates it
     cannot be resolved at all, and the comparison was text against date for
     every row on the bar. Only a title is needed to start a trip, so that is
     not an edge case — it is a map full of pins under the words "Nothing
     planned for this day yet". */
  const chosen = needle || day === ALL_DAYS ? items : items.filter(item => itemOnDay(item, day))
  const matched = needle
    ? chosen.filter(
        item =>
          text(item.title).includes(needle) ||
          text(item.meta).includes(needle) ||
          text(item.stop?.note).includes(needle) ||
          text(item.day).includes(needle),
      )
    : chosen
  return matched.sort((a, b) => {
    /* By the date, never by the label. 'Fri 4 Sep' sorts before 'Thu 3 Sep' as
       text, which put Friday ahead of Thursday in the strip and the timeline.
       Anything undated goes last rather than to the top, where an empty string
       would have put it. */
    if (a.dayIso !== b.dayIso) {
      if (!a.dayIso) return 1
      if (!b.dayIso) return -1
      return a.dayIso < b.dayIso ? -1 : 1
    }
    // The itinerary's own order first: it is the one somebody chose.
    if (a.seq !== b.seq) return a.seq - b.seq
    if (a.time !== b.time) return a.time < b.time ? -1 : 1
    // A stop before the photographs taken at it, so the strip reads as a day.
    return a.kind === b.kind ? 0 : a.kind === 'stop' ? -1 : 1
  })
}

/* The days a trip has something on, oldest first, one per date however it was
   spelled — and one at the end for whatever could not be placed at all. */
export const daysOf = (stops: Stop[], photos: TripPhoto[] = []) =>
  tripDays(
    stops.map(stop => ({ day: stop.day })),
    photos.map(photo => photoDayIso(photo, undefined)),
  )

/* The line under a trip's name: who is on it, when, and how the party splits
   between the people travelling and the people following from home. A
   formatted string rather than state, which is why it lives out here — the
   hook next door holds what the screen knows, not what it shows. */
export function tripSubtitle(
  trip: { crew?: string | null; dates?: string | null },
  family: { memberRole?: string }[],
): string {
  const travelling = family.filter(person => person.memberRole !== 'viewer').length
  const following = family.length - travelling
  return [trip.crew, trip.dates, `${travelling} travelling`, `${following} following`]
    .filter(Boolean)
    .join(' · ')
}
