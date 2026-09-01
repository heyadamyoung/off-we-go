import { createFileRoute } from '@tanstack/react-router'
import { RequireSession } from '../features/auth'
import { NewTripPage } from '../features/home'

export const Route = createFileRoute('/new')({
  validateSearch: (search: Record<string, unknown>): { step?: number } =>
    (search.step === undefined ? {} : { step: Math.min(3, Math.max(1, Number(search.step) || 1)) }),
  component: NewTripRoute,
})

function NewTripRoute() {
  const { step = 1 } = Route.useSearch()
  return <RequireSession><NewTripPage step={step} /></RequireSession>
}
