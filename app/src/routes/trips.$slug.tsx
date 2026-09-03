import { createFileRoute } from '@tanstack/react-router'
import { RequireSession } from '../features/auth'
import { TripPage } from '../features/trip'
import { parseTripSearch } from '../trip-search-core'

export const Route = createFileRoute('/trips/$slug')({
  validateSearch: parseTripSearch,
  component: TripRoute,
})

function TripRoute() {
  const { slug } = Route.useParams()
  /* The sample trip is the shop window: anyone may walk in. Everything else
     waits for a session as before. */
  if (slug === 'sample') return <TripPage slug={slug} />
  return (
    <RequireSession>
      <TripPage slug={slug} />
    </RequireSession>
  )
}
