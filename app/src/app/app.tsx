import { useCallback, useEffect, useRef, useState } from 'react'
import { loadTrip } from '../backend'
import { NativeLoginHandoff, SignInScreen, useSession } from '../features/auth'
import { NoTrip, TripApp } from '../features/trip'
import type { TripLoadResult } from '../shared/model/types'
import Toast, { type ToastNotice } from '../shared/ui/toast'
import { appErrorMessage } from '../user-messages-core'

interface BootProps {
  error?: unknown
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
            <p>{appErrorMessage(error, 'load-trip')}</p>
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
  const [notice, setNotice] = useState<ToastNotice | null>(null)
  const toastTimer = useRef(0)
  const notify = useCallback((next: ToastNotice) => {
    setNotice(next)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setNotice(null), next.tone === 'error' ? 5200 : 3200)
  }, [])
  const reload = useCallback(() => setAttempt(a => a + 1), [])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  useEffect(() => {
    if (!ready) return
    let alive = true
    setError(null)
    loadTrip(session)
      .then(d => { if (alive) setData(d) })
      .catch((caught: unknown) => { if (alive) setError(caught instanceof Error ? caught : new Error(String(caught))) })
    return () => { alive = false }
  }, [ready, session, attempt])

  let content
  if (error) content = <Boot error={error} onRetry={() => setAttempt(a => a + 1)} />
  else if (!data) content = <Boot />
  else if ('needsAuth' in data) content = <SignInScreen notify={notify} />
  else if ('noTrip' in data) content = <NoTrip email={data.email} invites={data.invites}
                                            onCreated={reload} notify={notify} />
  // Remount cleanly if the signed-in identity changes which trip we are showing.
  else content = <TripApp key={data.tripId + ':' + (session?.user?.id || 'anon')}
                  data={data} onReload={reload} />
  return <>{content}<Toast notice={notice} /></>
}

export default function App() {
  if (typeof window !== 'undefined' && window.location.pathname === '/auth/native') {
    return <NativeLoginHandoff />
  }
  return <AuthenticatedApp />
}



