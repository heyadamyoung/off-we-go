import { createFileRoute } from '@tanstack/react-router'
import { RequireSession } from '../features/auth'
import { PastTripsPage } from '../features/home'

export const Route = createFileRoute('/past')({ component: PastTripsRoute })

function PastTripsRoute() {
  return (
    <RequireSession>
      <PastTripsPage />
    </RequireSession>
  )
}
