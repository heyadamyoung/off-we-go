import { useMemo } from 'react'
import { ALL_DAYS } from '../../../trip-search-core'
import { dayIsoOf } from '../../../trip-days-core'
import type { Stop, TripPhoto } from '../../../shared/model/types'
import { daysOf } from './trip-items'

/* Which day the trip is showing, and which days it has.

   Its own hook because it is its own question, and because everything in it
   has to agree: the chips, the filter, the live dot and the scope toggle were
   comparing four different spellings of the same day. A day is an ISO date
   here — the identity, the sort key, and what goes in the URL — and the label
   is only ever drawn. */
export default function useTripDays({
  stops,
  photos,
  searchDay,
  liveStop,
}: {
  stops: Stop[]
  photos: TripPhoto[]
  searchDay?: string
  liveStop?: Stop | null
}) {
  /* The trip's own dates are not here. They used to be, threaded down from the
     page so a label with no year could be given one; the calendar in the stop
     editor still fences a pick to them, but it is handed them directly by the
     screen that draws it. Nothing needs a range to read a day. */
  const days = useMemo(() => daysOf(stops, photos), [stops, photos])
  /* The journey's own day, as a date, so the chip it lights up is the chip
     that holds it. It used to fall back to the stop's day as written, because
     a day nothing could place was still a chip on the bar. Nothing can hold an
     unplaceable day now, so there is no such chip to light. */
  const liveDay = useMemo(() => dayIsoOf(liveStop?.day) || undefined, [liveStop?.day])
  const day = searchDay || liveDay || ALL_DAYS

  return { days, day, liveDay }
}
