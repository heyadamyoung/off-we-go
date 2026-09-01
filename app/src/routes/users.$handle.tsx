import { createFileRoute } from '@tanstack/react-router'
import { RequireSession } from '../features/auth'
import { UserProfilePage } from '../features/people'

export const Route = createFileRoute('/users/$handle')({ component: UserRoute })

function UserRoute() {
  const { handle } = Route.useParams()
  return <RequireSession><UserProfilePage handle={handle} /></RequireSession>
}
