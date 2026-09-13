import { ALL_DAYS } from '../../../trip-search-core'
import { clockLabel, dayLabelOf } from '../../../day-label-core'
import { orderingMinutes } from '../../../stop-order-core'
import { minutesOf, startMinutes, stopTimeLabel } from '../../../stop-time-core'
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
  /* The hour it happens at, as minutes past midnight, for ordering a day.
     Never the label: '9:30 – 10:00' sorts after '14:00' as a string, which is
     an afternoon read as a morning. Null when nothing has said. */
  startsMinutes: number | null
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
export function stopItem(stop: Stop, orderMinutes?: number | null): TripItem {
  return {
    id: stop.id,
    kind: 'stop',
    title: stop.name || stop.kind || 'Stop',
    meta: [stopTimeLabel(stop), stop.kind].filter(Boolean).join(' · ') || 'No time set',
    ...dayFields(dayIsoOf(stop.day)),
    time: stopTimeLabel(stop),
    startsMinutes: orderMinutes === undefined ? startMinutes(stop) : orderMinutes,
    status: stop.status || 'planned',
    seq: stop.seq ?? Number.MAX_SAFE_INTEGER,
    stop,
  }
}

export function photoItem(photo: TripPhoto, stop?: Stop, orderMinutes?: number | null): TripItem {
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
    time: photo.when || stopTimeLabel(stop),
    /* Its own moment first: a photograph taken at four belongs after one taken
       at two, whatever hour the stop they share is booked for. */
    startsMinutes:
      minutesOf(clockLabel(photo.when)) ??
      (orderMinutes === undefined ? startMinutes(stop) : orderMinutes),
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
  /* The hour each stop is ordered by, carried across the ones that name none —
     so a lunch nobody timed still sits between the museum and the castle
     rather than being swept to the end of the day. */
  const ordering = orderingMinutes(stops)
  const items: TripItem[] = stops.map(stop => stopItem(stop, ordering.get(stop.id)))
  if (withPhotos) {
    for (const photo of photos) {
      const stop = photo.stopId ? byStop.get(photo.stopId) : undefined
      items.push(photoItem(photo, stop, stop ? ordering.get(stop.id) : undefined))
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
    /* Then the hour, which is what a day actually is. This used to come after
       the sequence number, and the sequence number won — so a castle visited
       at half past three sat in front of two places from that morning, because
       it had been added to the itinerary later.

       The sequence deserved to lose. It is invisible, it is trip-wide rather
       than per-day, and two of the three ways a stop can be created defaulted
       it to zero — which is the front of the whole trip. The hour is written
       on the card somebody is looking at.

       Minutes rather than the labels: '9:30 – 10:00' sorts after '14:00' as
       text, because that is what strings do with a leading digit. */
    if (a.startsMinutes !== b.startsMinutes) {
      /* Nothing at all means nothing this day has named yet — the carry above
         only comes up empty before the day's first timed stop — so it belongs
         at the front of the day, where the itinerary put it. Stops with no day
         are already sorted away above; this is only ever within one. */
      if (a.startsMinutes === null) return -1
      if (b.startsMinutes === null) return 1
      return a.startsMinutes - b.startsMinutes
    }
    /* Then the itinerary's own order, which still settles everything the clock
       says nothing about — a half-planned day, two things booked for the same
       hour, and whatever the editor's move arrows were used on. */
    if (a.seq !== b.seq) return a.seq - b.seq
    // A stop before the photographs taken at it, so the strip reads as a day.
    return a.kind === b.kind ? 0 : a.kind === 'stop' ? -1 : 1
  })
}

/* The days a trip has something on, oldest first, one chip per date — counting
   the days that only have photographs on them. A stop with no day gets no chip
   of its own; 'All days' is where it is found. */
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
