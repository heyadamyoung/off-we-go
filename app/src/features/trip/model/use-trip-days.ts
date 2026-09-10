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
  /* What gives a stored label its year and a bare number its month. Without it
     neither can be placed on a date at all. */
  const range: DayRange = useMemo(
    () => ({ startsOn: trip.startsOn, endsOn: trip.endsOn }),
    [trip.startsOn, trip.endsOn],
  )

  const days = useMemo(() => daysOf(stops, range, photos), [stops, range, photos])
  /* The journey's own day, as a date, so the chip it lights up is the chip
     that holds it however that stop happens to spell its day.

     As written when nothing can date it, because a day nothing can place is
     still a chip on the bar and still the day the trip is on. Taking only the
     date meant a trip whose labels fall outside its declared range had no live
     day at all, so the screen opened on the whole trip instead of on today —
     which is the wrong day, a strip of the wrong stops, and every one of those
     is a real trip whose dates moved after it was planned. */
  const liveDay = useMemo(
    () => dayIsoOf(liveStop?.day, range) || String(liveStop?.day ?? '').trim() || undefined,
    [liveStop?.day, range],
  )
  const day = searchDay || liveDay || ALL_DAYS

  return { range, days, day, liveDay }
}
