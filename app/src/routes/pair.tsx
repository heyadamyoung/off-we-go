import { createFileRoute } from '@tanstack/react-router'
import { PairPage } from '../features/people'

/* Deliberately outside RequireSession: the pairing code is the whole
   credential, and it authorises only the posting of this phone's positions. */
export const Route = createFileRoute('/pair')({ component: PairRoute })

function PairRoute() {
  return <PairPage />
}
