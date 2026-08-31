import { useEffect, useState } from 'react'
import { authClient, completeBrowserLogin, hasBackend, signInWithOidc } from '../../backend'
import { initializeNativeServices, subscribeToNativeLogin } from '../../mobile'
import { magicTokenFromUrl, nativeAppUrlFromUrl } from '../../mobile-auth-core'

function useSession() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(!hasBackend)

  useEffect(() => {
    if (!hasBackend) return
    let alive = true
    initializeNativeServices(authClient).then(() => completeBrowserLogin()).then(() => authClient.restore()).then(() => {
      if (!alive) return
      setSession(authClient.getSession())
      setReady(true)
    }).catch(() => { if (alive) setReady(true) })
    const unsubscribe = authClient.subscribe(setSession)
    return () => { alive = false; unsubscribe() }
  }, [])

  return { session, ready }
}

function SignInScreen() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(() => {
    if (typeof window === 'undefined') return null
    return String(new URL(window.location.href).searchParams.get('error') || '').slice(0, 200) || null
  })

  useEffect(() => subscribeToNativeLogin(state => {
    if (state.status === 'exchanging') {
      setBusy(true)
      setErr(null)
    } else if (state.status === 'error') {
      setBusy(false)
      setErr(state.error)
    }
  }), [])

  const signIn = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try { await signInWithOidc() }
    catch (e2) {
      setBusy(false)
      setErr(e2.message || 'Could not start sign-in')
    }
  }

  return (
    <div className="boot">
      <div className="bootIn wide">
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        <b>{busy ? 'Signing you in…' : 'Sign in to Wayfare'}</b>
        <p>Continue to Wayfare ID to sign in with your password. Additional identity
           providers can be enabled for your family later.</p>
        <button className="btn pri" type="button" disabled={busy} onClick={signIn}>
          {busy ? 'Opening secure sign-in…' : 'Continue to sign in'}
        </button>
        {err && <p className="warn">{err}</p>}
      </div>
    </div>
  )
}

function NativeLoginHandoff() {
  const current = window.location.href
  const appUrl = nativeAppUrlFromUrl(current)
  const token = appUrl ? magicTokenFromUrl(appUrl) : null
  const error = String(new URL(current).searchParams.get('error') || '').slice(0, 200) || null
  const webUrl = token ? `/auth/callback?token=${encodeURIComponent(token)}` : '/'

  return (
    <div className="boot">
      <div className="bootIn wide">
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        <b>{error ? 'Sign-in did not finish' : appUrl ? 'Open Wayfare' : 'That sign-in link is invalid'}</b>
        <p>{error || (appUrl
          ? 'Your secure sign-in returned in this browser. Tap below to finish in the Wayfare app.'
          : 'Start a fresh secure sign-in from the Wayfare app and try again.')}</p>
        {appUrl && <a className="btn pri" href={appUrl}>Open Wayfare app</a>}
        <a className="btn" href={webUrl}>{appUrl ? 'Sign in on the website instead' : 'Go to Wayfare'}</a>
      </div>
    </div>
  )
}

export { NativeLoginHandoff, SignInScreen, useSession }



