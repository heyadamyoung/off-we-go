import { authClient, hasBackend } from './backend'
import type { Id } from './shared/model/types'

/* Mailboxes somebody has connected. The tokens never come near here: the server
   holds them sealed, and this only ever sees which account is connected. */
export interface MailboxConnection {
  id: Id
  provider: string
  email?: string
  name?: string
  scopes?: string[]
  connectedAt?: string
  lastUsedAt?: string | null
  needsReconnect?: boolean
}

export interface ConnectorState {
  configured: boolean
  providers: Array<{ id: string; name: string; scopes: string[] }>
  connections: MailboxConnection[]
}

export async function loadConnectors(): Promise<ConnectorState> {
  if (!hasBackend) return { configured: false, providers: [], connections: [] }
  return authClient.request('/connectors')
}

/** Returns where to send them: Microsoft's sign-in, which is the only screen
    in this flow that is not ours. */
export async function startOutlookConnection(redirectTo?: string): Promise<string> {
  const result = await authClient.request<{ authorizeUrl: string }>('/connectors/outlook/start', {
    method: 'POST',
    body: { redirectTo },
  })
  return result.authorizeUrl
}

export async function disconnectMailbox(id: Id): Promise<void> {
  await authClient.request(`/connectors/${id}`, { method: 'DELETE' })
}
