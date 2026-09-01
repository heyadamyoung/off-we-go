import type { ReactNode } from 'react'
import { hasBackend } from '../../../backend'
import Boot from '../../../shared/ui/boot'
import { useSession } from '../model/session'
import SignInScreen from './sign-in'

/* Sample mode has no backend and therefore no session to wait for; with one
   configured, nothing renders until we know whether there is a signed-in
   person, so a screen never flashes past on its way to the sign-in form. */
export default function RequireSession({ children }: { children: ReactNode }) {
  const { session, ready } = useSession()
  if (!hasBackend) return <>{children}</>
  if (!ready) return <Boot />
  if (!session) return <SignInScreen />
  return <>{children}</>
}
