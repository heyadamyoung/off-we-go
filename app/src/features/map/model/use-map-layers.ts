import { useEffect, useRef, type MutableRefObject } from 'react'
import type { GeoJSONSource, Map as MapGL } from 'maplibre-gl'
import { lineOf } from '../../../shared/lib/geo'
import { motionMs } from '../../../shared/lib/motion'
import { ACCENT, ACCENT_BRIGHT, linesOf } from './map-style'
import { whenStyleReady } from './style-ready'
import useAttractionLayers from './use-attraction-layers'
import type { MapCanvasProps } from './map-props'

/* Everything painted INTO the map document — the tint wash, the hand-drawn
   route, the walked trail, the attraction dots — rebuilt whenever a style
   load wipes the document. DOM markers live in map-canvas; layers live here. */
interface MapLayerOptions {
  map: MapGL | null
  routeRef: MutableRefObject<NonNullable<MapCanvasProps['route']>>
  trailRef: MutableRefObject<NonNullable<MapCanvasProps['trail']>>
  trailFadedRef: MutableRefObject<NonNullable<MapCanvasProps['trailFaded']>>
  tintRef: MutableRefObject<MapCanvasProps['tint']>
  themeRef: MutableRefObject<MapCanvasProps['theme']>
  route: NonNullable<MapCanvasProps['route']>
  trail: NonNullable<MapCanvasProps['trail']>
  trailFaded: NonNullable<MapCanvasProps['trailFaded']>
  measure: MapCanvasProps['measure']
  sweepIn: (map: MapGL) => void
  attractions: MapCanvasProps['attractions']
  onPickAttraction: MapCanvasProps['onPickAttraction']
  onContextMenu?: (point: [number, number]) => void
}
export default function useMapLayers({
  map,
  routeRef,
  trailRef,
  trailFadedRef,
  tintRef,
  themeRef,
  route,
  trail,
  trailFaded,
  measure,
  sweepIn,
  attractions,
  onPickAttraction,
  onContextMenu,
}: MapLayerOptions) {
  const measureRef = useRef(measure)
  measureRef.current = measure
  const menuRef = useRef(onContextMenu)
  menuRef.current = onContextMenu

  /* Ask the map about a place, not a feature: right-click on a desktop,
     long-press on a phone. Chrome and Samsung raise contextmenu for a
     long-press on the canvas; iOS never does, so a touch timer stands in —
     550ms still, within a thumb's wobble. */
  useEffect(() => {
    if (!map) return
    const open = (e: { lngLat: { lng: number; lat: number }; preventDefault?: () => void }) => {
      e.preventDefault?.()
      menuRef.current?.([e.lngLat.lng, e.lngLat.lat])
    }
    map.on('contextmenu', open)
    const canvas = map.getCanvas()
    let timer: ReturnType<typeof setTimeout> | null = null
    let start: Touch | null = null
    const clear = () => {
      if (timer) clearTimeout(timer)
      timer = null
      start = null
    }
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) return clear()
      start = e.touches[0]
      timer = setTimeout(() => {
        if (!start) return
        const rect = canvas.getBoundingClientRect()
        const at = map.unproject([start.clientX - rect.left, start.clientY - rect.top])
        menuRef.current?.([at.lng, at.lat])
        clear()
      }, 550)
    }
    const move = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!start || !t) return
      if (Math.hypot(t.clientX - start.clientX, t.clientY - start.clientY) > 10) clear()
    }
    canvas.addEventListener('touchstart', down, { passive: true })
    canvas.addEventListener('touchmove', move, { passive: true })
    canvas.addEventListener('touchend', clear)
    canvas.addEventListener('touchcancel', clear)
    return () => {
      map.off('contextmenu', open)
      canvas.removeEventListener('touchstart', down)
      canvas.removeEventListener('touchmove', move)
      canvas.removeEventListener('touchend', clear)
      canvas.removeEventListener('touchcancel', clear)
      clear()
    }
  }, [map])
  /* ---- the route, re-added whenever a style loads ------------------------
   setStyle replaces the whole style document, so anything we added goes with
   it. Re-adding on every style.load covers both first load and theme swaps. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-adding is keyed to style loads; the sweep callback changing must not tear the listener down
  useEffect(() => {
    if (!map) return
    const addRoute = () => {
      if (map.getSource('route')) return
      // Time-of-day wash. A background layer added here sits above every style
      // layer but below the route, so the route keeps its true accent colour —
      // and DOM markers live above the canvas entirely, so they never tint.
      if (!map.getLayer('tod-tint') && tintRef.current) {
        map.addLayer({
          id: 'tod-tint',
          type: 'background',
          paint: {
            'background-color': tintRef.current.color,
            'background-opacity': tintRef.current.alpha,
            // Two seconds: the sky changing, not a switch thrown. None, for less motion.
            'background-color-transition': { duration: motionMs(2000), delay: 0 },
            'background-opacity-transition': { duration: motionMs(2000), delay: 0 },
          },
        })
      }
      /* Map grammar, the convention way round: dashed is a plan, solid is a
       fact. The hand-drawn route is the plan — dotted and quiet. Where the
       phones actually went is the fact — solid amber with a glow, the same
       light the logo-less brand runs on. */
      map.addSource('route', { type: 'geojson', data: lineOf(routeRef.current) })
      map.addLayer({
        // Kept as an insertion anchor for the attraction layers; it no longer
        // paints anything itself.
        id: 'route-halo',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ACCENT, 'line-width': 8, 'line-opacity': 0 },
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ACCENT,
          'line-width': 2,
          'line-opacity': 0.6,
          'line-dasharray': [1.5, 3.5],
        },
      })
      /* Yesterday's walking, a ghost under today's: same amber, a third of the
         strength, no glow — the record stays visible without ever passing for
         the live line. */
      map.addSource('trail-faded', { type: 'geojson', data: linesOf(trailFadedRef.current) })
      map.addLayer({
        id: 'trail-faded-line',
        type: 'line',
        source: 'trail-faded',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ACCENT, 'line-width': 2, 'line-opacity': 0.32 },
      })
      map.addSource('trail', {
        type: 'geojson',
        data: linesOf(trailRef.current),
        lineMetrics: true,
      })
      map.addLayer({
        id: 'trail-halo',
        type: 'line',
        source: 'trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ACCENT_BRIGHT,
          'line-width': 11,
          'line-opacity': 0.22,
          'line-blur': 6,
        },
      })
      map.addLayer({
        id: 'trail-line',
        type: 'line',
        source: 'trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ACCENT, 'line-width': 3 },
      })
      /* The measured way: from the phone in your hand to the stop you asked
         about. Brighter and tighter-dashed than the plan so it reads as an
         answer, cleared the moment the question closes. */
      map.addSource('measure', { type: 'geojson', data: lineOf(measureRef.current || []) })
      map.addLayer({
        id: 'measure-halo',
        type: 'line',
        source: 'measure',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ACCENT_BRIGHT, 'line-width': 6, 'line-opacity': 0.25 },
      })
      map.addLayer({
        id: 'measure-line',
        type: 'line',
        source: 'measure',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ACCENT_BRIGHT,
          'line-width': 2.5,
          'line-opacity': 0.9,
          'line-dasharray': [0.5, 2],
        },
      })
      sweepIn(map)
    }
    return whenStyleReady(map, addRoute)
  }, [map])

  useEffect(() => {
    if (!map) return
    const src = map.getSource<GeoJSONSource>('route')
    if (src) src.setData(lineOf(route))
  }, [map, route])

  useEffect(() => {
    if (!map) return
    const src = map.getSource<GeoJSONSource>('measure')
    if (src) src.setData(lineOf(measure || []))
  }, [map, measure])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the sweep replays when the trail changes, not when the sweep function is rebuilt
  useEffect(() => {
    if (!map) return
    const src = map.getSource<GeoJSONSource>('trail')
    if (src) {
      src.setData(linesOf(trail))
      sweepIn(map)
    }
  }, [map, trail])

  useEffect(() => {
    if (!map) return
    const src = map.getSource<GeoJSONSource>('trail-faded')
    if (src) src.setData(linesOf(trailFaded))
  }, [map, trailFaded])

  /* The places layer — the scenery this trip is drawn over. Its own file
     because it is its own problem: three hundred features whose whole
     difficulty is deciding which of them deserve to be seen from where. */
  useAttractionLayers({ map, attractions, themeRef, onPickAttraction })
}
