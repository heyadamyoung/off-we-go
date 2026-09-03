import { useEffect, useRef, type MutableRefObject } from 'react'
import type { GeoJSONSource, Map as MapGL, MapLayerMouseEvent } from 'maplibre-gl'
import { lineOf } from '../../../shared/lib/geo'
import { ACCENT, ACCENT_BRIGHT, linesOf } from './map-style'
import { EMPTY_FC } from './use-attractions'
import type { MapCanvasProps } from './map-props'

/* Everything painted INTO the map document — the tint wash, the hand-drawn
   route, the walked trail, the attraction dots — rebuilt whenever a style
   load wipes the document. DOM markers live in map-canvas; layers live here. */
interface MapLayerOptions {
  map: MapGL | null
  routeRef: MutableRefObject<NonNullable<MapCanvasProps['route']>>
  trailRef: MutableRefObject<NonNullable<MapCanvasProps['trail']>>
  tintRef: MutableRefObject<MapCanvasProps['tint']>
  themeRef: MutableRefObject<MapCanvasProps['theme']>
  route: NonNullable<MapCanvasProps['route']>
  trail: NonNullable<MapCanvasProps['trail']>
  sweepIn: (map: MapGL) => void
  onPickAttraction: MapCanvasProps['onPickAttraction']
}

export default function useMapLayers({
  map,
  routeRef,
  trailRef,
  tintRef,
  themeRef,
  route,
  trail,
  sweepIn,
  onPickAttraction,
}: MapLayerOptions) {
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
            'background-color-transition': { duration: 2000, delay: 0 },
            'background-opacity-transition': { duration: 2000, delay: 0 },
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
      sweepIn(map)
    }
    if (map.isStyleLoaded()) addRoute()
    map.on('style.load', addRoute)
    return () => {
      map.off('style.load', addRoute)
    }
  }, [map])

  useEffect(() => {
    if (!map) return
    const src = map.getSource<GeoJSONSource>('route')
    if (src) src.setData(lineOf(route))
  }, [map, route])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the sweep replays when the trail changes, not when the sweep function is rebuilt
  useEffect(() => {
    if (!map) return
    const src = map.getSource<GeoJSONSource>('trail')
    if (src) {
      src.setData(linesOf(trail))
      sweepIn(map)
    }
  }, [map, trail])

  /* Attractions are drawn by the map itself rather than as DOM markers. There
   can be thousands of them across a country, and a thousand absolutely
   positioned elements re-laid-out on every frame is exactly the jank this
   map was rebuilt to be rid of. As a source and two layers they cost the GPU
   almost nothing and stay put during a gesture. */
  const pickRef = useRef(onPickAttraction)
  pickRef.current = onPickAttraction
  useEffect(() => {
    if (!map) return
    const add = () => {
      if (map.getSource('attr')) return
      map.addSource('attr', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: 'attr-dot',
        type: 'circle',
        source: 'attr',
        // Below the route, so the trip always reads on top of the scenery.
        ...(map.getLayer('route-halo') ? { beforeId: 'route-halo' } : {}),
        filter: ['any', ['get', 'big'], ['>=', ['zoom'], 11]],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2.4, 10, 3.4, 14, 5, 17, 7],
          'circle-color': [
            'match',
            ['get', 'k'],
            'castle',
            '#c98bdb',
            'museum',
            '#6fb1ff',
            'worship',
            '#9aa6b8',
            'outdoors',
            '#57c78a',
            'history',
            '#d8a25f',
            'culture',
            '#e07ea8',
            'food',
            '#e8a33d',
            'fun',
            '#4fc9d4',
            '#8b93a3',
          ],
          'circle-stroke-width': 1.4,
          'circle-stroke-color': 'rgba(8,11,16,.75)',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.72, 12, 0.95],
        },
      })
      map.addLayer({
        id: 'attr-label',
        type: 'symbol',
        source: 'attr',
        ...(map.getLayer('route-halo') ? { beforeId: 'route-halo' } : {}),
        minzoom: 12.6,
        filter: ['any', ['get', 'big'], ['>=', ['zoom'], 13.4]],
        layout: {
          'text-field': ['get', 'n'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12.6, 10, 16, 12.5],
          'text-offset': [0, 1.05],
          'text-anchor': 'top',
          'text-optional': true,
          'text-padding': 6,
          'text-max-width': 9,
        },
        paint: {
          'text-color': themeRef.current === 'light' ? '#2a3140' : '#e8edf5',
          'text-halo-color':
            themeRef.current === 'light' ? 'rgba(255,255,255,.92)' : 'rgba(8,11,16,.85)',
          'text-halo-width': 1.3,
        },
      })
    }
    if (map.isStyleLoaded()) add()
    map.on('style.load', add)

    const hit = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (f?.geometry.type !== 'Point') return
      /* Feature properties round-trip through the GPU as plain JSON; this is
       the shape featureFor wrote into them. */
      const drawn = f.properties as {
        id: number
        n: string
        d?: string
        k?: string
        f?: string
        big?: boolean
      }
      pickRef.current?.({
        ...drawn,
        name: drawn.n,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      })
    }
    const enter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const leave = () => {
      map.getCanvas().style.cursor = ''
    }
    map.on('click', 'attr-dot', hit)
    map.on('mouseenter', 'attr-dot', enter)
    map.on('mouseleave', 'attr-dot', leave)
    return () => {
      map.off('style.load', add)
      map.off('click', 'attr-dot', hit)
      map.off('mouseenter', 'attr-dot', enter)
      map.off('mouseleave', 'attr-dot', leave)
    }
  }, [map, themeRef])
}
