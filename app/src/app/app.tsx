import { useCallback, useEffect, useRef, useState } from 'react'
import { hasBackend, loadTrip, loadUserProfile } from '../backend'
import { NativeLoginHandoff, SignInScreen, useSession } from '../features/auth'
import { UserProfile, UserProfileUnavailable } from '../features/people'
import { TripApp, TripLanding } from '../features/trip'
import type { Person, TripLoadResult } from '../shared/model/types'
import Toast, { type ToastNotice } from '../shared/ui/toast'
import { appErrorMessage } from '../user-messages-core'
import { parseAppRoute, tripHref } from '../app-routes-core'

interface BootProps {
  error?: unknown
  onRetry?: () => void
}

function Boot({ error, onRetry }: BootProps) {
  return (
    <div className="boot">
      <div className="bootIn">
        <span className="mk brand"><img src="/offwego-icon.png" alt="" /></span>
        {error ? (
          <>
            <b>Your trips would not load</b>
            <p>{appErrorMessage(error, 'load-trip')}</p>
            <button className="btn" onClick={onRetry}>Try again</button>
          </>
        ) : <p>Loading your trips…</p>}
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
      .then(d => {
        if (!alive) return
        if ('trip' in d && d.trip.slug) {
          const canonical = tripHref(d.trip.slug)
          if (window.location.pathname !== canonical || window.location.search) {
            window.history.replaceState({}, '', canonical)
          }
        }
        setData(d)
      })
      .catch((caught: unknown) => { if (alive) setError(caught instanceof Error ? caught : new Error(String(caught))) })
    return () => { alive = false }
  }, [ready, session, attempt])

  let content
  if (error) content = <Boot error={error} onRetry={() => setAttempt(a => a + 1)} />
  else if (!data) content = <Boot />
  else if ('needsAuth' in data) content = <SignInScreen notify={notify} />
  else if ('landing' in data) content = <TripLanding email={data.email} trips={data.trips}
                                             invites={data.invites} onChanged={reload} notify={notify} />
  // Remount cleanly if the signed-in identity changes which trip we are showing.
  else content = <TripApp key={data.tripId + ':' + (session?.user?.id || 'anon')}
                  data={data} onReload={reload}
                  onHome={() => window.location.assign('/')} />
  return <>{content}<Toast notice={notice} /></>
}

function UserProfileApp({ handle }: { handle: string }) {
  const { session, ready } = useSession()
  const [profile, setProfile] = useState<Person | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState<ToastNotice | null>(null)
  const notify = useCallback((next: ToastNotice) => setNotice(next), [])

  useEffect(() => {
    if (!ready || (hasBackend && !session)) return
    let alive = true
    setError(null)
    loadUserProfile(handle)
      .then(value => { if (alive) setProfile(value) })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught : new Error(String(caught)))
      })
    return () => { alive = false }
  }, [ready, session, handle, attempt])

  let content
  if (!ready) content = <Boot />
  else if (hasBackend && !session) content = <SignInScreen notify={notify} />
  else if (error) content = <UserProfileUnavailable error={error}
                          onRetry={() => setAttempt(value => value + 1)} />
  else if (!profile) content = <Boot />
  else content = <UserProfile profile={profile} />
  return <>{content}<Toast notice={notice} /></>
}

export default function App() {
  const route = typeof window === 'undefined'
    ? { name: 'home' as const }
    : parseAppRoute(window.location.pathname, window.location.search)
  if (route.name === 'native-auth') return <NativeLoginHandoff />
  if (route.name === 'user') return <UserProfileApp handle={route.handle} />
  return <AuthenticatedApp />
}



