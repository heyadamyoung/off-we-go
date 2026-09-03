import { createFileRoute, redirect } from '@tanstack/react-router'
import { RequireSession } from '../features/auth'
import { HomePage, LandingPage } from '../features/home'

const HUMAN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { t?: string } =>
    // Links posted before trips had their own path arrive as `/?t=slug`.
    typeof search.t === 'string' ? { t: search.t.toLowerCase() } : {},
  beforeLoad: ({ search }) => {
    if (search.t && HUMAN_SLUG.test(search.t)) {
      throw redirect({ to: '/trips/$slug', params: { slug: search.t }, replace: true })
    }
  },
  component: HomeRoute,
})

function HomeRoute() {
  /* A stranger gets the landing page, not a sign-in form saying welcome back. */
  return (
    <RequireSession signedOut={<LandingPage />}>
      <HomePage />
    </RequireSession>
  )
}
