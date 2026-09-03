import { useEffect, useMemo, useState } from 'react'
import { loadTripLegs } from '../../../backend'
import { legsByFrom } from '../../../legs-core'
import type { Id, Stop, TripLeg } from '../../../shared/model/types'

/* Road truth arrives after the itinerary, never instead of it. Refetches when
   the stops that shape a day change — a moved pin changes the answer — and
   quietly stays empty wherever no engine is deployed. */
export default function useTripLegs({ tripId, stops }: { tripId: Id; stops: Stop[] }) {
  const [legs, setLegs] = useState<TripLeg[]>([])
  const key = stops
    .map(stop => `${stop.id}:${stop.day}:${stop.lng}:${stop.lat}:${stop.seq}`)
    .join('|')
  useEffect(() => {
    let alive = true
    loadTripLegs(tripId).then(result => {
      if (alive) setLegs(result?.legs || [])
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, key])
  return useMemo(() => legsByFrom(legs), [legs])
}
