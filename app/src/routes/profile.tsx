import { createFileRoute } from '@tanstack/react-router'
import { RequireSession } from '../features/auth'
import { ProfilePage } from '../features/profile'

export const Route = createFileRoute('/profile')({ component: ProfileRoute })

function ProfileRoute() {
  return <RequireSession><ProfilePage /></RequireSession>
}
