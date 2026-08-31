import { useCallback, useEffect, useState } from 'react'
import { loadTrip } from '../backend'
import { NativeLoginHandoff, SignInScreen, useSession } from '../features/auth'
import { NoTrip, TripApp } from '../features/trip'
import type { TripLoadResult } from '../shared/model/types'

interface BootProps {
  error?: Error | null
  onRetry?: () => void
}

function Boot({ error, onRetry }: BootProps) {
  return (
    <div className="boot">
      <div className="bootIn">
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        {error ? (
          <>
            <b>That trip would not load</b>
            <p>{error.message || String(error)}</p>
            <button className="btn" onClick={onRetry}>Try again</button>
          </>
        ) : <p>Loading the trip…</p>}
      </div>
    </div>
  )
}

function AuthenticatedApp() {
  const { session, ready } = useSession()
  const [data, setData] = useState<TripLoadResult | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)
  const reload = useCallback(() => setAttempt(a => a + 1), [])

  useEffect(() => {
    if (!ready) return
    let alive = true
    setError(null)
    loadTrip(session)
      .then(d => { if (alive) setData(d) })
      .catch((caught: unknown) => { if (alive) setError(caught instanceof Error ? caught : new Error(String(caught))) })
    return () => { alive = false }
  }, [ready, session, attempt])

  if (error) return <Boot error={error} onRetry={() => setAttempt(a => a + 1)} />
  if (!data) return <Boot />
  if ('needsAuth' in data) return <SignInScreen />
  if ('noTrip' in data) return <NoTrip email={data.email} invites={data.invites} onCreated={reload} />
  // Remount cleanly if the signed-in identity changes which trip we are showing.
  return <TripApp key={data.tripId + ':' + (session?.user?.id || 'anon')}
                  data={data} onReload={reload} />
}

export default function App() {
  if (typeof window !== 'undefined' && window.location.pathname === '/auth/native') {
    return <NativeLoginHandoff />
  }
  return <AuthenticatedApp />
}



