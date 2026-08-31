import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapGL, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import Icon from '../../../shared/ui/icon'
import Img from '../../../shared/ui/img'
import { lineOf } from '../../../shared/lib/geo'
import { EMPTY_FC } from '../model/use-attractions'
import { ACCENT, TRAIL, STYLE, linesOf } from '../model/map-style'
import { LiveMarker, MapMarker } from './map-marker'

setWorkerUrl(maplibreWorkerUrl)

const MapCanvas = memo(function MapCanvas({
  view, onView, theme, tint, interactive = true, route = [], stops = [], photos = [],
  markers = [], trail = [],
  selectedStop, onStop, onPhoto, onLive, labels = false, highlight = null,
  editing = false, onMapClick, onStopMove, places = [], onPickPlace,
  attractions = null, onPickAttraction, children,
}: any) {
  const holder = useRef(null)
  const [map, setMap] = useState(null)
  const [moving, setMoving] = useState(false)     // any camera movement
  const [dragging, setDragging] = useState(false)  // the user's hand, specifically

  const oref = useRef(onView); oref.current = onView
  const routeRef = useRef(route); routeRef.current = route
  const trailRef = useRef(trail); trailRef.current = trail
  const themeRef = useRef(theme); themeRef.current = theme
  const tintRef = useRef(tint); tintRef.current = tint
  const viewRef = useRef(view); viewRef.current = view
  const userMove = useRef(false)
  const moved = useRef(false)

  const halo = theme === 'light' ? '#ffffff' : '#0a0c10'

  /* ---- create once ------------------------------------------------------ */
  useEffect(() => {
    if (!holder.current) return
    const v = viewRef.current
    const m = new MapGL({
      container: holder.current,
      style: STYLE[themeRef.current === 'light' ? 'light' : 'dark'],
      center: v.center,
      zoom: v.zoom,
      minZoom: 3,
      maxZoom: 18,
      interactive,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    m.touchZoomRotate?.disableRotation?.()
    setMap(m)
    // A handle for the test suite: the attraction layer is drawn by the GPU,
    // so there is no element to select and assert against.
    if (interactive) window.__wayfareMap = m
    return () => { m.remove(); setMap(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- the route, re-added whenever a style loads ------------------------
     setStyle replaces the whole style document, so anything we added goes with
     it. Re-adding on every style.load covers both first load and theme swaps. */
  useEffect(() => {
    if (!map) return
    const addRoute = () => {
      if (map.getSource('route')) return
      // Time-of-day wash. A background layer added here sits above every style
      // layer but below the route, so the route keeps its true accent colour —
      // and DOM markers live above the canvas entirely, so they never tint.
      if (!map.getLayer('tod-tint') && tintRef.current) {
        map.addLayer({
          id: 'tod-tint', type: 'background',
          paint: {
            'background-color': tintRef.current.color,
            'background-opacity': tintRef.current.alpha,
            'background-color-transition': { duration: 2000, delay: 0 },
            'background-opacity-transition': { duration: 2000, delay: 0 },
          },
        })
      }
      map.addSource('route', { type: 'geojson', data: lineOf(routeRef.current) })
      map.addLayer({
        id: 'route-halo', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': themeRef.current === 'light' ? '#ffffff' : '#0a0c10',
          'line-width': 8, 'line-opacity': 0.9,
        },
      })
      map.addLayer({
        id: 'route-line', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ACCENT, 'line-width': 3.5 },
      })
      // Where the phones actually went, over the route that was drawn by hand.
      map.addSource('trail', { type: 'geojson', data: linesOf(trailRef.current) })
      map.addLayer({
        id: 'trail-line', type: 'line', source: 'trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': TRAIL, 'line-width': 2.6, 'line-opacity': 0.9, 'line-dasharray': [1.6, 1.4] },
      })
    }
    if (map.isStyleLoaded()) addRoute()
    map.on('style.load', addRoute)
    return () => { map.off('style.load', addRoute) }
  }, [map])

  useEffect(() => {
    if (!map) return
    const src = map.getSource('route')
    if (src) src.setData(lineOf(route))
  }, [map, route])

  useEffect(() => {
    if (!map) return
    const src = map.getSource('trail')
    if (src) src.setData(linesOf(trail))
  }, [map, trail])

  /* Attractions are drawn by the map itself rather than as DOM markers. There
     can be thousands of them across a country, and a thousand absolutely
     positioned elements re-laid-out on every frame is exactly the jank this
     map was rebuilt to be rid of. As a source and two layers they cost the GPU
     almost nothing and stay put during a gesture. */
  const pickRef = useRef(onPickAttraction); pickRef.current = onPickAttraction
  useEffect(() => {
    if (!map) return
    const add = () => {
      if (map.getSource('attr')) return
      map.addSource('attr', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: 'attr-dot', type: 'circle', source: 'attr',
        // Below the route, so the trip always reads on top of the scenery.
        ...(map.getLayer('route-halo') ? { beforeId: 'route-halo' } : {}),
        filter: ['any', ['get', 'big'], ['>=', ['zoom'], 11]],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2.4, 10, 3.4, 14, 5, 17, 7],
          'circle-color': ['match', ['get', 'k'],
            'castle', '#c98bdb', 'museum', '#6fb1ff', 'worship', '#9aa6b8',
            'outdoors', '#57c78a', 'history', '#d8a25f', 'culture', '#e07ea8',
            'food', '#e8a33d', 'fun', '#4fc9d4', '#8b93a3'],
          'circle-stroke-width': 1.4,
          'circle-stroke-color': 'rgba(8,11,16,.75)',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.72, 12, 0.95],
        },
      })
      map.addLayer({
        id: 'attr-label', type: 'symbol', source: 'attr',
        ...(map.getLayer('route-halo') ? { beforeId: 'route-halo' } : {}),
        minzoom: 12.6,
        filter: ['any', ['get', 'big'], ['>=', ['zoom'], 13.4]],
        layout: {
          'text-field': ['get', 'n'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12.6, 10, 16, 12.5],
          'text-offset': [0, 1.05], 'text-anchor': 'top',
          'text-optional': true, 'text-padding': 6,
          'text-max-width': 9,
        },
        paint: {
          'text-color': themeRef.current === 'light' ? '#2a3140' : '#e8edf5',
          'text-halo-color': themeRef.current === 'light' ? 'rgba(255,255,255,.92)' : 'rgba(8,11,16,.85)',
          'text-halo-width': 1.3,
        },
      })
    }
    if (map.isStyleLoaded()) add()
    map.on('style.load', add)

    const hit = e => {
      const f = e.features?.[0]
      if (f) pickRef.current?.({ ...f.properties, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })
    }
    const enter = () => { map.getCanvas().style.cursor = 'pointer' }
    const leave = () => { map.getCanvas().style.cursor = '' }
    map.on('click', 'attr-dot', hit)
    map.on('mouseenter', 'attr-dot', enter)
    map.on('mouseleave', 'attr-dot', leave)
    return () => {
      map.off('style.load', add)
      map.off('click', 'attr-dot', hit)
      map.off('mouseenter', 'attr-dot', enter)
      map.off('mouseleave', 'attr-dot', leave)
    }
  }, [map])

  useEffect(() => {
    if (!map || !attractions) return
    const src = map.getSource('attr')
    if (src) src.setData(attractions)
  }, [map, attractions])

  useEffect(() => {
    if (!map || !map.getLayer('route-halo')) return
    map.setPaintProperty('route-halo', 'line-color', halo)
  }, [map, halo])

  useEffect(() => {
    if (!map || !tint || !map.getLayer('tod-tint')) return
    map.setPaintProperty('tod-tint', 'background-color', tint.color)
    map.setPaintProperty('tod-tint', 'background-opacity', tint.alpha)
  }, [map, tint])

  /* ---- theme ------------------------------------------------------------ */
  const shownTheme = useRef(theme)
  useEffect(() => {
    if (!map || theme === shownTheme.current) return
    shownTheme.current = theme
    // These basemaps have different sprite atlases. Reusing the old Style while
    // the new document loads can make an atlas update target the old texture's
    // dimensions, which ANGLE rejects as an overflowing texSubImage2D offset.
    map.setStyle(STYLE[theme === 'light' ? 'light' : 'dark'], { diff: false })
  }, [map, theme])

  /* ---- keep the camera in step with the app -----------------------------
     Only moves when the app actually asks for somewhere else; the position we
     report back on moveend lands here again and must not start a second move. */
  useEffect(() => {
    if (!map) return
    if (view.bounds) {
      map.fitBounds(view.bounds, {
        padding: 32, maxZoom: 15,
        duration: view.ms == null ? 420 : view.ms, essential: true,
      })
      return
    }
    const c = map.getCenter()
    if (Math.abs(c.lng - view.center[0]) < 1e-7 &&
        Math.abs(c.lat - view.center[1]) < 1e-7 &&
        Math.abs(map.getZoom() - view.zoom) < 1e-4) return
    map.easeTo({
      center: view.center, zoom: view.zoom,
      duration: view.ms == null ? 420 : view.ms, essential: true,
    })
  }, [map, view])

  useEffect(() => {
    if (!map) return
    const start = e => { userMove.current = !!e.originalEvent; setMoving(true) }
    const end = () => {
      setMoving(false)
      const c = map.getCenter()
      oref.current({ center: [c.lng, c.lat], zoom: map.getZoom() },
                   userMove.current ? { user: true } : undefined)
      userMove.current = false
    }
    // A drag must not also count as a click on whatever marker was underneath.
    const dragStart = () => { moved.current = true; setDragging(true) }
    const dragEnd = () => { setDragging(false); setTimeout(() => { moved.current = false }, 0) }
    map.on('movestart', start)
    map.on('moveend', end)
    map.on('dragstart', dragStart)
    map.on('dragend', dragEnd)
    return () => {
      map.off('movestart', start); map.off('moveend', end)
      map.off('dragstart', dragStart); map.off('dragend', dragEnd)
    }
  }, [map])

  useEffect(() => {
    if (!map || !holder.current) return
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(holder.current)
    return () => ro.disconnect()
  }, [map])

  // Placing a stop by clicking the map. Markers are DOM above the canvas, so a
  // click on a pin never reaches this — which is what we want: clicking a pin
  // edits it, clicking bare map creates one.
  const clickRef = useRef(onMapClick); clickRef.current = onMapClick
  useEffect(() => {
    if (!map || !editing) return
    const h = e => clickRef.current?.([e.lngLat.lng, e.lngLat.lat])
    map.on('click', h)
    return () => map.off('click', h)
  }, [map, editing])

  /* ---- overlays --------------------------------------------------------- */
  // Photos are grouped per stop so a busy corner shows one tidy stack, not a pile.
  const groups = useMemo(() => {
    const byStop = new Map(), loose = []
    photos.forEach(p => {
      if (!p.stopId) { loose.push(p); return }
      if (!byStop.has(p.stopId)) byStop.set(p.stopId, [])
      byStop.get(p.stopId).push(p)
    })
    const out = []
    byStop.forEach((items, stopId) => {
      const s = stops.find(x => x.id === stopId) || items[0]
      out.push({ key: 'g' + stopId, lng: s.lng, lat: s.lat, items })
    })
    loose.forEach(p => out.push({ key: p.id, lng: p.lng, lat: p.lat, items: [p] }))
    return out
  }, [photos, stops])

  return (
    <div className={'mapcanvas' + (moving ? ' busy' : '') + (dragging ? ' drag' : '')
                     + (editing ? ' editing' : '')} ref={holder}>
      {map && stops.map(s => (
        <MapMarker key={s.id} map={map} lng={s.lng} lat={s.lat}
                   draggable={editing} onDragEnd={p => onStopMove?.(s.id, p)}>
          <div className={'mstop ' + (s.status === 'done' ? 'done ' : '')
                          + (editing ? 'edit ' : '') + (selectedStop === s.id ? 'sel' : '')}
               onClick={e => { e.stopPropagation(); if (!moved.current) onStop?.(s.id) }}>
            <div className="pin"><Icon n={s.icon} s={13} c="#fff" w={2} /></div>
            {(labels || selectedStop === s.id) && <div className="lab">{s.name}</div>}
          </div>
        </MapMarker>
      ))}

      {map && groups.map(g => (
        <MapMarker key={g.key} map={map} lng={g.lng} lat={g.lat}>
          <div className={'mstack' + (g.items.some(p => p.id === highlight) ? ' hi' : '')}
               onClick={e => { e.stopPropagation(); if (!moved.current) onPhoto?.(g.items, 0) }}
               title={`${g.items.length} photo${g.items.length === 1 ? '' : 's'}`}>
            <span className="in">
              {g.items.slice(0, 3).map((p, i) => (
                <span className="sh" key={p.id}
                      style={{ zIndex: 3 - i, transform: `translate(${i * 5}px,${i * -4}px) rotate(${(i - 1) * 4}deg)` }}>
                  <Img item={p} w={160} h={160} />
                </span>
              ))}
              {g.items.length > 1 && <span className="ct">{g.items.length}</span>}
            </span>
          </div>
        </MapMarker>
      ))}

      {map && places.map(pl => (
        <MapMarker key={pl.id} map={map} lng={pl.lng} lat={pl.lat}>
          <button className="mfind" title={pl.kind || pl.name}
                  onClick={e => { e.stopPropagation(); onPickPlace?.(pl) }}>
            {pl.image && <img src={pl.image} alt="" />}
            <span>{pl.name}</span>
          </button>
        </MapMarker>
      ))}

      {map && markers.map(m => (
        <LiveMarker key={m.key} map={map} lng={m.lng} lat={m.lat} avatar={m.avatar} name={m.name}
                    title={m.title} onClick={onLive} movedRef={moved} />
      ))}

      {children}
      <div className="attrib">© OpenStreetMap · CARTO</div>
    </div>
  )
})

export default MapCanvas




