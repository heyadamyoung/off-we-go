import { useState } from 'react'
import { daysBetween, formatRange } from '../../../shared/lib/trip-dates'
import type { Trip } from '../../../shared/model/types'

/* The settings form's copy of the trip's own facts. The date range is picked
   on calendars, and the printed label and the day count are derived at save —
   nobody types "3 – 17 September" by hand anywhere any more. */
export default function useTripFields({
  trip,
  onSaveTrip,
}: {
  trip: Trip
  onSaveTrip: (fields: Partial<Trip>) => void
}) {
  const [fields, setFields] = useState({
    title: trip.title || '',
    crew: trip.crew || '',
    startsOn: trip.startsOn || '',
    endsOn: trip.endsOn || '',
  })
  const [dirty, setDirty] = useState(false)
  const set = (key: string, value: string) => {
    setFields(current => ({ ...current, [key]: value }))
    setDirty(true)
  }
  const save = () => {
    onSaveTrip({
      ...fields,
      dates: formatRange(fields.startsOn, fields.endsOn),
      dayCount: daysBetween(fields.startsOn, fields.endsOn) || 1,
    })
    setDirty(false)
  }
  return { fields, set, dirty, save }
}

export type TripFields = ReturnType<typeof useTripFields>
