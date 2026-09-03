import { useCallback, useEffect, useState } from 'react'
import { loadLanding, loadMyProfile } from '../../../backend'
import { useSession } from '../../auth'
import type { MyProfile, PendingInvite, TripSummary } from '../../../shared/model/types'

interface Landing {
  trips: TripSummary[]
  invites: PendingInvite[]
  profile: MyProfile | null
  email?: string
  /** When the list came from the offline cache, when it was last synced. */
  offlineAt: number | null
  loading: boolean
  error: Error | null
  reload: () => void
}

/* Everything the home screens share: the trips, the invitations waiting, and
   the profile — the globe needs a home base before it can draw anything. */
export default function useLanding(): Landing {
  const { session, ready } = useSession()
  const [trips, setTrips] = useState<TripSummary[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [email, setEmail] = useState<string | undefined>()
  const [offlineAt, setOfflineAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    if (!ready) return
    let alive = true
    setError(null)
    Promise.all([loadLanding(session), loadMyProfile().catch(() => null)])
      .then(([landing, me]) => {
        if (!alive) return
        setTrips(landing.trips || [])
        setInvites(landing.invites || [])
        setEmail(landing.email)
        setOfflineAt(landing.offlineAt ?? null)
        setProfile(me)
        setLoading(false)
      })
      .catch((caught: unknown) => {
        if (!alive) return
        setError(caught instanceof Error ? caught : new Error(String(caught)))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [ready, session, attempt])

  return { trips, invites, profile, email, offlineAt, loading, error, reload }
}
