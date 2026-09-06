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
  /** the road's length, as words: "2.3 km" */
  km: string | null
  /** minutes on foot and behind the wheel — the card shows both, when known */
  walkMin: number | null
  driveMin: number | null
  /** the crow spoke: no engine knew the roads, the km is a straight line */
  direct: boolean
}

const EMPTY: RouteToStop = {
  measure: null,
  summary: null,
  pending: false,
  km: null,
  walkMin: null,
  driveMin: null,
  direct: false,
}

const kmOf = (m: number) => `${(m / 1000).toFixed(1)} km`
const minutesOf = (seconds: number) => Math.max(1, Math.round(seconds / 60))

/* "How far, and which way?" — asked the moment a stop is selected. The road
   is the answer, so the road is what appears: a quiet measuring beat while
   the engine thinks, then the shortest way. Both gaits are asked at once —
   the card shows walking AND driving minutes — while the drawn line keeps
   walking pace under 2.5 km and driving beyond. The crow's straight line is
   only ever the honest fallback (engine down, or the engineless demo), never
   a wrong answer flashed first and corrected. Everything clears when the
   question closes. */
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
  const [state, setState] = useState<RouteToStop>(EMPTY)
  const fromKey = from ? `${from[0].toFixed(4)},${from[1].toFixed(4)}` : ''
  const target: Coordinates | null = stop ? [stop.lng, stop.lat] : (point ?? null)
  const targetKey = target ? `${target[0]},${target[1]}` : ''

  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys carry the contents; a metre of GPS wobble must not refetch the road
  useEffect(() => {
    if (!from || !target) {
      setState(EMPTY)
      return
    }
    const to: Coordinates = target
    const direct = metres(from, to)
    const crow: RouteToStop = {
      ...EMPTY,
      measure: [from, to],
      summary: `${kmOf(direct)} direct`,
      km: kmOf(direct),
      direct: true,
    }
    if (sample) {
      setState(crow)
      return
    }
    setState({ ...EMPTY, pending: true })
    let alive = true
    const lineMode = direct <= 2500 ? 'pedestrian' : 'auto'
    /* The road, from whoever can answer: the server when it can, the phone's
       own engine over the trip's saved tiles when it cannot — aeroplane mode
       routes exactly like the hotel wifi did. The crow only speaks when
       neither knows the roads. */
    const oneWay = async (mode: 'pedestrian' | 'auto') => {
      const online = typeof navigator === 'undefined' || navigator.onLine !== false
      return (
        (online ? await routeToStop(tripId, from, to, mode) : null) ??
        (await localRoute(tripId, from, to, mode))
      )
    }
    const ask = async () => {
      const [walk, drive] = await Promise.all([oneWay('pedestrian'), oneWay('auto')])
      if (!alive) return
      const primary = lineMode === 'pedestrian' ? (walk ?? drive) : (drive ?? walk)
      if (!primary) {
        setState(crow)
        return
      }
      const minutes = minutesOf(primary.seconds)
      setState({
        pending: false,
        direct: false,
        measure: primary.shape.length > 1 ? primary.shape : [from, to],
        km: kmOf(primary.meters),
        walkMin: walk ? minutesOf(walk.seconds) : null,
        driveMin: drive ? minutesOf(drive.seconds) : null,
        summary: `${kmOf(primary.meters)} · ${minutes} min ${primary === walk ? 'walk' : 'drive'}`,
      })
    }
    ask()
    return () => {
      alive = false
    }
  }, [tripId, sample, targetKey, fromKey])

  return state
}
