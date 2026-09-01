import { useCallback, useEffect, useState } from 'react'
import { loadTripBySlug, subscribeToTrip } from '../../../backend'
import { useSession } from '../../auth'
import type { TripData } from '../../../shared/model/types'

interface TripLoad {
  data: TripData | null
  needsAuth: boolean
  error: Error | null
  reload: () => void
}

/* The trip named in the path, reloaded when the server says something changed.
   The caller decides whether it is safe to adopt new data — pulling the ground
   out from under an open editor is not. */
export default function useTripData(slug: string, canAdopt: () => boolean): TripLoad {
  const { session, ready } = useSession()
  const [data, setData] = useState<TripData | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    if (!ready) return
    let alive = true
    setError(null)
    loadTripBySlug(slug, session)
      .then(result => {
        if (!alive) return
        if ('needsAuth' in result) { setNeedsAuth(true); return }
        if ('landing' in result) {
          setError(Object.assign(new Error('Trip not found'), { status: 404 }))
          return
        }
        setData(result)
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught : new Error(String(caught)))
      })
    return () => { alive = false }
  }, [ready, session, slug, attempt])

  const tripId = data?.tripId
  useEffect(() => {
    if (!tripId) return
    let timer: ReturnType<typeof setTimeout>
    const stop = subscribeToTrip(tripId, () => {
      clearTimeout(timer)
      timer = setTimeout(() => { if (canAdopt()) reload() }, 400)
    })
    return () => { clearTimeout(timer); stop() }
  }, [tripId, canAdopt, reload])

  return { data, needsAuth, error, reload }
}
