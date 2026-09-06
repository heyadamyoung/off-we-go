import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Coordinates } from '../../../shared/model/types'

/* Heading-up: the map turns so the way the phone faces is the way the screen
   points, and the camera keeps the walker under it — how a paper map is held.
   Each throttled compass reading eases a short step (easeTo takes the short
   way round a bearing on its own), so the world swings with the wrist instead
   of snapping. A hand on the map pauses the recentring but never the turning;
   leaving the mode eases north back to the top. */
export default function useHeadingCamera({
  map,
  on,
  facing,
  at,
  busy,
}: {
  map: MapLibreMap | null
  on: boolean
  facing: number | null
  at: Coordinates | null
  /** the user's own hand is on the map — turn, but do not tug the centre */
  busy: boolean
}) {
  const engaged = useRef(false)
  useEffect(() => {
    if (!map) return
    if (!on) {
      if (engaged.current) {
        engaged.current = false
        map.easeTo({ bearing: 0, duration: 500 })
      }
      return
    }
    engaged.current = true
    if (facing == null) return
    map.easeTo({
      bearing: facing,
      ...(at && !busy ? { center: at } : {}),
      duration: 250,
      easing: t => t,
    })
  }, [map, on, facing, at, busy])
}
