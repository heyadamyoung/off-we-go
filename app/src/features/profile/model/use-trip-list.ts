import { useEffect, useState } from 'react'
import { loadLanding } from '../../../backend'
import { useSession } from '../../auth'
import type { TripSummary } from '../../../shared/model/types'

/* Just the list, for the two places on the settings page that need to name a
   trip. Failure is silent on purpose: it costs the page two cards, not the page. */
export function useTripList() {
  const { session, ready } = useSession()
  const [trips, setTrips] = useState<TripSummary[]>([])

  useEffect(() => {
    if (!ready) return
    let alive = true
    loadLanding(session)
      .then(landing => { if (alive) setTrips(landing.trips || []) })
      .catch(() => {})
    return () => { alive = false }
  }, [ready, session])

  return { trips }
}
