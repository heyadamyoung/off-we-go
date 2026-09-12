import { useMemo } from 'react'
import { ALL_DAYS } from '../../../trip-search-core'
import { dayIsoOf, type DayRange } from '../../../trip-days-core'
import type { Stop, TripPhoto } from '../../../shared/model/types'
import { daysOf } from './trip-items'

/* Which day the trip is showing, and which days it has.

   Its own hook because it is its own question, and because everything in it
   has to agree: the chips, the filter, the live dot and the scope toggle were
   comparing four different spellings of the same day. A day is an ISO date
   here — the identity, the sort key, and what goes in the URL — and the label
   is only ever drawn. */
export default function useTripDays({
  trip,
  stops,
  photos,
  searchDay,
  liveStop,
}: {
  trip: { startsOn?: string | null; endsOn?: string | null }
  stops: Stop[]
  photos: TripPhoto[]
  searchDay?: string
  liveStop?: Stop | null
}) {
  /* The trip's declared range. Nothing needs it to read a day any more — a day
     is a date — but the calendar in the stop editor is fenced to it, so a date
     outside the trip is refused rather than quietly saved. */
  const range: DayRange = useMemo(
    () => ({ startsOn: trip.startsOn, endsOn: trip.endsOn }),
    [trip.startsOn, trip.endsOn],
  )

  const days = useMemo(() => daysOf(stops, photos), [stops, photos])
  /* The journey's own day, as a date, so the chip it lights up is the chip
     that holds it. It used to fall back to the stop's day as written, because
     a day nothing could place was still a chip on the bar. Nothing can hold an
     unplaceable day now, so there is no such chip to light. */
  const liveDay = useMemo(() => dayIsoOf(liveStop?.day) || undefined, [liveStop?.day])
  const day = searchDay || liveDay || ALL_DAYS

  return { range, days, day, liveDay }
}
