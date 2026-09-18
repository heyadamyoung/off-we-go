import { useEffect, useMemo, useState } from 'react'
import { loadSegmentPosition } from '../../../backend'
import {
  airborneLeg,
  PLANE_EVERY_MS,
  planeOnMap,
  type AircraftHeard,
  type PlaneOnMap,
} from '../../../plane-core'
import type { Segment } from '../../../segments-core'
import type { Id } from '../../../shared/model/types'

/* The plane on the map. While a flight leg is plausibly in the air, the
   server is asked once a minute where the transponder network last heard
   it, and the answer is drawn over the family's own dots. Nothing is asked
   on any other day, and a leg the board has already landed is left alone. */

export default function usePlanePosition(
  tripId: Id,
  segments: readonly Segment[],
  now: number,
): PlaneOnMap | null {
  const leg = useMemo(() => airborneLeg(segments, now), [segments, now])
  const legId = leg?.id ?? null
  const [heard, setHeard] = useState<{ legId: string; aircraft: AircraftHeard | null } | null>(null)

  useEffect(() => {
    if (!legId) return
    let alive = true
    const ask = () =>
      loadSegmentPosition(tripId, legId)
        .then(found => {
          if (alive) setHeard({ legId, aircraft: found.aircraft })
        })
        .catch(() => {
          /* The sky is a courtesy; the ticket says what the board said. */
        })
    ask()
    const timer = setInterval(ask, PLANE_EVERY_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [tripId, legId])

  return useMemo(
    () => (leg && heard?.legId === leg.id ? planeOnMap(leg, heard.aircraft, now) : null),
    [leg, heard, now],
  )
}
