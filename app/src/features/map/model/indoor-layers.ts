import { useEffect, useRef } from 'react'
import type {
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
} from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { ACCENT } from './map-style'
import { nearestTap } from './tap-target'
import { EMPTY_FC } from './use-attractions'

/** A gate somebody tapped: where it is, what it is called, which levels it is on. */
export interface IndoorGate {
  ref: string
  levels: number[]
  lng: number
  lat: number
}

/* The inside of a terminal, drawn by the GPU like the attractions are: one
   source, a handful of layers, nothing in the DOM. Walkable space gets a wash
   of the accent so the eye reads "you can be here", rooms sit solid on top of
   it, and gates are points wearing their code. Everything fades in past city
   zoom and goes below the route, so the trip still reads over the building. */
const INK = {
  dark: {
    floor: 'rgba(255,255,255,0.05)',
    walk: 'rgba(245,184,74,0.10)',
    room: 'rgba(255,255,255,0.08)',
    line: 'rgba(255,255,255,0.22)',
    wall: 'rgba(255,255,255,0.38)',
    text: '#e8edf5',
    haloText: 'rgba(8,11,16,.85)',
    gateRing: 'rgba(8,11,16,.75)',
  },
  light: {
    floor: 'rgba(42,49,64,0.05)',
    walk: 'rgba(245,184,74,0.16)',
    room: 'rgba(42,49,64,0.07)',
    line: 'rgba(42,49,64,0.25)',
    wall: 'rgba(42,49,64,0.40)',
    text: '#2a3140',
    haloText: 'rgba(255,255,255,.92)',
    gateRing: 'rgba(255,255,255,.9)',
  },
}

const polygonOf = (kinds: string[]) =>
  [
    'all',
    ['==', ['geometry-type'], 'Polygon'],
    ['in', ['get', 'kind'], ['literal', kinds]],
  ] as FilterSpecification

export default function useIndoorLayers(
  map: MapLibreMap | null,
  data: FeatureCollection | null | undefined,
  themeRef: { current: string },
  onPickGate?: (gate: IndoorGate) => void,
) {
  const dataRef = useRef(data)
  dataRef.current = data
  const gateRef = useRef(onPickGate)
  gateRef.current = onPickGate

  useEffect(() => {
    if (!map) return
    const add = () => {
      if (map.getSource('indoor')) return
      const ink = INK[themeRef.current === 'light' ? 'light' : 'dark']
      const below = map.getLayer('route-halo') ? { beforeId: 'route-halo' } : {}
      map.addSource('indoor', { type: 'geojson', data: dataRef.current || EMPTY_FC })
      map.addLayer({
        id: 'indoor-floor',
        type: 'fill',
        source: 'indoor',
        minzoom: 13.5,
        ...below,
        filter: polygonOf(['floor', 'terminal']),
        paint: { 'fill-color': ink.floor },
      })
      map.addLayer({
        id: 'indoor-walk',
        type: 'fill',
        source: 'indoor',
        minzoom: 13.5,
        ...below,
        filter: polygonOf(['walk']),
        paint: { 'fill-color': ink.walk },
      })
      map.addLayer({
        id: 'indoor-room',
        type: 'fill',
        source: 'indoor',
        minzoom: 14.5,
        ...below,
        filter: polygonOf(['room']),
        paint: { 'fill-color': ink.room },
      })
      map.addLayer({
        id: 'indoor-outline',
        type: 'line',
        source: 'indoor',
        minzoom: 14.5,
        ...below,
        filter: polygonOf(['room', 'walk', 'floor', 'terminal']),
        paint: { 'line-color': ink.line, 'line-width': 0.8 },
      })
      map.addLayer({
        id: 'indoor-wall',
        type: 'line',
        source: 'indoor',
        minzoom: 14.5,
        ...below,
        filter: ['==', ['get', 'kind'], 'wall'],
        paint: { 'line-color': ink.wall, 'line-width': 1.2 },
      })
      // The corridors the routes walk, faint enough to be texture until one
      // of them lights up as the way to your gate.
      map.addLayer({
        id: 'indoor-path',
        type: 'line',
        source: 'indoor',
        minzoom: 15,
        ...below,
        filter: ['==', ['get', 'kind'], 'path'],
        paint: { 'line-color': ink.line, 'line-width': 1, 'line-dasharray': [1, 2] },
      })
      map.addLayer({
        id: 'indoor-route-away',
        type: 'line',
        source: 'indoor',
        minzoom: 13.5,
        ...below,
        filter: ['==', ['get', 'kind'], 'route-away'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ACCENT,
          'line-width': 2.2,
          'line-opacity': 0.35,
          'line-dasharray': [1, 1.6],
        },
      })
      map.addLayer({
        id: 'indoor-route-halo',
        type: 'line',
        source: 'indoor',
        minzoom: 13.5,
        ...below,
        filter: ['==', ['get', 'kind'], 'route-here'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ink.haloText, 'line-width': 7, 'line-opacity': 0.8 },
      })
      map.addLayer({
        id: 'indoor-route',
        type: 'line',
        source: 'indoor',
        minzoom: 13.5,
        ...below,
        filter: ['==', ['get', 'kind'], 'route-here'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ACCENT, 'line-width': 3.5 },
      })
      map.addLayer({
        id: 'indoor-transfer',
        type: 'circle',
        source: 'indoor',
        minzoom: 13.5,
        ...below,
        filter: ['==', ['get', 'kind'], 'transfer'],
        paint: {
          'circle-radius': 5,
          'circle-color': ACCENT,
          'circle-stroke-width': 1.6,
          'circle-stroke-color': ink.gateRing,
        },
      })
      map.addLayer({
        id: 'indoor-transfer-label',
        type: 'symbol',
        source: 'indoor',
        minzoom: 14.5,
        ...below,
        filter: ['==', ['get', 'kind'], 'transfer'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': ink.text, 'text-halo-color': ink.haloText, 'text-halo-width': 1.3 },
      })
      // Landmarks: what you steer by between gates, coloured by what they are.
      map.addLayer({
        id: 'indoor-poi',
        type: 'circle',
        source: 'indoor',
        minzoom: 15,
        ...below,
        filter: ['in', ['get', 'kind'], ['literal', ['poi', 'lift']]],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 18, 4.5],
          'circle-color': [
            'match',
            ['get', 'cat'],
            'wc',
            '#4fc9d4',
            'food',
            '#e8a33d',
            'shop',
            '#6fb1ff',
            'lounge',
            '#c98bdb',
            'info',
            '#57c78a',
            'lift',
            '#9aa6b8',
            '#8b93a3',
          ],
          'circle-stroke-width': 1.2,
          'circle-stroke-color': ink.gateRing,
        },
      })
      map.addLayer({
        id: 'indoor-gate',
        type: 'circle',
        source: 'indoor',
        minzoom: 14,
        ...below,
        filter: ['==', ['get', 'kind'], 'gate'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 17, 5.5],
          'circle-color': ACCENT,
          'circle-stroke-width': 1.4,
          'circle-stroke-color': ink.gateRing,
        },
      })
      map.addLayer({
        id: 'indoor-gate-label',
        type: 'symbol',
        source: 'indoor',
        minzoom: 15,
        ...below,
        filter: ['==', ['get', 'kind'], 'gate'],
        layout: {
          'text-field': ['get', 'ref'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 13],
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': ink.text, 'text-halo-color': ink.haloText, 'text-halo-width': 1.3 },
      })
      map.addLayer({
        id: 'indoor-name',
        type: 'symbol',
        source: 'indoor',
        minzoom: 16,
        ...below,
        filter: [
          'all',
          ['in', ['get', 'kind'], ['literal', ['room', 'walk', 'poi', 'lift']]],
          ['!=', ['get', 'name'], ''],
        ],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 19, 12.5],
          'text-optional': true,
          'text-padding': 4,
          'text-max-width': 8,
        },
        paint: { 'text-color': ink.text, 'text-halo-color': ink.haloText, 'text-halo-width': 1.2 },
      })
    }
    if (map.isStyleLoaded()) add()
    map.on('style.load', add)

    /* A gate is somewhere to go: tapping one asks the page for the walk.
       Padded like the attraction dots — a gate is five pixels wide — and
       array properties come back from a rendered-feature query as JSON
       strings, the same as they did from a layer click. */
    const pick = (e: MapMouseEvent) => {
      const f = nearestTap(map, e.point, 'indoor-gate')
      if (f?.geometry.type !== 'Point') return
      const p = (f.properties || {}) as { ref?: string; name?: string; levels?: string | number[] }
      gateRef.current?.({
        ref: p.ref || p.name || '',
        levels:
          typeof p.levels === 'string'
            ? (JSON.parse(p.levels || '[]') as number[])
            : p.levels || [],
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
    map.on('click', pick)
    map.on('mouseenter', 'indoor-gate', enter)
    map.on('mouseleave', 'indoor-gate', leave)
    return () => {
      map.off('style.load', add)
      map.off('click', pick)
      map.off('mouseenter', 'indoor-gate', enter)
      map.off('mouseleave', 'indoor-gate', leave)
    }
  }, [map, themeRef])

  useEffect(() => {
    if (!map) return
    const src = map.getSource<GeoJSONSource>('indoor')
    if (src) src.setData(data || EMPTY_FC)
  }, [map, data])
}
