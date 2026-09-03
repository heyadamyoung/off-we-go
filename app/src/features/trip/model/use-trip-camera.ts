import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { liveFollowView, visibleMapPadding } from '../../../live-map-view-core'
import type { Coordinates, MapView, Stop } from '../../../shared/model/types'

interface CameraInput {
  live: Coordinates
  livePoints: Coordinates[]
  liveReady: boolean
  stops: Stop[]
  panelOpen: boolean
  setMapView: (next: MapView | ((current: MapView) => MapView)) => void
}

/* One owner for the camera. Switching follow on is a request to go and look at
   the travellers, so it zooms in; a position arriving while already following
   is not, and must not yank the zoom the reader has chosen. Both go through the
   same effect — when the toggle sent its own camera command as well, the two
   raced, and the second one, carrying the zoom from before the tap, won. */
export function useTripCamera({
  live,
  livePoints,
  liveReady,
  stops,
  panelOpen,
  setMapView,
}: CameraInput) {
  const [following, setFollowing] = useState(true)
  const engaging = useRef(false)

  /* How much of the map is behind the chrome, kept in step with the screen:
     the answer changes with a rotation, a resized window, a panel opening. */
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  )
  useEffect(() => {
    const measure = () => setWidth(window.innerWidth)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [])
  const padding = useMemo(() => visibleMapPadding({ width, panelOpen }), [width, panelOpen])

  useEffect(() => {
    if (!following || !liveReady) return
    const engage = engaging.current
    engaging.current = false
    const duration = engage ? 520 : 900
    setMapView(
      current =>
        liveFollowView(current, livePoints, { ready: true, duration }) || {
          center: live,
          zoom: engage ? Math.max(current.zoom, 15) : current.zoom,
          ms: duration,
          focus: true,
        },
    )
  }, [live, livePoints, liveReady, following, setMapView])

  /* The first frame: with no live positions to follow, the opening view is
     the whole itinerary fitted into the visible band — not the stored centre
     with a corner stop parked under the toolbar. Runs once; live trips are
     the follow effect's business and skip it. */
  const framed = useRef(false)
  useEffect(() => {
    if (framed.current || liveReady || livePoints.length || !stops.length) return
    framed.current = true
    const lngs = stops.map(stop => stop.lng)
    const lats = stops.map(stop => stop.lat)
    setMapView(current => ({
      center: current.center,
      zoom: current.zoom,
      ms: 0,
      bounds: [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
    }))
  }, [liveReady, livePoints.length, stops, setMapView])

  const toggleFollow = useCallback(() => {
    setFollowing(current => {
      engaging.current = !current
      return !current
    })
  }, [])

  const fitAll = useCallback(() => {
    setFollowing(false)
    if (!stops.length) return
    const lngs = stops.map(stop => stop.lng)
    const lats = stops.map(stop => stop.lat)
    const west = Math.min(...lngs),
      east = Math.max(...lngs)
    const south = Math.min(...lats),
      north = Math.max(...lats)
    setMapView(current => ({
      center: [(west + east) / 2, (south + north) / 2],
      zoom: current.zoom,
      ms: 620,
      bounds: [
        [west, south],
        [east, north],
      ],
    }))
  }, [stops, setMapView])

  return { following, setFollowing, toggleFollow, fitAll, padding }
}
