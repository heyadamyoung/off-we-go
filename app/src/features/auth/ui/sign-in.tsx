import { useEffect, useState, type FormEvent } from 'react'
import {
  completeRegistration,
  sendRegistrationCode,
  sendSignInCode,
  signInWithCode,
  signInWithPassword,
} from '../../../backend'
import { safeOAuthContinuation } from '../../../api-client-core'
import {
  authCallbackMessage,
  authErrorMessage,
  authSuccessMessage,
  type AuthAction,
} from '../../../auth-messages-core'
import { Screen } from '../../../shared/ui/brand'
import { useToast } from '../../../shared/ui/toast'

export default function SignInScreen() {
  const notify = useToast()
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  /* An invited follower should not need to invent a 12-character password to
     watch the family cross a country. Their inbox already proves who they are. */
  const [method, setMethod] = useState<'password' | 'code'>('password')
  const [phase, setPhase] = useState<'details' | 'code'>('details')
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [verificationId, setVerificationId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const callbackError = new URL(window.location.href).searchParams.get('error')
    if (callbackError) notify(authCallbackMessage(callbackError), 'error')
  }, [notify])

  const fail = (caught: unknown, action: AuthAction) => {
    setBusy(false)
    notify(authErrorMessage(caught, action), 'error')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      let authenticated = false
      if (mode === 'signin' && method === 'code' && phase === 'details') {
        try {
          setVerificationId(await sendSignInCode(email))
        } catch (error) {
          fail(error, 'send-code')
          return
        }
        setPhase('code')
        setBusy(false)
        notify(authSuccessMessage('send-code'))
      } else if (mode === 'signin' && method === 'code') {
        try {
          await signInWithCode({ email, verificationId, code })
        } catch (error) {
          fail(error, 'signin')
          return
        }
        notify(authSuccessMessage('signin'))
        authenticated = true
      } else if (mode === 'signin') {
        try {
          await signInWithPassword(email, password)
        } catch (error) {
          fail(error, 'signin')
          return
        }
        notify(authSuccessMessage('signin'))
        authenticated = true
      } else if (phase === 'details') {
        if (password.length < 12) {
          fail(Object.assign(new Error(), { code: 'password.rejected' }), 'register')
          return
        }
        if (password !== confirmPassword) {
          setBusy(false)
          notify('Those passwords do not match.', 'error')
          return
        }
        try {
          setVerificationId(await sendRegistrationCode(email, handle))
        } catch (error) {
          fail(error, 'send-code')
          return
        }
        setPhase('code')
        setBusy(false)
        notify(authSuccessMessage('send-code'))
      } else {
        try {
          await completeRegistration({ verificationId, code, password })
        } catch (error) {
          fail(error, 'register')
          return
        }
        notify(authSuccessMessage('register'))
        authenticated = true
      }
      if (authenticated && typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        const continuation = safeOAuthContinuation(url.searchParams.get('continue'), url.origin)
        if (continuation) window.location.replace(continuation)
      }
    } catch (error) {
      fail(error, mode === 'signin' ? 'signin' : 'register')
    }
  }

  const switchMode = () => {
    setMode(value => (value === 'signin' ? 'register' : 'signin'))
    setPhase('details')
    setHandle('')
    setPassword('')
    setConfirmPassword('')
    setCode('')
    setVerificationId('')
  }

  const heading =
    phase === 'code'
      ? 'Check your email'
      : mode === 'signin'
        ? 'Welcome back'
        : 'Create your account'
  const blurb =
    phase === 'code'
      ? `Enter the code we sent to ${email.trim().toLowerCase()}.`
      : mode === 'signin'
        ? 'Sign in to plan the trip and keep everyone together.'
        : 'Create an account to plan your own trip or accept a trip invitation.'

  return (
    <Screen>
      <h1 className="text-2xl font-extrabold tracking-tight">{heading}</h1>
      <p className="hint max-w-[380px]">{blurb}</p>
      <form className="mt-2 flex w-full flex-col gap-3.5 text-left" onSubmit={submit}>
        {phase === 'details' && (
          <>
            {mode === 'register' && (
              <label className="field">
                Handle
                <input
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  minLength={3}
                  maxLength={30}
                  pattern="[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*"
                  placeholder="adam-young"
                  aria-describedby="handle-help"
                  value={handle}
                  onChange={event => setHandle(event.target.value.toLowerCase())}
                />
                <small id="handle-help" className="hint">
                  Your unique @handle. Use letters, numbers, and single hyphens.
                </small>
              </label>
            )}
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                autoFocus
                value={email}
                onChange={event => setEmail(event.target.value)}
              />
            </label>
            {(mode === 'register' || method === 'password') && (
              <label className="field">
                Password
                <input
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'register' ? 12 : undefined}
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                />
              </label>
            )}
            {mode === 'register' && (
              <label className="field">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                />
              </label>
            )}
          </>
        )}
        {phase === 'code' && (
          <label className="field">
            Verification code
            <input
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              required
              autoFocus
              value={code}
              onChange={event => setCode(event.target.value)}
            />
          </label>
        )}
        <button className="btn btn-accent mt-1 justify-center py-3" type="submit" disabled={busy}>
          {busy
            ? 'Please wait…'
            : mode === 'signin'
              ? method === 'code' && phase === 'details'
                ? 'Email me a sign-in code'
                : 'Sign in'
              : phase === 'details'
                ? 'Send verification code'
                : 'Create account'}
        </button>
      </form>
      {phase === 'details' && mode === 'signin' && (
        <button
          type="button"
          className="text-[13px] font-bold text-accent"
          disabled={busy}
          onClick={() => {
            setMethod(value => (value === 'code' ? 'password' : 'code'))
            setPassword('')
          }}>
          {method === 'code'
            ? 'Use a password instead'
            : 'Email me a code instead — no password needed'}
        </button>
      )}
      {phase === 'details' && (
        <p className="hint">
          {mode === 'signin' ? 'New to Off We Go?' : 'Already have an account?'}{' '}
          <button
            type="button"
            className="font-bold text-accent"
            onClick={switchMode}
            disabled={busy}>
            {mode === 'signin' ? 'Create account' : 'Sign in'}
          </button>
        </p>
      )}
      {phase === 'code' && (
        <button
          className="text-[13px] font-bold text-accent"
          type="button"
          disabled={busy}
          onClick={() => {
            setPhase('details')
            setCode('')
            setVerificationId('')
          }}>
          Use a different email
        </button>
      )}
    </Screen>
  )
}
