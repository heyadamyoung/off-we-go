import { useEffect, type ReactElement, type ReactNode } from 'react'
import { hasBackend } from '../../../backend'
import { startReplay } from '../../../shared/lib/replay'
import { identify } from '../../../shared/lib/telemetry'
import Boot from '../../../shared/ui/boot'
import { useSession } from '../model/session'
import SignInScreen from './sign-in'

/* Sample mode has no backend and therefore no session to wait for; with one
   configured, nothing renders until we know whether there is a signed-in
   person, so a screen never flashes past on its way to the sign-in form.
   `signedOut` lets a route put something friendlier than the form in front
   of a stranger — the landing page uses it. */
export default function RequireSession({
  children,
  signedOut,
}: {
  children: ReactNode
  signedOut?: ReactElement
}) {
  const { session, ready } = useSession()
  // Replay records signed-in sessions only: a stranger on the landing page
  // is traffic, not a session the owner needs to watch back.
  useEffect(() => {
    if (session) {
      identify(session.user?.id ? String(session.user.id) : undefined)
      startReplay()
    }
  }, [session])
  if (!hasBackend) return <>{children}</>
  if (!ready) return <Boot />
  if (!session) return signedOut ?? <SignInScreen />
  return <>{children}</>
}
