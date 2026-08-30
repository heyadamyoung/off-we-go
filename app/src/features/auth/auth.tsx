import { useEffect, useState } from 'react'
import { authClient, completeBrowserLogin, hasBackend, sendMagicLink } from '../../backend'
import { initializeNativeServices } from '../../mobile'

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
  const [err, setErr] = useState(null)

  const submit = async e => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true); setErr(null)
    try { await sendMagicLink(email); setSent(true) }
    catch (e2) { setErr(e2.message || 'Could not send the link') }
    finally { setBusy(false) }
  }

  return (
    <div className="boot">
      <div className="bootIn wide">
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        {sent ? (
          <>
            <b>Check your inbox</b>
            <p>We sent a link to <strong>{email}</strong>. Opening it on this device signs
               you in — and creates your account if this is your first time.</p>
            <button className="btn" onClick={() => setSent(false)}>Use a different address</button>
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

export { SignInScreen, useSession }



