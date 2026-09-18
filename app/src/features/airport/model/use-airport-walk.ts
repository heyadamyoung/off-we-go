import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IndoorFeature } from '../../../airport-indoor-core'
import {
  advanceWalk,
  currentStage,
  sameAirport,
  skipStage,
  WALK_START,
  walkLeg,
  walkStages,
  walkStop,
  type WalkPoint,
} from '../../../airport-walk-core'
import type { Segment } from '../../../segments-core'
import { track } from '../../../shared/lib/telemetry'
import type { Coordinates, LiveFix, Stop } from '../../../shared/model/types'

/* The walk through the terminal on the day of a flight: which leg it is
   for, which stage the traveller is at, and where the line on the map
   should go. The terminal opens by itself, once, the moment a phone is found
   at the airport in the hours before the flight; after that the camera rules
   it as it rules any terminal. The place in the walk is per leg — a new
   flight is a new walk. */
export default function useAirportWalk({
  segments,
  fix,
  now,
  stops,
  stop,
  features,
  openStop,
}: {
  segments?: Segment[]
  /** the freshest trustworthy phone fix */
  fix?: LiveFix | null
  now: number
  stops?: Stop[]
  /** the terminal that is open, if any, and what it holds */
  stop: Stop | null
  features: IndoorFeature[] | null
  openStop: (stop: Stop, focus: Coordinates) => void
}) {
  /* Content-keyed: the fix is a fresh object every recompute, and the walk
     must not re-plan for a phone that has not moved. */
  const positionKey = fix ? `${fix.lng},${fix.lat}` : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: positionKey carries the fix's content
  const position = useMemo<Coordinates | null>(
    () => (fix ? [fix.lng, fix.lat] : null),
    [positionKey],
  )
  const leg = useMemo(() => walkLeg(segments, position, now), [segments, position, now])
  const legId = leg?.id ?? null

  const [state, setState] = useState(WALK_START)
  const [walkedLeg, setWalkedLeg] = useState(legId)
  if (walkedLeg !== legId) {
    setWalkedLeg(legId)
    setState(WALK_START)
  }

  const openedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!leg || !position || stop || openedFor.current === leg.id) return
    openedFor.current = leg.id
    track('walk airport', { airport: leg.fromCode || leg.fromName })
    openStop(walkStop(leg, stops), position)
  }, [leg, position, stop, stops, openStop])

  const terminal = stop && sameAirport(stop, leg) ? features : null
  const stages = useMemo(
    () => (leg ? walkStages(leg, terminal, position, now) : []),
    [leg, terminal, position, now],
  )
  useEffect(() => {
    setState(current => advanceWalk(current, stages, position))
  }, [stages, position])

  const stage = currentStage(stages, state)
  const reached = !!stage && state.reached === stage.kind
  const target = useMemo<WalkPoint | null>(
    () => (stage?.at && !reached ? stage.at : null),
    [stage, reached],
  )
  const next = useCallback(() => setState(current => skipStage(current, stages)), [stages])
  const index = stage ? stages.indexOf(stage) : -1
  return {
    leg,
    stages,
    stage,
    reached,
    /** where the line goes: the current place, until they are standing at it */
    target,
    next,
    last: index >= 0 && index === stages.length - 1,
  }
}
