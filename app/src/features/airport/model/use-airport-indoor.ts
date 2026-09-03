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
import { track } from '../../../shared/lib/telemetry'
import { indoorForStop } from '../api/indoor'
import type { IndoorGate } from '../../map'
import type { Coordinates, Stop, Toast } from '../../../shared/model/types'

/* Terminal-map mode: which airport is open, which floor is showing, which gate
   is being walked to, and the slice of features the map should draw right now.
   Its own state rather than a facet of selection, so closing the stop's card
   does not yank the floor plan out from under someone reading it. */
export default function useAirportIndoor({
  toast,
  onOpen,
  start,
  view,
  stops,
}: {
  toast: Toast
  /** the page's chance to move the camera into the terminal */
  onOpen?: (stop: Stop) => void
  /** the freshest live GPS fix, if any — where the walk to a gate begins */
  start?: Coordinates | null
  /** where the camera is, so zooming into an airport opens its inside */
  view?: { center: Coordinates; zoom: number } | null
  stops?: Stop[]
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
  const autoRef = useRef<string | null>(null) // opened by the camera, not a click
  const dismissedRef = useRef<string | null>(null) // closed by hand; stay closed a while

  const open = useCallback((next: Stop) => {
    autoRef.current = null
    onOpenRef.current?.(next)
    setStop(next)
  }, [])
  const clearRoute = useCallback(() => setTarget(null), [])
  const closeAll = useCallback(() => {
    setStop(current => {
      if (current) dismissedRef.current = current.id
      return null
    })
    setFeatures(null)
    setTarget(null)
  }, [])
  // Escape steps back the way it came: first the route, then the terminal.
  const close = useCallback(() => {
    setTarget(current => {
      if (!current) {
        setStop(s => {
          if (s) dismissedRef.current = s.id
          return null
        })
        setFeatures(null)
      }
      return null
    })
  }, [])

  /* The camera is the other way in: zoom into an airport and its inside
     appears, loading while you are still approaching; zoom away and an
     auto-opened terminal folds itself up again. */
  useEffect(() => {
    const move = autoIndoorMove({
      view: view || null,
      stops,
      active: stop,
      auto: autoRef.current,
      dismissed: dismissedRef.current,
      routing: !!target,
    })
    if (!move) return
    if ('reset' in move) {
      dismissedRef.current = null
    } else if ('open' in move) {
      autoRef.current = move.open.id
      setStop(move.open)
    } else {
      setStop(null)
      setFeatures(null)
    }
  }, [view, stops, stop, target])

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
          toastRef.current('No one has mapped the inside of ' + stop.name + ' yet', 'error')
          if (!gone) setStop(null)
          return
        }
        if (gone) return
        setFeatures(found)
        setLevel(defaultLevel(levelsOf(found)))
      })
      .catch(() => {
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

  // A GPS fix from inside (or near) the airport is where the walk begins;
  // one from the hotel across town is not, so the pin stands in.
  const origin = useMemo(() => {
    if (!stop) return null
    const pin: Coordinates = [stop.lng, stop.lat]
    return start && stepMetres(start, pin) < 3000 ? start : pin
  }, [stop, start])

  const route = useMemo(
    () => (graph && target && origin ? planGateRoute(graph, origin, target) : null),
    [graph, target, origin],
  )

  const toGate = useCallback((gate: IndoorGate) => setTarget(gate), [])

  /* A gate with no mapped path to it is worth saying out loud, once; a routed
     one starts the story on the floor the walk begins. */
  useEffect(() => {
    if (!target || !graph) return
    if (!route) {
      toastRef.current('The walking paths to that gate are not mapped yet', 'error')
      setTarget(null)
    } else if (route.steps.length) {
      setLevel(route.steps[0].level)
    }
  }, [target, graph, route])

  const levels = useMemo(() => levelsOf(features || []), [features])
  const hasGates = useMemo(
    () => (features || []).some(f => f.properties.kind === 'gate'),
    [features],
  )
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
    close,
    closeAll,
    level,
    setLevel,
    levels,
    loading,
    mapData,
    target,
    toGate,
    clearRoute,
    routeText,
    hasGates,
  }
}

export type AirportIndoor = ReturnType<typeof useAirportIndoor>
