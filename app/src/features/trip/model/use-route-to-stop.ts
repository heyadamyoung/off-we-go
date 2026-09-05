import { useEffect, useState } from 'react'
import { routeToStop } from '../../../backend'
import { metres } from '../../../shared/lib/geo'
import type { Coordinates, Id, Stop } from '../../../shared/model/types'

export interface RouteToStop {
  /** the line to draw: the engine's shape, or the straight dash to fall back on */
  measure: Coordinates[] | null
  /** "1.4 km · 17 min walk", or "2.3 km direct" when only the crow can say */
  summary: string | null
}

/* "How far, and which way?" — answered the moment a stop is selected. The
   crow answers instantly (a straight dashed line and its distance); the
   routing engine then upgrades both to the shortest road, walking pace under
   2.5 km and driving beyond. Everything clears when the question closes. */
export default function useRouteToStop({
  tripId,
  sample,
  from,
  stop,
}: {
  tripId: Id
  sample: boolean
  from: Coordinates | null
  stop: Stop | null
}): RouteToStop {
  const [state, setState] = useState<RouteToStop>({ measure: null, summary: null })
  const fromKey = from ? `${from[0].toFixed(4)},${from[1].toFixed(4)}` : ''

  // biome-ignore lint/correctness/useExhaustiveDependencies: fromKey carries `from`'s content; a metre of GPS wobble must not refetch the road
  useEffect(() => {
    if (!from || !stop) {
      setState({ measure: null, summary: null })
      return
    }
    const to: Coordinates = [stop.lng, stop.lat]
    const direct = metres(from, to)
    const crow = `${(direct / 1000).toFixed(1)} km direct`
    setState({ measure: [from, to], summary: crow })
    if (sample) return
    let alive = true
    const mode = direct <= 2500 ? 'pedestrian' : 'auto'
    routeToStop(tripId, from, to, mode).then(found => {
      if (!alive || !found) return
      setState({
        measure: found.shape.length > 1 ? found.shape : [from, to],
        summary:
          `${(found.meters / 1000).toFixed(1)} km · ` +
          `${Math.max(1, Math.round(found.seconds / 60))} min ` +
          (mode === 'pedestrian' ? 'walk' : 'drive'),
      })
    })
    return () => {
      alive = false
    }
  }, [tripId, sample, stop?.id, stop?.lng, stop?.lat, fromKey])

  return state
}
