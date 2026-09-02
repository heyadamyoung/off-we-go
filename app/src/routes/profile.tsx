import { createFileRoute } from '@tanstack/react-router'
import { parseProfileSearch } from '../profile-tabs-core'
import { RequireSession } from '../features/auth'
import { ProfilePage } from '../features/profile'

export const Route = createFileRoute('/profile')({
  // The tab is in the address, so a section can be linked to and Back works.
  validateSearch: parseProfileSearch,
  component: ProfileRoute,
})

function ProfileRoute() {
  return <RequireSession><ProfilePage /></RequireSession>
}
