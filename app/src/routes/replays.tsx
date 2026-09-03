import { createFileRoute } from '@tanstack/react-router'
import { RequireSession } from '../features/auth'
import { ReplayPage } from '../features/replay'

export const Route = createFileRoute('/replays')({ component: ReplaysRoute })

function ReplaysRoute() {
  return (
    <RequireSession>
      <ReplayPage />
    </RequireSession>
  )
}
