import { useEffect, useState } from 'react'
import { authClient, completeBrowserLogin, hasBackend, sendMagicLink } from '../../backend'
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
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => subscribeToNativeLogin(state => {
    if (state.status === 'exchanging') {
      setFinishing(true)
      setSent(true)
      setErr(null)
    } else if (state.status === 'error') {
      setFinishing(false)
      setSent(false)
      setErr(state.error)
    } else if (state.status === 'complete') {
      setFinishing(false)
    }
  }), [])

  const submit = async e => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true); setSent(true); setErr(null)
    try { await sendMagicLink(email) }
    catch (e2) { setSent(false); setErr(e2.message || 'Could not send the link') }
    finally { setBusy(false) }
  }

  return (
    <div className="boot">
      <div className="bootIn wide">
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        {sent ? (
          <>
            <b>{finishing ? 'Signing you in…' : 'Check your inbox'}</b>
            <p>{finishing ? 'Finishing the secure sign-in on this device.' : <>
              We sent a link to <strong>{email}</strong>. Opening it on this device signs
              you in — and creates your account if this is your first time.</>}</p>
            {!busy && !finishing && <button className="btn" onClick={() => setSent(false)}>Use a different address</button>}
          </>
        ) : (
          <>
            <b>Sign in to Wayfare</b>
            <p>Use the address the trip was shared with. No password to remember — we
               email you a link.</p>
            <form className="linkrow" onSubmit={submit}>
              <input type="email" required autoFocus value={email} placeholder="you@example.com"
                     onChange={e => setEmail(e.target.value)} />
              <button className="btn pri" type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Email me a link'}
              </button>
            </form>
            {err && <p className="warn">{err}</p>}
          </>
        )}
      </div>
    </div>
  )
}

function NativeLoginHandoff() {
  const current = window.location.href
  const appUrl = nativeAppUrlFromUrl(current)
  const token = appUrl ? magicTokenFromUrl(appUrl) : null
  const webUrl = token ? `/auth/callback?token=${encodeURIComponent(token)}` : '/'

  return (
    <div className="boot">
      <div className="bootIn wide">
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        <b>{appUrl ? 'Open Wayfare' : 'That sign-in link is invalid'}</b>
        <p>{appUrl
          ? 'Outlook opened your sign-in link in a browser. Tap below to finish signing in securely in the Wayfare app.'
          : 'Request a fresh sign-in email from the Wayfare app and try again.'}</p>
        {appUrl && <a className="btn pri" href={appUrl}>Open Wayfare app</a>}
        <a className="btn" href={webUrl}>{appUrl ? 'Sign in on the website instead' : 'Go to Wayfare'}</a>
      </div>
    </div>
  )
}

export { NativeLoginHandoff, SignInScreen, useSession }



