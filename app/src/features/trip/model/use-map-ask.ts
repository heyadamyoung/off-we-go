import { useState } from 'react'
import type { Coordinates, Id, Stop } from '../../../shared/model/types'
import useRouteToStop from './use-route-to-stop'

/* Asking the map a question: where the long-press menu is open, which loose
   point is being measured, and the answer for whichever target currently
   holds the floor — the selected stop, or the probe when nothing is. */
export default function useMapAsk({
  tripId,
  sample,
  from,
  stop,
}: {
  tripId: Id
  sample: boolean
  from: Coordinates | null
  stop: Stop | null
}) {
  const [menuAt, setMenuAt] = useState<Coordinates | null>(null)
  const [probe, setProbe] = useState<Coordinates | null>(null)
  const route = useRouteToStop({ tripId, sample, from, stop, point: probe })
  return {
    menuAt,
    setMenuAt,
    probe,
    setProbe,
    measure: route.measure,
    summary: route.summary,
    /** the floating pill's text: only when a loose point holds the floor */
    pill: probe && !stop ? route.summary : null,
  }
}
