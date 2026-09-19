import { useEffect, useState, type FormEvent } from 'react'
import { parsePairHash } from '../../../app-routes-core'
import { claimPairCode } from '../../../backend'
import { isNativeApp, mobileTracker } from '../../../mobile'
import { isPairCode, normalizePairCode } from '../../../pair-code-core'
import { Screen } from '../../../shared/ui/brand'

/* Where a phone is paired: six characters, typed. The organiser's screen
   shows the code; this phone types it and is handed its own token, and
   sharing switches on — in the app, which keeps going while the screen is
   locked, or in this browser, which shares while the page stays open and
   says so. The route needs no session on purpose: the code is the whole
   credential, and it buys exactly one thing, posting this phone's own
   positions. An old-style link with the payload in its fragment still
   pairs, for a code somebody kept. */
type State = 'enter' | 'working' | 'done' | 'failed'

export default function PairPage() {
  const [state, setState] = useState<State>('enter')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [name, setName] = useState('')

  const pair = async (payload: {
    endpoint: string
    token: string
    deviceId: string
    name: string
  }) => {
    setName(payload.name)
    setState('working')
    try {
      await mobileTracker.configure(payload)
      setState('done')
      try {
        history.replaceState(null, '', '/pair')
      } catch {
        /* fine */
      }
    } catch (caught) {
      setState('failed')
      setError((caught as Error)?.message || 'Location sharing could not start')
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the fragment is read once, on arrival
  useEffect(() => {
    const payload = parsePairHash(window.location.hash)
    if (payload) void pair(payload)
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clean = normalizePairCode(code)
    if (!isPairCode(clean)) {
      setError('A pairing code is six letters and numbers')
      return
    }
    setError('')
    setState('working')
    try {
      await pair(await claimPairCode(clean))
    } catch (caught) {
      setState('enter')
      setError((caught as Error)?.message || 'That code did not work')
    }
  }

  return (
    <Screen>
      {state === 'enter' && (
        <>
          <h1 className="text-2xl font-extrabold tracking-tight">Pair this phone</h1>
          <p className="hint max-w-[380px]">
            Type the six-character code from Trip settings → Phones on the organiser&apos;s screen.
            This phone then shares its location with the trip
            {isNativeApp ? ', including while the screen is locked.' : ' while this page is open.'}
          </p>
          <form onSubmit={submit} className="flex w-full max-w-[320px] flex-col gap-2">
            <input
              className="paircode-input rounded-xl border border-line bg-raised px-4 py-3 text-center
                            font-mono text-2xl font-extrabold uppercase tracking-[.2em] text-ink outline-none"
              aria-label="Pairing code"
              placeholder="K7M 4PQ"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={8}
              value={code}
              onChange={event => setCode(event.target.value)}
            />
            {error && <p className="hint text-tight">{error}</p>}
            <button className="btn btn-accent justify-center" type="submit" disabled={!code.trim()}>
              Start sharing
            </button>
          </form>
        </>
      )}
      {state === 'working' && <p className="hint">Switching location sharing on…</p>}
      {state === 'done' && (
        <>
          <h1 className="text-2xl font-extrabold tracking-tight">{name} is sharing</h1>
          <p className="hint max-w-[380px]">
            {isNativeApp
              ? 'The map moves with this phone now. It reports only while a trip is running, and you can pause it any time from Trip settings → Phones.'
              : 'The map moves with this phone while this page stays open. Keep the tab open; close it and sharing stops. The Off We Go app keeps sharing while the screen is locked.'}
          </p>
          <a className="btn btn-accent" href="/">
            Open your trips
          </a>
        </>
      )}
      {state === 'failed' && (
        <>
          <h1 className="text-2xl font-extrabold tracking-tight">Nearly there</h1>
          <p className="hint max-w-[380px]">{error}</p>
          <p className="hint max-w-[380px]">
            {isNativeApp
              ? 'Check location permissions for Off We Go, then ask for a new code and try again.'
              : 'Allow location access in the browser, then ask for a new code and try again.'}
          </p>
          <button className="btn btn-ghost" onClick={() => setState('enter')}>
            Try another code
          </button>
        </>
      )}
    </Screen>
  )
}
