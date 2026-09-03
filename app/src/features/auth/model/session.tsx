import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authClient, completeBrowserLogin, hasBackend } from '../../../backend'
import { initializeNativeServices } from '../../../mobile'
import type { AuthSession } from '../../../shared/model/types'

interface SessionState {
  session: AuthSession | null
  ready: boolean
}

const SessionContext = createContext<SessionState>({ session: null, ready: !hasBackend })

export function SessionProvider({ children }: { children: ReactNode }) {
  /* The session already on this device is enough to draw the app with.
     Revalidating it is a network round trip, and waiting for that before the
     first render put the whole app — the trip, the map, everything — behind it
     on every cold load. The subscription below carries the answer when it
     arrives: restore() clears the session only if the server actually disowns
     it, and the sign-in screen then replaces whatever was drawn. */
  const stored = hasBackend ? authClient.getSession() : null
  const [session, setSession] = useState<AuthSession | null>(stored)
  const [ready, setReady] = useState(!hasBackend || !!stored)

  useEffect(() => {
    if (!hasBackend) return
    let alive = true
    initializeNativeServices(authClient)
      .then(() => completeBrowserLogin())
      .then(() => authClient.restore())
      .then(() => {
        if (!alive) return
        setSession(authClient.getSession())
        setReady(true)
      })
      .catch(() => {
        if (alive) setReady(true)
      })
    const unsubscribe = authClient.subscribe(setSession)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const value = useMemo(() => ({ session, ready }), [session, ready])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = () => useContext(SessionContext)
