import { useEffect, useState } from 'react'
import { routeToStop } from '../../../backend'
import { localRoute } from '../../offline-routing'
import { metres } from '../../../shared/lib/geo'
import type { Coordinates, Id, Stop } from '../../../shared/model/types'

export interface RouteToStop {
  /** the line to draw: the engine's shape, or the straight dash to fall back on */
  measure: Coordinates[] | null
  /** "1.4 km · 17 min walk", or "2.3 km direct" when only the crow can say */
  summary: string | null
  /** true while the engine is thinking — show a quiet measuring state, no line */
  pending: boolean
}

/* "How far, and which way?" — asked the moment a stop is selected. The road
   is the answer, so the road is what appears: a quiet measuring beat while
   the engine thinks, then the shortest way — walking pace under 2.5 km,
   driving beyond. The crow's straight line is only ever the honest fallback
   (engine down, or the engineless demo), never a wrong answer flashed first
   and corrected. Everything clears when the question closes. */
export default function useRouteToStop({
  tripId,
  sample,
  from,
  stop,
  point,
}: {
  tripId: Id
  sample: boolean
  from: Coordinates | null
  stop: Stop | null
  /** a loose place from the map's ask-about menu; a selected stop outranks it */
  point?: Coordinates | null
}): RouteToStop {
  const [state, setState] = useState<RouteToStop>({ measure: null, summary: null, pending: false })
  const fromKey = from ? `${from[0].toFixed(4)},${from[1].toFixed(4)}` : ''
  const target: Coordinates | null = stop ? [stop.lng, stop.lat] : (point ?? null)
  const targetKey = target ? `${target[0]},${target[1]}` : ''

  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys carry the contents; a metre of GPS wobble must not refetch the road
  useEffect(() => {
    if (!from || !target) {
      setState({ measure: null, summary: null, pending: false })
      return
    }
    const to: Coordinates = target
    const direct = metres(from, to)
    const crow = {
      measure: [from, to] as Coordinates[],
      summary: `${(direct / 1000).toFixed(1)} km direct`,
      pending: false,
    }
    if (sample) {
      setState(crow)
      return
    }
    setState({ measure: null, summary: null, pending: true })
    let alive = true
    const mode = direct <= 2500 ? 'pedestrian' : 'auto'
    /* The road, from whoever can answer: the server when it can, the phone's
       own engine over the trip's saved tiles when it cannot — aeroplane mode
       routes exactly like the hotel wifi did. The crow only speaks when
       neither knows the roads. */
    const ask = async () => {
      const online = typeof navigator === 'undefined' || navigator.onLine !== false
      const found =
        (online ? await routeToStop(tripId, from, to, mode) : null) ??
        (await localRoute(tripId, from, to, mode))
      if (!alive) return
      if (!found) {
        setState(crow)
        return
      }
      setState({
        pending: false,
        measure: found.shape.length > 1 ? found.shape : [from, to],
        summary:
          `${(found.meters / 1000).toFixed(1)} km · ` +
          `${Math.max(1, Math.round(found.seconds / 60))} min ` +
          (mode === 'pedestrian' ? 'walk' : 'drive'),
      })
    }
    ask()
    return () => {
      alive = false
    }
  }, [tripId, sample, targetKey, fromKey])

  return state
}
