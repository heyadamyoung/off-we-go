import { createFileRoute } from '@tanstack/react-router'
import { RequireSession } from '../features/auth'
import { InvitationsPage } from '../features/home'

export const Route = createFileRoute('/invitations')({ component: InvitationsRoute })

function InvitationsRoute() {
  return (
    <RequireSession>
      <InvitationsPage />
    </RequireSession>
  )
}
