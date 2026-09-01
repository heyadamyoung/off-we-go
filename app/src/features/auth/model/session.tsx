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
  const [session, setSession] = useState<AuthSession | null>(null)
  const [ready, setReady] = useState(!hasBackend)

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
      .catch(() => { if (alive) setReady(true) })
    const unsubscribe = authClient.subscribe(setSession)
    return () => { alive = false; unsubscribe() }
  }, [])

  const value = useMemo(() => ({ session, ready }), [session, ready])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = () => useContext(SessionContext)
