import { useEffect, useState } from 'react'
import { parsePairHash } from '../../../app-routes-core'
import { isNativeApp, mobileTracker } from '../../../mobile'
import { Screen } from '../../../shared/ui/brand'

/* Where the pairing QR code lands. On the phone with the app installed the
   universal link opens the app here, and sharing switches on by itself; in an
   ordinary browser the page can only explain which device to scan with. The
   route needs no session on purpose — the token in the fragment is the
   credential, and it authorises exactly one thing: posting this phone's own
   positions. */
export default function PairPage() {
  const [state, setState] = useState<
    'checking' | 'invalid' | 'web' | 'working' | 'done' | 'failed'
  >('checking')
  const [error, setError] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    const payload = parsePairHash(window.location.hash)
    if (!payload) {
      setState('invalid')
      return
    }
    setName(payload.name)
    if (!isNativeApp) {
      setState('web')
      return
    }
    setState('working')
    mobileTracker
      .configure(payload)
      .then(() => {
        setState('done')
        // The code is spent; keep it out of the address bar and history.
        try {
          history.replaceState(null, '', '/pair')
        } catch {
          /* fine */
        }
      })
      .catch(caught => {
        setState('failed')
        setError(caught?.message || 'Location sharing could not start')
      })
  }, [])

  return (
    <Screen>
      {state === 'checking' && <p className="hint">Reading the pairing code…</p>}
      {state === 'invalid' && (
        <>
          <h1 className="text-2xl font-extrabold tracking-tight">That code is not valid</h1>
          <p className="hint max-w-[380px]">
            Ask whoever runs the trip to open Trip settings → Phones and show a new code, then scan
            it again.
          </p>
        </>
      )}
      {state === 'web' && (
        <>
          <h1 className="text-2xl font-extrabold tracking-tight">Open this on the phone</h1>
          <p className="hint max-w-[380px]">
            Scan the code with the camera of the phone that will share its location — the one with
            the Off We Go app installed. A browser can show the trip, but only the app can keep
            sharing while the screen is locked.
          </p>
        </>
      )}
      {state === 'working' && <p className="hint">Switching location sharing on…</p>}
      {state === 'done' && (
        <>
          <h1 className="text-2xl font-extrabold tracking-tight">{name} is sharing</h1>
          <p className="hint max-w-[380px]">
            The map moves with this phone now. It reports only while a trip is running, and you can
            pause it any time from Trip settings → Phones.
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
            Check location permissions for Off We Go, then scan the code again.
          </p>
        </>
      )}
    </Screen>
  )
}
