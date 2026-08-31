import { useEffect, useState } from 'react'
import {
  authClient, completeBrowserLogin, completeRegistration, hasBackend,
  sendRegistrationCode, signInWithPassword,
} from '../../backend'
import { initializeNativeServices } from '../../mobile'
import { loginHandoffFromUrl, nativeAppUrlFromUrl } from '../../mobile-auth-core'
import { safeOAuthContinuation } from '../../api-client-core'

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
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [phase, setPhase] = useState<'details' | 'code'>('details')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [verificationId, setVerificationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(() => {
    if (typeof window === 'undefined') return null
    return String(new URL(window.location.href).searchParams.get('error') || '').slice(0, 200) || null
  })

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      let authenticated = false
      if (mode === 'signin') {
        await signInWithPassword(email, password)
        authenticated = true
      } else if (phase === 'details') {
        if (password.length < 12) throw new Error('Use at least 12 characters for your password')
        if (password !== confirmPassword) throw new Error('Those passwords do not match')
        setVerificationId(await sendRegistrationCode(email))
        setPhase('code')
        setBusy(false)
      } else {
        await completeRegistration({ verificationId, code, password })
        authenticated = true
      }
      if (authenticated && typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        const continuation = safeOAuthContinuation(url.searchParams.get('continue'), url.origin)
        if (continuation) window.location.replace(continuation)
      }
    }
    catch (e2) {
      setBusy(false)
      setErr(e2.message || 'Could not complete sign-in')
    }
  }

  const switchMode = () => {
    setMode(value => value === 'signin' ? 'register' : 'signin')
    setPhase('details'); setPassword(''); setConfirmPassword('')
    setCode(''); setVerificationId(''); setErr(null)
  }

  return (
    <div className="boot">
      <div className="bootIn wide authCard">
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        <b>{mode === 'signin' ? 'Welcome back' : phase === 'details' ? 'Create your account' : 'Check your email'}</b>
        <p>{mode === 'signin'
          ? 'Sign in to plan the trip and keep everyone together.'
          : phase === 'details'
            ? 'Use the email address that was invited to your Wayfare trip.'
            : `Enter the verification code Logto sent to ${email.trim().toLowerCase()}.`}</p>
        <form className="authForm" onSubmit={submit}>
          {phase === 'details' && <>
            <label className="field">
              <span>Email</span>
              <input type="email" autoComplete="email" inputMode="email" required autoFocus
                value={email} onChange={event => setEmail(event.target.value)} />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required minLength={mode === 'register' ? 12 : undefined}
                value={password} onChange={event => setPassword(event.target.value)} />
            </label>
            {mode === 'register' && <label className="field">
              <span>Confirm password</span>
              <input type="password" autoComplete="new-password" required minLength={12}
                value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
            </label>}
          </>}
          {mode === 'register' && phase === 'code' && <label className="field">
            <span>Verification code</span>
            <input type="text" autoComplete="one-time-code" inputMode="numeric" required autoFocus
              value={code} onChange={event => setCode(event.target.value)} />
          </label>}
          {err && <p className="warn" role="alert">{err}</p>}
          <button className="btn pri" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in'
              : phase === 'details' ? 'Send verification code' : 'Create account'}
          </button>
        </form>
        {phase === 'details' && <p className="authSwitch">
          {mode === 'signin' ? 'New to Wayfare?' : 'Already have an account?'}{' '}
          <button type="button" onClick={switchMode} disabled={busy}>
            {mode === 'signin' ? 'Create account' : 'Sign in'}
          </button>
        </p>}
        {mode === 'register' && phase === 'code' && <button className="authBack" type="button"
          disabled={busy} onClick={() => { setPhase('details'); setCode(''); setErr(null) }}>
          Use a different email
        </button>}
      </div>
    </div>
  )
}

function NativeLoginHandoff() {
  const current = window.location.href
  const appUrl = nativeAppUrlFromUrl(current)
  const token = appUrl ? loginHandoffFromUrl(appUrl) : null
  const error = String(new URL(current).searchParams.get('error') || '').slice(0, 200) || null
  const webUrl = token ? `/auth/callback?token=${encodeURIComponent(token)}` : '/'

  return (
    <div className="boot">
      <div className="bootIn wide">
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        <b>{error ? 'Sign-in did not finish' : appUrl ? 'Open Wayfare' : 'That sign-in return is invalid'}</b>
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



