import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  autoIndoorMove,
  defaultLevel,
  levelsOf,
  onLevel,
  type IndoorFeature,
} from '../../../airport-indoor-core'
import {
  describeIndoorRoute,
  planGateRoute,
  routeSlices,
  stepMetres,
  walkGraph,
} from '../../../airport-route-core'
import { sameAirport, walkStop } from '../../../airport-walk-core'
import type { Segment } from '../../../segments-core'
import { track } from '../../../shared/lib/telemetry'
import { indoorForStop } from '../api/indoor'
import useAirportWalk from './use-airport-walk'
import type { IndoorGate } from '../../map'
import type { Coordinates, LiveFix, Stop, Toast } from '../../../shared/model/types'

/* Terminal-map mode: which airport is open, which floor is showing, where
   the line on the map goes, and the slice of features the map should draw
   right now. The camera decides whether a terminal is open — zoomed into an
   airport, its inside is there; zoomed away, it folds — and nothing else
   closes it: a floor plan is not a dialog. On the day of a flight the walk
   through the terminal opens it too, and moves the line from the desks to
   security to the gate as the traveller does. */
export default function useAirportIndoor({
  toast,
  onOpen,
  start,
  view,
  stops,
  segments,
  fix,
  now,
}: {
  toast: Toast
  /** the page's chance to move the camera: into the terminal, or onto the traveller in it */
  onOpen?: (stop: Stop, focus?: Coordinates) => void
  /** the freshest live GPS fix, if any — where a walk begins */
  start?: Coordinates | null
  /** where the camera is, so zooming into an airport opens its inside */
  view?: { center: Coordinates; zoom: number } | null
  stops?: Stop[]
  /** the trip's legs, for the walk on the day of a flight */
  segments?: Segment[]
  /** the freshest trustworthy fix, for the walk's place in the terminal */
  fix?: LiveFix | null
  /** the page's clock; without one there is no walk */
  now?: number
}) {
  const [stop, setStop] = useState<Stop | null>(null)
  const [features, setFeatures] = useState<IndoorFeature[] | null>(null)
  const [level, setLevel] = useState(0)
  const [loading, setLoading] = useState(false)
  const [target, setTarget] = useState<IndoorGate | null>(null)
  const toastRef = useRef(toast)
  toastRef.current = toast
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  /* Airports the camera should stop asking for: an unmapped one for good, a
     failed load for a minute — or a terminal that will not load is asked for
     again the moment it closes, and toasts every time. */
  const skipRef = useRef(new Map<string, number>())
  // Whether the line is one somebody tapped for, as against the walk's own.
  const tappedRef = useRef(false)

  const open = useCallback((next: Stop, focus?: Coordinates) => {
    onOpenRef.current?.(next, focus)
    setStop(next)
  }, [])

  const walk = useAirportWalk({
    segments,
    fix,
    now: now ?? 0,
    stops,
    stop,
    features,
    openStop: open,
  })

  /* The camera is the way in and the way out: zoom into an airport and its
     inside appears, loading while you are still approaching; zoom away and
     it folds — unless a line is up, which somebody is following, or the walk
     is on, which wants its floor plan whatever the camera does. The walk's
     airport counts as a stop, so a flight from one the itinerary never named
     opens too. */
  const candidates = useMemo(
    () => (walk.leg ? [...(stops || []), walkStop(walk.leg, stops)] : stops || []),
    [stops, walk.leg],
  )
  useEffect(() => {
    const clock = Date.now()
    const move = autoIndoorMove({
      view: view || null,
      stops: candidates.filter(s => (skipRef.current.get(s.id) ?? 0) < clock),
      active: stop,
      routing: !!target,
      keep: !!walk.stage && sameAirport(stop, walk.leg),
    })
    if (!move) return
    if ('open' in move) setStop(move.open)
    else {
      setStop(null)
      setFeatures(null)
    }
  }, [view, candidates, stop, target, walk.stage, walk.leg])

  /* The request outlives this effect on purpose: a remount mid-load rides the
     same shared flight, so only the state updates are guarded, not the fetch. */
  useEffect(() => {
    if (!stop) return
    let gone = false
    setLoading(true)
    setFeatures(null)
    track('open terminal', { airport: stop.name })
    /* The toasts deliberately outlive the view. A terminal that fails to
       load can take most of a minute to say so, and by then the traveller
       has zoomed away — which flips `gone` and, when it guarded the toasts
       too, swallowed every failure they ever asked about. State updates
       stay guarded; the news does not. */
    indoorForStop(stop)
      .then(found => {
        if (!found.length) {
          skipRef.current.set(stop.id, Number.POSITIVE_INFINITY)
          toastRef.current('No one has mapped the inside of ' + stop.name + ' yet', 'error')
          if (!gone) setStop(null)
          return
        }
        if (gone) return
        setFeatures(found)
        setLevel(defaultLevel(levelsOf(found)))
      })
      .catch(() => {
        skipRef.current.set(stop.id, Date.now() + 60_000)
        toastRef.current(
          'The terminal map for ' + stop.name + ' did not load — try again in a moment',
          'error',
        )
        if (!gone) setStop(null)
      })
      .finally(() => {
        if (!gone) setLoading(false)
      })
    return () => {
      gone = true
    }
  }, [stop])

  const graph = useMemo(() => (features ? walkGraph(features) : null), [features])

  /* A GPS fix from inside (or near) the airport is where the walk begins;
     one from the hotel across town is not, so the pin stands in. Keyed by
     content: the fix is a fresh array on every render of the page, and a
     route re-planned per render was a floor picker snapping back to the
     start floor whenever anything on the screen changed. */
  const startKey = start ? `${start[0]},${start[1]}` : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: startKey carries start's content
  const origin = useMemo(() => {
    if (!stop) return null
    const pin: Coordinates = [stop.lng, stop.lat]
    return start && stepMetres(start, pin) < 3000 ? start : pin
  }, [stop, startKey])

  const route = useMemo(
    () => (graph && target && origin ? planGateRoute(graph, origin, target) : null),
    [graph, target, origin],
  )

  /* The walk's current place is where the line goes; a tapped gate takes
     over until cleared, and clearing hands the line back to the walk. */
  useEffect(() => {
    tappedRef.current = false
    setTarget(walk.target)
  }, [walk.target])
  const walkTargetRef = useRef(walk.target)
  walkTargetRef.current = walk.target
  const toGate = useCallback((gate: IndoorGate) => {
    tappedRef.current = true
    setTarget(gate)
  }, [])
  const clearRoute = useCallback(() => {
    tappedRef.current = false
    setTarget(walkTargetRef.current)
  }, [])

  /* A gate with no mapped path to it is worth saying out loud, once, to the
     person who asked; the walk keeps its words and waits. A routed one
     starts the story on the floor the walk begins — once per destination,
     not every time the traveller moves and the line is drawn again. The
     destination is the place, not the object: a target rebuilt by the
     clock with the same gate in it is not a new destination, and treating
     it as one sent the floor picker back to the start floor every minute. */
  const shownFor = useRef<string | null>(null)
  const targetKey = target ? `${target.ref}|${target.lng},${target.lat}` : null
  useEffect(() => {
    if (!target || !graph) return
    if (!route) {
      if (tappedRef.current) {
        toastRef.current('The walking paths to that gate are not mapped yet', 'error')
      }
      tappedRef.current = false
      setTarget(null)
    } else if (route.steps.length && shownFor.current !== targetKey) {
      shownFor.current = targetKey
      setLevel(route.steps[0].level)
    }
  }, [target, targetKey, graph, route])

  const levels = useMemo(() => levelsOf(features || []), [features])
  const mapData = useMemo(() => {
    if (!stop || !features) return null
    const fc = onLevel(features, level)
    if (route) fc.features = fc.features.concat(routeSlices(route, level))
    return fc
  }, [stop, features, level, route])
  const routeText = useMemo(() => (route ? describeIndoorRoute(route) : null), [route])

  return {
    active: !!stop,
    stop,
    open,
    level,
    setLevel,
    levels,
    loading,
    mapData,
    target,
    toGate,
    clearRoute,
    routeText,
    walk,
  }
}

export type AirportIndoor = ReturnType<typeof useAirportIndoor>
