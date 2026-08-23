import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { Map as MapGL, Marker, setWorkerUrl } from 'maplibre-gl'   // v6 is named-exports only
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

// v6 ships its tile-parsing worker as a separate module and resolves it against
// import.meta.url, which no longer points anywhere useful once bundled. Without
// this the map builds, loads its style and then silently never requests a tile.
setWorkerUrl(maplibreWorkerUrl)
import { AHEAD, pic, picFallback } from './data'
import {
  hasBackend, supabase, loadTrip, createStop, updateStop, deleteStop,
  addComment as saveComment, setLike, listInvites, invitePerson, revokeInvite,
  sendMagicLink, signOut,
} from './backend'

/* =========================================================================
   Icons
   ========================================================================= */
const PATHS = {
  pin:'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z|M14.5 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  plane:'M3 12l18-8-6 18-3-7z',
  bed:'M3 18V8M3 13h18v5M21 18v-5a3 3 0 0 0-3-3H11v3|M9 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  boat:'M3 17h18l-2 4H5zM5 17V9l7-5 7 5v8',
  museum:'M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M12 3l9 5H3z',
  food:'M6 3v7a3 3 0 0 0 6 0V3M9 3v18M17 3c-2 2-2 6-2 9h3v9',
  walk:'M9 21l3-7 2 2v5M7 13l3-4 3 1 3 3M15 21l-2-6|M14.6 4a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z',
  check:'M5 12l4 4L19 7',
  clock:'M12 8v4l3 2|M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  plus:'M12 5v14M5 12h14', minus:'M5 12h14',
  chev:'M9 6l6 6-6 6', chevl:'M15 6l-6 6 6 6', chevd:'M6 9l6 6 6-6',
  x:'M6 6l12 12M18 6L6 18',
  share:'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
  heart:'M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.4-7 10-7 10z',
  loc:'M12 2v4M12 18v4M2 12h4M18 12h4|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  search:'M20 20l-4-4|M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z',
  map:'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z|M9 4v14M15 6v14',
  list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grid:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  users:'M2 20c0-4 3-6 7-6s7 2 7 6M17 5a3 3 0 0 1 0 6M18 20c0-3-1-4.5-2.5-5.5|M12 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  camera:'M4 8h3l2-3h6l2 3h3v11H4z|M15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z',
  send:'M4 5h16v11H9l-5 4z',
  moon:'M21 13A8 8 0 1 1 11 3a6.5 6.5 0 0 0 10 10z',
  sun:'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4|M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  expand:'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6',
  copy:'M9 9h11v11H9zM5 15V4h11',
  upload:'M12 19V7M7 12l5-5 5 5M5 20h14',
  edit:'M4 20h4l10-10-4-4L4 16z|M13.5 6.5l4 4',
  download:'M12 4v12M7 11l5 5 5-5M5 20h14',
}
// Icons re-render on every map frame; split the path data once, not 50x per frame.
const SEGS = {}
for (const k in PATHS) SEGS[k] = PATHS[k].split('|')

const Icon = memo(function Icon({ n, s = 16, c = 'currentColor', w = 1.8 }) {
  const d = SEGS[n] || SEGS.pin
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w}
         strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
      {d.map((p, i) => <path key={i} d={p} />)}
    </svg>
  )
})

/* =========================================================================
   Image with a guaranteed fallback

   Every url that has decoded once is remembered for the session, so a photo
   that reappears in another view (grid -> viewer -> filmstrip) mounts already
   "ready" and does not replay the fade-in from an empty box.
   ========================================================================= */
const SEEN = new Set()
// Rows that came from a database have no placeholder keywords, so fall back to
// a stable per-id image rather than requesting `undefined`.
const srcFor = (item, w, h) =>
  item.src || (item.kw ? pic(item.kw, item.lock, w, h) : picFallback(item.seed || item.id, w, h))

const Img = memo(function Img({ item, w = 800, h = 600, className, style, alt = '', eager = false }) {
  const first = srcFor(item, w, h)
  const [src, setSrc] = useState(first)
  const [ready, setReady] = useState(() => SEEN.has(first))

  useEffect(() => {
    const next = srcFor(item, w, h)
    setSrc(next)
    setReady(SEEN.has(next))
  }, [item.id, item.src, item.kw, item.lock, w, h])

  const cls = 'im' + (ready ? ' rdy' : '') + (className ? ' ' + className : '')
  return (
    <img className={cls} style={style} src={src} alt={alt} draggable={false}
      loading={eager ? 'eager' : 'lazy'} decoding="async"
      fetchpriority={eager ? 'high' : undefined}
      onLoad={() => { SEEN.add(src); setReady(true) }}
      onError={() => {
        if (item.src) return
        const fb = picFallback(item.seed || item.id, w, h)
        if (fb !== src) setSrc(fb)
      }} />
  )
})

/* =========================================================================
   Daylight where the family is

   The map's colour follows the sun over the trip's own position rather than
   the viewer's clock, so someone following from home sees Amsterdam's dusk
   while it is still afternoon for them.

   No timezone lookup is needed for this: the sun's altitude is a function of
   the absolute instant and the coordinates alone. Standard low-precision
   solar position (NOAA / Astronomical Algorithms), good to a fraction of a
   degree — far tighter than anything a colour ramp can show.
   ========================================================================= */
const RAD = Math.PI / 180
const OBLIQUITY = RAD * 23.4397
const PERIHELION = RAD * 102.9372

// Sun altitude above the horizon, in degrees.
function sunAltitude(date, lat, lng) {
  const days = date.valueOf() / 86400000 - 0.5 + 2440588 - 2451545
  const M = RAD * (357.5291 + 0.98560028 * days)                       // mean anomaly
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const L = M + C + PERIHELION + Math.PI                               // ecliptic longitude
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L))             // declination
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L))
  const H = RAD * (280.16 + 360.9856235 * days) - RAD * -lng - ra      // hour angle
  const phi = RAD * lat
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
  return alt / RAD
}

/* Altitude -> the wash laid over the basemap. Interpolated between stops so
   the colour creeps rather than steps; the whole ramp is traversed twice a day. */
const TINT = [
  { alt:  50, c: [255, 246, 230], a: 0.06, name: 'daylight' },   // never quite bare
  { alt:  20, c: [255, 238, 214], a: 0.09, name: 'daylight' },
  { alt:   8, c: [255, 206, 146], a: 0.16, name: 'afternoon' },
  { alt:   2, c: [255, 168,  86], a: 0.26, name: 'golden hour' },
  { alt:  -2, c: [255, 138,  72], a: 0.30, name: 'sunset' },
  // Below here the basemap is dark, and a bright wash over near-black only
  // muddies it to brown — so the colours deepen and the alphas drop right off.
  { alt:  -5, c: [190,  96, 110], a: 0.13, name: 'dusk' },
  { alt: -10, c: [124,  84, 176], a: 0.12, name: 'twilight' },
  { alt: -16, c: [ 56,  78, 168], a: 0.11, name: 'blue hour' },
  { alt: -22, c: [ 22,  40,  90], a: 0.10, name: 'night' },
]
const mix = (a, b, t) => a + (b - a) * t
const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

function tintFor(alt) {
  if (alt >= TINT[0].alt) return { color: hex(TINT[0].c), alpha: TINT[0].a, phase: TINT[0].name }
  const last = TINT[TINT.length - 1]
  if (alt <= last.alt) return { color: hex(last.c), alpha: last.a, phase: last.name }
  for (let i = 1; i < TINT.length; i++) {
    const hi = TINT[i - 1], lo = TINT[i]
    if (alt <= hi.alt && alt > lo.alt) {
      const t = (hi.alt - alt) / (hi.alt - lo.alt)
      return {
        color: hex([0, 1, 2].map(k => mix(hi.c[k], lo.c[k], t))),
        alpha: Math.round(mix(hi.a, lo.a, t) * 1000) / 1000,
        phase: t < 0.5 ? hi.name : lo.name,
      }
    }
  }
  return { color: hex(last.c), alpha: last.a, phase: last.name }
}

// Above this the basemap is the warm daytime style. Slightly *below* the
// horizon rather than above it, for two reasons: the world stays bright for a
// while after the sun sets, and it keeps golden hour on the cream base where a
// warm wash glows instead of turning the dark base to mud.
const LIGHT_ABOVE = -2

function daylightAt(date, lngLat) {
  const alt = sunAltitude(date, lngLat[1], lngLat[0])
  return { alt, base: alt > LIGHT_ABOVE ? 'light' : 'dark', ...tintFor(alt) }
}

// The sun moves about a quarter of a degree a minute, so a minute is plenty.
function useDaylight(lngLat, everyMs = 60000) {
  const [at, setAt] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAt(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  const lng = lngLat ? lngLat[0] : 0, lat = lngLat ? lngLat[1] : 0
  return useMemo(() => daylightAt(new Date(at), [lng, lat]), [at, lng, lat])
}

/* =========================================================================
   Map

   A real GL map: vector tiles rendered on the GPU as geometry. Zoom is
   continuous rather than a scramble between discrete raster levels, and a pan
   is a camera move rather than several dozen <img> elements being re-laid-out
   and repainted. CARTO publish these styles openly — no key, no account.
   ========================================================================= */
const ACCENT = '#ff7a3d'
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

const STYLE = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  // Voyager rather than Positron for daytime: cream land (#fbf8f3) and muted
  // teal water instead of Positron's clinical grey-on-white, which read cold
  // and flat under a warm accent colour.
  light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
}

function metres(a, b) {
  const R = 6371000, r = d => d * Math.PI / 180
  const dLat = r(b[1] - a[1]), dLng = r(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
function routeKm(coords) {
  let d = 0
  for (let i = 1; i < coords.length; i++) {
    const m = metres(coords[i - 1], coords[i])
    if (m < 50000) d += m
  }
  return d / 1000
}

const lineOf = coords => ({
  type: 'Feature', properties: {},
  geometry: { type: 'LineString', coordinates: coords },
})

/* Markers stay as DOM so they keep their existing styling, content and click
   handlers; the map just positions them. The element itself is zero-sized and
   sits exactly on the coordinate, so the content inside offsets from there the
   way it always did — MapLibre owns the element's own transform and would
   overwrite anything we set on it. */
function MapMarker({ map, lng, lat, draggable = false, onDragEnd, children }) {
  const elRef = useRef(null)
  if (!elRef.current && typeof document !== 'undefined') {
    const d = document.createElement('div')
    d.style.width = '0'
    d.style.height = '0'
    elRef.current = d
  }
  const mk = useRef(null)
  const dragRef = useRef(onDragEnd); dragRef.current = onDragEnd

  useEffect(() => {
    if (!map || !elRef.current) return
    const m = new Marker({ element: elRef.current, anchor: 'center' })
      .setLngLat([lng, lat]).addTo(map)
    m.on('dragend', () => { const l = m.getLngLat(); dragRef.current?.([l.lng, l.lat]) })
    mk.current = m
    return () => { m.remove(); mk.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  useEffect(() => { mk.current?.setLngLat([lng, lat]) }, [lng, lat])
  useEffect(() => { mk.current?.setDraggable(!!draggable) }, [draggable])
  return elRef.current ? createPortal(children, elRef.current) : null
}

// The live fix jumps every few seconds; ease between them so the family marker
// walks rather than teleports.
function useGliding(target, ms = 800) {
  const [pt, setPt] = useState(target)
  const from = useRef(target)
  const raf = useRef(0)
  useEffect(() => {
    if (!target) return
    const a = from.current || target
    if (a[0] === target[0] && a[1] === target[1]) { from.current = target; return }
    const t0 = performance.now()
    const tick = () => {
      const t = clamp((performance.now() - t0) / ms, 0, 1)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const next = [a[0] + (target[0] - a[0]) * e, a[1] + (target[1] - a[1]) * e]
      from.current = next
      setPt(next)
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, ms])
  return pt || target
}

const MapCanvas = memo(function MapCanvas({
  view, onView, theme, tint, interactive = true, route = [], stops = [], photos = [], live = null,
  selectedStop, onStop, onPhoto, onLive, labels = false, highlight = null,
  editing = false, onMapClick, onStopMove, liveAvatar, children,
}) {
  const holder = useRef(null)
  const [map, setMap] = useState(null)
  const [moving, setMoving] = useState(false)     // any camera movement
  const [dragging, setDragging] = useState(false)  // the user's hand, specifically

  const oref = useRef(onView); oref.current = onView
  const routeRef = useRef(route); routeRef.current = route
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
    map.setStyle(STYLE[theme === 'light' ? 'light' : 'dark'])
  }, [map, theme])

  /* ---- keep the camera in step with the app -----------------------------
     Only moves when the app actually asks for somewhere else; the position we
     report back on moveend lands here again and must not start a second move. */
  useEffect(() => {
    if (!map) return
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

  const livePt = useGliding(live, 800)

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

      {map && livePt && (
        <MapMarker map={map} lng={livePt[0]} lat={livePt[1]}>
          <div className="mme" onClick={e => { e.stopPropagation(); if (!moved.current) onLive?.() }}
               title="The family is here">
            <span className="halo" />
            <img src={liveAvatar} alt="" draggable={false} />
            <span className="dot" />
          </div>
        </MapMarker>
      )}

      {children}
      <div className="attrib">© OpenStreetMap · CARTO</div>
    </div>
  )
})

/* =========================================================================
   Photo viewer — the Studio screen
   ========================================================================= */
function PhotoViewer({ list, index, setIndex, onClose, stops, byName, comments, addComment, likes, toggleLike, theme, tint, me }) {
  const photo = list[index]
  const stop = stops.find(s => s.id === photo?.stopId)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose()
      if (document.activeElement === inputRef.current) return
      if (e.key === 'ArrowLeft') setIndex((index - 1 + list.length) % list.length)
      if (e.key === 'ArrowRight') setIndex((index + 1) % list.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, list.length, onClose, setIndex])

  // Warm the neighbours so arrow-key paging is instant instead of a blank beat.
  useEffect(() => {
    if (list.length < 2) return
    for (const i of [(index + 1) % list.length, (index - 1 + list.length) % list.length]) {
      const p = list[i]; if (!p) continue
      const url = srcFor(p, 1200, 900)
      if (SEEN.has(url)) continue
      const im = new Image()
      im.decoding = 'async'
      im.onload = () => SEEN.add(url)
      im.src = url
    }
  }, [index, list])

  const mini = useMemo(() => ({ center: [photo?.lng ?? 0, photo?.lat ?? 0], zoom: 16 }), [photo?.lng, photo?.lat])
  const noop = useCallback(() => {}, [])

  if (!photo) return null
  const author = byName(photo.by)
  const here = list.filter(p => p.stopId === photo.stopId)
  const contributors = [...new Set(here.map(p => p.by))]
  const cmts = comments[photo.id] || []
  const liked = likes.has(photo.id)

  const submit = e => {
    e.preventDefault()
    const t = draft.trim(); if (!t) return
    addComment(photo.id, t); setDraft('')
  }

  return (
    <div className="viewer">
      <div className="vstage">
        <div className="vtop">
          <div className="who">
            <img src={author.avatar} alt="" />
            <div>
              <b>{photo.by}</b>
              <span>{photo.when}{stop ? ' · ' + stop.name : ''}</span>
            </div>
          </div>
          <div className="acts">
            <button className={liked ? 'liked' : ''} onClick={() => toggleLike(photo.id)} title="Like">
              <Icon n="heart" s={17} c={liked ? '#fff' : '#f2f4f8'} />
            </button>
            <button title="Download"><Icon n="download" s={17} c="#f2f4f8" /></button>
            <button onClick={onClose} title="Close (Esc)"><Icon n="x" s={17} c="#f2f4f8" w={2} /></button>
          </div>
        </div>

        <div className="vbody">
          {list.length > 1 && (
            <button className="vnav p" onClick={() => setIndex((index - 1 + list.length) % list.length)}>
              <Icon n="chevl" s={20} c="#fff" w={2} />
            </button>
          )}
          <Img className="main" item={photo} w={1200} h={900} alt={photo.caption} eager />
          {list.length > 1 && (
            <button className="vnav n" onClick={() => setIndex((index + 1) % list.length)}>
              <Icon n="chev" s={20} c="#fff" w={2} />
            </button>
          )}
        </div>

        <div className="vcap">
          <div>
            <h2>{photo.caption}</h2>
            <p className="loc">
              <Icon n="pin" s={14} c="rgba(255,255,255,.5)" />
              {stop ? stop.name + ' · ' : ''}{photo.lat.toFixed(4)} N, {photo.lng.toFixed(4)} E
            </p>
          </div>
          <div className="ct">{index + 1} of {list.length} · uploaded from the trip</div>
        </div>

        <div className="vfilm">
          {list.map((p, i) => (
            <button key={p.id} className={i === index ? 'on' : ''} onClick={() => setIndex(i)}>
              <Img item={p} w={300} h={200} />
            </button>
          ))}
        </div>
      </div>

      <div className="vside">
        <div className="vminimap">
          <MapCanvas theme={theme} tint={tint} interactive={false} view={mini} onView={noop}
            route={[]} stops={stop ? [stop] : []} photos={here} highlight={photo.id} live={null} />
          <div className="cap">
            <b>Taken here</b>
            <span>{stop ? stop.name : 'On the move'} · {here.length} photo{here.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {stop && (
          <div className="vinfo">
            <div className="k">
              {stop.status === 'now' ? 'Happening now' : stop.status === 'done' ? 'Visited' : 'Planned'} · {stop.time}
            </div>
            <h3>{stop.name}</h3>
            <p>{stop.note}</p>
          </div>
        )}

        <div className="vcontrib">
          <div className="st">{contributors.map(n => <img key={n} src={byName(n).avatar} alt="" />)}</div>
          <div className="t">
            <b>{contributors.join(', ')}</b>
            <span>contributed photos here</span>
          </div>
          <span className="n">{here.length}</span>
        </div>

        <div className="vcomments">
          {cmts.length === 0 && <div className="vnone">No notes yet. Be the first to say something.</div>}
          {cmts.map(c => (
            <div className="cmt" key={c.id}>
              <img src={byName(c.by).avatar} alt="" />
              <div className="t">
                <b>{c.by}</b><em>{c.when}</em>
                <p>{c.text}</p>
              </div>
            </div>
          ))}
        </div>

        <form className="vinput" onSubmit={submit}>
          <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
                 placeholder={`Say something nice, ${me.name}…`} />
          <button type="submit" disabled={!draft.trim()}><Icon n="send" s={16} c="#fff" /></button>
        </form>
      </div>
    </div>
  )
}

/* =========================================================================
   Modals
   ========================================================================= */
function Modal({ title, onClose, children }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="mh"><b>{title}</b><button onClick={onClose}><Icon n="x" s={17} w={2} /></button></div>
        {children}
      </div>
    </div>
  )
}

function UploadModal({ onClose, onAdd, live, stops, toast }) {
  const [file, setFile] = useState(null)
  const fileUrl = useRef(null)
  const [caption, setCaption] = useState('')
  const fileRef = useRef(null)
  const near = useMemo(() => {
    let best = null, bd = 400
    stops.forEach(s => { const d = metres([s.lng, s.lat], live); if (d < bd) { bd = d; best = s } })
    return best
  }, [live, stops])

  const pick = e => {
    const f = e.target.files?.[0]; if (!f) return
    if (fileUrl.current) URL.revokeObjectURL(fileUrl.current)
    fileUrl.current = URL.createObjectURL(f)
    setFile({ file: f, url: fileUrl.current })
  }
  const submit = () => {
    if (!file) return
    fileUrl.current = null            // ownership passes to the photo list
    onAdd({ src: file.url, caption: caption.trim() || 'Untitled', stopId: near?.id || null })
    toast(near ? `Photo added at ${near.name}` : 'Photo added at your current location')
    onClose()
  }
  useEffect(() => () => { if (fileUrl.current) URL.revokeObjectURL(fileUrl.current) }, [])

  return (
    <Modal title="Add a photo" onClose={onClose}>
      <div className="mb">
        {!file ? (
          <div className="drop" onClick={() => fileRef.current?.click()}>
            <Icon n="upload" s={26} c="var(--ink3)" />
            <b>Choose a photo from this device</b>
            <span>It will be pinned where you are right now</span>
          </div>
        ) : <img className="preview" src={file.url} alt="" />}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        <div className="field">
          <label>Caption</label>
          <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="What is happening here?" />
        </div>
        <p style={{ fontSize: 12.5 }}>
          <Icon n="pin" s={13} /> {live[1].toFixed(4)} N, {live[0].toFixed(4)} E
          {near ? ` — inside ${near.name}` : ' — no stop nearby, it will pin to the map'}
        </p>
        <div className="linkrow">
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn pri" style={{ flex: 1 }} disabled={!file} onClick={submit}>Add to the map</button>
        </div>
      </div>
    </Modal>
  )
}


/* =========================================================================
   Wide shell — ticker, hero card, filmstrip
   ========================================================================= */
// Owns its own second-by-second state. Hoisted into App it re-rendered the
// entire tree — map included — once a second just to retitle a pill.
const LivePill = memo(function LivePill({ resetKey }) {
  const [ago, setAgo] = useState(0)
  useEffect(() => { setAgo(0) }, [resetKey])
  useEffect(() => {
    const id = setInterval(() => setAgo(a => a + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const label = ago < 5 ? 'now' : ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`
  return <div className="tlive"><span className="d" />LIVE {label}</div>
})

const Ticker = memo(function Ticker({ trip, km, doneCount, stopCount, photoCount, nowStop, nextStop,
                                     liveKey, onPeople, tab, setTab, onUpload, theme, onToggleTheme,
                                     sunPhase, canEdit, editing, onToggleEdit, me, onSignOut }) {
  const Item = ({ children, hot }) => <><span className="dot">·</span><span className={hot ? 'hot' : ''}>{children}</span></>
  return (
    <header className="ticker">
      <div className="tlogo"><span className="mk"><Icon n="pin" s={13} c="#0a0c10" w={2.4} /></span>Wayfare</div>
      <div className="tflow">
<span className="crew">{(trip.crew || '').toUpperCase()}</span>
        <Item>{trip.title}</Item>
        {trip.dayCount ? <Item hot>DAY {trip.dayIndex || 1} OF {trip.dayCount}</Item> : null}
        <Item>{km.toFixed(1)} km walked</Item>
        <Item>{doneCount} of {stopCount} stops</Item>
        <Item>{photoCount} photos</Item>
        {nowStop && <Item hot>NOW AT {nowStop.name.toUpperCase()}</Item>}
        {nextStop && <Item>next: {nextStop.name}</Item>}
      </div>
      <div className="tright">
        <nav className="tnav">
          {[['map', 'map'], ['timeline', 'list'], ['photos', 'grid'], ['family', 'users']].map(([k, ic]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} title={k}>
              <Icon n={ic} s={15} />
            </button>
          ))}
        </nav>
        {canEdit && (
          <button className={'tbtn ghost' + (editing ? ' on' : '')} onClick={onToggleEdit}
                  title={editing ? 'Done editing' : 'Edit the itinerary'}>
            <Icon n={editing ? 'check' : 'edit'} s={15} />
          </button>
        )}
        <button className="tbtn ghost" onClick={onUpload} title="Add a photo"><Icon n="camera" s={15} /></button>
        <button className="tbtn ghost" onClick={onToggleTheme}
                title={sunPhase ? `Theme · the map is following ${sunPhase} where the family is`
                                : 'Theme'}>
          <Icon n={theme === 'dark' ? 'sun' : 'moon'} s={15} />
        </button>
        <LivePill resetKey={liveKey} />
        <button className="tbtn hot" onClick={onPeople}>
          <Icon n="users" s={14} c="#0a0c10" w={2.2} />People
        </button>
        {onSignOut && (
          <button className="tbtn ghost" onClick={onSignOut} title={`Signed in as ${me?.name || ''} — sign out`}>
            <Icon n="x" s={14} w={2} />
          </button>
        )}
      </div>
    </header>
  )
})

const HeroCard = memo(function HeroCard({ stop, photos, onClose, openViewer, toast }) {
  const here = photos.filter(p => p.stopId === stop.id)
  const label = stop.status === 'now' ? 'Happening now' : stop.status === 'done' ? 'Visited'
              : stop.status === 'next' ? 'Up next' : 'Planned'
  return (
    <div className="herocard">
      <Img className="hero" item={stop} w={800} h={400} eager />
      <button className="x" onClick={onClose}><Icon n="x" s={15} c="#fff" w={2} /></button>
      <div className="bd">
        <div className="ey"><span>{label}</span><em>{stop.day} · {stop.time}</em></div>
        <h2>{stop.name}</h2>
        <p>{stop.note}</p>
        {here.length > 0 && (
          <div className="thumbrow">
            {here.slice(0, 4).map((p, i) => (
              <button key={p.id} onClick={() => openViewer(here, i)}><Img item={p} w={200} h={160} /></button>
            ))}
            {here.length > 4 && (
              <button className="rest" onClick={() => openViewer(here, 4)}>+{here.length - 4}</button>
            )}
          </div>
        )}
        <div className="btns">
          <button className="wbtn hot" disabled={!here.length} onClick={() => openViewer(here, 0)}>
            <Icon n="camera" s={15} c="#0a0c10" w={2.2} />
            {here.length ? `See ${here.length} photo${here.length === 1 ? '' : 's'}` : 'No photos yet'}
          </button>
          <button className="wbtn" onClick={() => toast('Saved to favourites')}><Icon n="heart" s={16} /></button>
          <button className="wbtn" onClick={() => toast('Note sent to the family')}><Icon n="send" s={16} /></button>
        </div>
      </div>
    </div>
  )
})

const Filmstrip = memo(function Filmstrip({ stops, photos, byName, selected, onSelect, day, setDay, days, openViewer }) {
  return (
    <div className="filmstrip">
      <div className="fh">
        <div className="fdays">
          {days.map(d => (
            <button key={d} className={day === d ? 'on' : ''} onClick={() => setDay(d)}>{d.toUpperCase()}</button>
          ))}
        </div>
        <span className="hint">Click a card to fly there · a photo to open it</span>
      </div>
      <div className="frow">
        {stops.map((s, ci) => {
          const here = photos.filter(p => p.stopId === s.id)
          const cover = here[0] || s
          return (
            <div key={s.id} className={'fcard' + (selected === s.id ? ' on' : '') + (s.status === 'now' ? ' now' : '')}
                 onClick={() => onSelect(s.id)}>
              <div className="ph">
                <Img item={cover} w={420} h={220} eager={ci < 4} />
                {here.length > 0 && (
                  <button className="open" onClick={e => { e.stopPropagation(); openViewer(here, 0) }}
                          title={`Open ${here.length} photo${here.length === 1 ? '' : 's'}`}>
                    <Icon n="expand" s={14} c="#fff" w={2} />
                  </button>
                )}
                {here.length > 0 && <img className="av" src={byName(here[0].by).avatar} alt="" loading="lazy" decoding="async" />}
                {s.status === 'now' && <span className="nw">NOW</span>}
              </div>
              <div className="t">
                <b>{s.name}</b>
                <span>{s.day.startsWith('Sat') ? s.time : s.day + ' ' + s.time.split(' ')[0]}
                  {here.length ? ` · ${here.length} photo${here.length === 1 ? '' : 's'}` : ' · planned'}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})

/* =========================================================================
   Secondary views — slide over the map
   ========================================================================= */
function Pane({ title, sub, onClose, actions, children }) {
  return (
    <div className="pane">
      <div className="paneIn">
        <div className="paneHd">
          <div><h1>{title}</h1><p>{sub}</p></div>
          <div className="paneActs">{actions}
            <button className="wbtn" onClick={onClose}><Icon n="x" s={16} w={2} />Back to map</button></div>
        </div>
        {children}
      </div>
    </div>
  )
}

function TimelineView({ stops, photos, byName, openViewer, onSelect, onClose }) {
  const days = [...new Set(stops.map(s => s.day).filter(Boolean))]
  return (
    <Pane title="Timeline" sub="Every stop in order, with what everyone photographed along the way." onClose={onClose}>
      {days.map(d => (
        <div key={d}>
          <div className="tlday">{d}</div>
          <div className="tl">
            {stops.filter(s => s.day === d).map((s, i, arr) => {
              const here = photos.filter(p => p.stopId === s.id)
              return (
                <div key={s.id} className={'tlitem ' + s.status}>
                  <div className="tlax">
                    <div className="d">{s.status === 'done'
                      ? <Icon n="check" s={17} c="#fff" w={2.4} />
                      : <Icon n={s.icon} s={17} c={s.status === 'now' ? '#0a0c10' : 'currentColor'} />}</div>
                    {i < arr.length - 1 && <div className="ln" />}
                  </div>
                  <div className="tlbd">
                    <div className="hh">
                      <b>{s.name}</b><span>{s.time}</span>
                      {s.status === 'now' && <span className="chipnow">NOW</span>}
                      <button className="wbtn sm" onClick={() => onSelect(s.id)}>Show on map</button>
                    </div>
                    <p>{s.note}</p>
                    {here.length > 0 && (
                      <>
                        <div className="tlph">
                          {here.map((p, idx) => (
                            <button key={p.id} onClick={() => openViewer(here, idx)}><Img item={p} w={300} h={230} /></button>
                          ))}
                        </div>
                        <div className="tlwho">
                          {[...new Set(here.map(p => p.by))].map(n => <img key={n} src={byName(n).avatar} alt="" loading="lazy" decoding="async" />)}
                          {[...new Set(here.map(p => p.by))].join(', ')} · {here.length} photo{here.length === 1 ? '' : 's'}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </Pane>
  )
}

function PhotosView({ stops, photos, byName, openViewer, person, setPerson, onClose }) {
  const people = [...new Set(photos.map(p => p.by))]
  const list = person ? photos.filter(p => p.by === person) : photos
  const ordered = [...list].reverse()
  return (
    <Pane title="Photos" sub={`${list.length} photo${list.length === 1 ? '' : 's'} from the trip so far, newest first.`}
          onClose={onClose}>
      <div className="filters">
        <button className={!person ? 'on' : ''} onClick={() => setPerson(null)}>Everyone</button>
        {people.map(n => (
          <button key={n} className={person === n ? 'on' : ''} onClick={() => setPerson(n)}>
            <img src={byName(n).avatar} alt="" loading="lazy" decoding="async" />{n}
          </button>
        ))}
      </div>
      <div className="masonry">
        {ordered.map((p, i) => {
          const stop = stops.find(s => s.id === p.stopId)
          return (
            <button className="tile" key={p.id} onClick={() => openViewer(ordered, i)}>
              <Img item={p} w={520} h={400} eager={i < 6} />
              <img className="av" src={byName(p.by).avatar} alt="" loading="lazy" decoding="async" />
              <div className="ov"><b>{p.caption}</b><span>{stop ? stop.name + ' · ' : ''}{p.when}</span></div>
            </button>
          )
        })}
      </div>
    </Pane>
  )
}

function FamilyView({ family, photos, toast, onClose }) {
  return (
    <Pane title="Family" sub="Three of us on the road, three following from home." onClose={onClose}
          actions={<button className="wbtn hot" onClick={() => toast('Invite link copied')}>
            <Icon n="share" s={15} c="#0a0c10" w={2.2} />Invite someone</button>}>
      <div className="people">
        {family.map(f => {
          const n = photos.filter(p => p.by === f.name).length
          return (
            <div className="person" key={f.id}>
              <img src={f.avatar} alt="" loading="lazy" decoding="async" />
              <div><b>{f.name}</b><span>{f.role}</span></div>
              <div className="n">{f.role === 'Travelling' ? `${n} photo${n === 1 ? '' : 's'}` : 'Viewer'}</div>
            </div>
          )
        })}
      </div>
    </Pane>
  )
}

/* =========================================================================
   Signing in

   Magic link only: no passwords to store, reset or leak, and the people who
   own a trip sign in rarely enough that a link in the inbox is no hardship.
   ========================================================================= */
function useSession() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(!hasBackend)

  useEffect(() => {
    if (!hasBackend) return
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  return { session, ready }
}

function SignInScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async e => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true); setErr(null)
    try { await sendMagicLink(email); setSent(true) }
    catch (e2) { setErr(e2.message || 'Could not send the link') }
    finally { setBusy(false) }
  }

  return (
    <div className="boot">
      <div className="bootIn wide">
        <span className="mk"><Icon n="pin" s={15} c="#0a0c10" w={2.4} /></span>
        {sent ? (
          <>
            <b>Check your inbox</b>
            <p>We sent a link to <strong>{email}</strong>. Opening it on this device signs
               you in — and creates your account if this is your first time.</p>
            <button className="btn" onClick={() => setSent(false)}>Use a different address</button>
          </>
        ) : (
          <>
            <b>Sign in to Wayfare</b>
            <p>Use the address the trip was shared with. No password to remember — we
               email you a link.</p>
            <form className="linkrow" onSubmit={submit}>
              <input type="email" required autoFocus value={email} placeholder="you@example.com"
                     onChange={e => setEmail(e.target.value)} />
              <button className="btn pri" type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Email me a link'}
              </button>
            </form>
            {err && <p className="warn">{err}</p>}
          </>
        )}
      </div>
    </div>
  )
}

function NoTrip({ email }) {
  return (
    <div className="boot">
      <div className="bootIn wide">
        <span className="mk"><Icon n="pin" s={15} c="#0a0c10" w={2.4} /></span>
        <b>No trip yet</b>
        <p>You are signed in as <strong>{email}</strong>, but nobody has invited that
           address to a trip. Ask whoever is running it to add you — invitations go by
           email address, so it has to be this one.</p>
        <button className="btn" onClick={() => signOut().then(() => window.location.reload())}>
          Sign out
        </button>
      </div>
    </div>
  )
}

/* =========================================================================
   Who is on the trip
   ========================================================================= */
function PeopleModal({ onClose, toast, tripId, family, canEdit, appLink }) {
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('viewer')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!canEdit) return
    listInvites(tripId).then(setInvites).catch(() => {})
  }, [tripId, canEdit])

  const pending = invites.filter(i => !i.claimed_at)

  const add = async e => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    try {
      const row = await invitePerson(tripId, { email, name, role })
      setInvites(list => [...list.filter(i => i.id !== row.id), row])
      setEmail(''); setName('')
      toast(`Invited ${row.email}`)
    } catch (e2) {
      toast(e2.message || 'Could not send that invite')
    } finally { setBusy(false) }
  }

  const revoke = async id => {
    try {
      await revokeInvite(tripId, id)
      setInvites(list => list.filter(i => i.id !== id))
    } catch (e2) { toast(e2.message || 'Could not remove that invite') }
  }

  return (
    <Modal title="Who is on this trip" onClose={onClose}>
      <div className="mb">
        <div className="roster">
          {family.map(f => (
            <div className="rperson" key={f.id}>
              {f.avatar ? <img src={f.avatar} alt="" /> : <span className="ini">{(f.name || '?')[0]}</span>}
              <div><b>{f.name}</b><span>{f.role}</span></div>
              <em>{f.memberRole === 'owner' ? 'Owner' : f.memberRole === 'editor' ? 'Editor' : 'Viewer'}</em>
            </div>
          ))}
          {pending.map(i => (
            <div className="rperson pend" key={i.id}>
              <span className="ini">{(i.name || i.email || '?')[0]}</span>
              <div><b>{i.name || i.email}</b><span>Invited — not signed in yet</span></div>
              {canEdit && <button className="rm" onClick={() => revoke(i.id)} title="Cancel invite">
                <Icon n="x" s={13} w={2} /></button>}
            </div>
          ))}
        </div>

        {canEdit ? (
          <>
            <p>Everyone signs in, including people just following along. Invite them by the
               email address they will use — that is what grants access.</p>
            <form onSubmit={add} className="invite">
              <div className="linkrow">
                <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
                <select value={role} onChange={e => setRole(e.target.value)}>
                  <option value="viewer">Can view</option>
                  <option value="editor">Can edit</option>
                </select>
              </div>
              <div className="linkrow">
                <input type="email" required placeholder="them@example.com" value={email}
                       onChange={e => setEmail(e.target.value)} />
                <button className="btn pri" type="submit" disabled={busy || !email.trim()}>
                  {busy ? 'Inviting…' : 'Invite'}
                </button>
              </div>
            </form>
            <div className="linkrow">
              <input readOnly value={appLink} onFocus={e => e.target.select()} />
              <button className="btn" onClick={() => {
                navigator.clipboard?.writeText(appLink)
                  .then(() => toast('Link copied')).catch(() => toast('Copy failed'))
              }}><Icon n="copy" s={15} />Copy</button>
            </div>
            <p className="fine">The link is only where the trip lives — it grants nothing on
               its own. Access comes from the invitation.</p>
          </>
        ) : (
          <p>Only the people running this trip can invite others.</p>
        )}
      </div>
    </Modal>
  )
}

/* =========================================================================
   The stop editor
   ========================================================================= */
const STOP_ICONS = ['pin', 'plane', 'bed', 'boat', 'museum', 'food', 'walk', 'camera']
const STOP_STATES = [['planned', 'Planned'], ['next', 'Up next'], ['now', 'Now'], ['done', 'Visited']]

function StopEditor({ draft, days, onField, onSave, onDelete, onClose, busy }) {
  const isNew = !draft.id
  return (
    <div className="editor">
      <div className="eh">
        <b>{isNew ? 'New stop' : 'Edit stop'}</b>
        <button onClick={onClose} title="Close"><Icon n="x" s={15} w={2} /></button>
      </div>

      <div className="eb">
        <label className="f">
          <span>Name</span>
          <input value={draft.name || ''} autoFocus placeholder="Rijksmuseum"
                 onChange={e => onField('name', e.target.value)} />
        </label>

        <div className="frow">
          <label className="f">
            <span>Day</span>
            <input list="wf-days" value={draft.day || ''} placeholder="Sat 5 Sep"
                   onChange={e => onField('day', e.target.value)} />
            <datalist id="wf-days">{days.map(d => <option key={d} value={d} />)}</datalist>
          </label>
          <label className="f">
            <span>Time</span>
            <input value={draft.time || ''} placeholder="09:30 – 12:30"
                   onChange={e => onField('time', e.target.value)} />
          </label>
        </div>

        <div className="frow">
          <label className="f">
            <span>Kind</span>
            <input value={draft.kind || ''} placeholder="Sight"
                   onChange={e => onField('kind', e.target.value)} />
          </label>
          <label className="f">
            <span>Icon</span>
            <div className="icons">
              {STOP_ICONS.map(n => (
                <button key={n} type="button" title={n}
                        className={(draft.icon || 'pin') === n ? 'on' : ''}
                        onClick={() => onField('icon', n)}>
                  <Icon n={n} s={15} />
                </button>
              ))}
            </div>
          </label>
        </div>

        <label className="f">
          <span>Status</span>
          <div className="seg">
            {STOP_STATES.map(([v, label]) => (
              <button key={v} type="button" className={(draft.status || 'planned') === v ? 'on' : ''}
                      onClick={() => onField('status', v)}>{label}</button>
            ))}
          </div>
        </label>

        <label className="f">
          <span>Note</span>
          <textarea rows={3} value={draft.note || ''} placeholder="What happened here?"
                    onChange={e => onField('note', e.target.value)} />
        </label>

        <p className="coords">
          <Icon n="pin" s={13} />
          {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}
          <em>{isNew ? 'click the map to move it' : 'drag the pin to move it'}</em>
        </p>
      </div>

      <div className="ef">
        {!isNew && <button className="del" onClick={onDelete} disabled={busy}>Delete</button>}
        <button className="btn pri" onClick={onSave} disabled={busy || !(draft.name || '').trim()}>
          {busy ? 'Saving…' : isNew ? 'Add stop' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/* =========================================================================
   Root
   ========================================================================= */
function Boot({ error, onRetry }) {
  return (
    <div className="boot">
      <div className="bootIn">
        <span className="mk"><Icon n="pin" s={15} c="#0a0c10" w={2.4} /></span>
        {error ? (
          <>
            <b>That trip would not load</b>
            <p>{error.message || String(error)}</p>
            <button className="btn" onClick={onRetry}>Try again</button>
          </>
        ) : <p>Loading the trip…</p>}
      </div>
    </div>
  )
}

export default function App() {
  const { session, ready } = useSession()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!ready) return
    let alive = true
    setError(null)
    loadTrip(session)
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setError(e) })
    return () => { alive = false }
  }, [ready, session, attempt])

  if (error) return <Boot error={error} onRetry={() => setAttempt(a => a + 1)} />
  if (!data) return <Boot />
  if (data.needsAuth) return <SignInScreen />
  if (data.noTrip) return <NoTrip email={data.email} />
  // Remount cleanly if the signed-in identity changes which trip we are showing.
  return <TripApp key={data.tripId + ':' + (session?.user?.id || 'anon')} data={data} session={session} />
}

function TripApp({ data, session }) {
  const [theme, setTheme] = useState('dark')
  const [tab, setTab] = useState('map')
  const [stops, setStops] = useState(data.stops)
  const [photos, setPhotos] = useState(data.photos)
  const [comments, setComments] = useState(data.comments || {})
  const [likes, setLikes] = useState(() => new Set(data.likes || []))
  const [selected, setSelected] = useState(() => data.stops[0]?.id || null)
  const [viewer, setViewer] = useState(null)
  const [day, setDay] = useState(() => data.stops.find(s => s.status === 'now')?.day || data.stops[0]?.day || '')
  const [person, setPerson] = useState(null)
  const [share, setShare] = useState(false)
  const [upload, setUpload] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)
  const [following, setFollowing] = useState(true)
  const [step, setStep] = useState(0)

  // --- editing ---
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)

  const { trip, family, route, tripId, canEdit } = data
  const me = data.me || family[0] || { name: 'You', avatar: '' }
  const byName = useCallback(
    n => family.find(f => f.name === n) || family[0] || { name: n, avatar: '' }, [family])

  const [view, setView] = useState(() => ({
    center: data.stops.length
      ? [data.stops.reduce((a, s) => a + s.lng, 0) / data.stops.length,
         data.stops.reduce((a, s) => a + s.lat, 0) / data.stops.length]
      : [4.8760, 52.3670],
    zoom: 13.9,
  }))
  const viewRef = useRef(view); viewRef.current = view

  const [mapOverride, setMapOverride] = useState(null)
  useEffect(() => { document.body.dataset.theme = theme }, [theme])

  const toastT = useRef(0)
  const toast = useCallback(m => {
    setToastMsg(m)
    window.clearTimeout(toastT.current)
    toastT.current = window.setTimeout(() => setToastMsg(null), 2600)
  }, [])
  useEffect(() => () => window.clearTimeout(toastT.current), [])

  const track = useMemo(() => route.concat(AHEAD.slice(0, step)), [route, step])
  const live = track[track.length - 1] || [4.876, 52.367]
  const sun = useDaylight(live)
  const mapTheme = mapOverride || sun.base
  const km = useMemo(() => routeKm(track), [track])

  useEffect(() => {
    const id = setInterval(() => setStep(s => (s + 1) % (AHEAD.length + 1)), 7000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (following) setView(v => ({ center: live, zoom: v.zoom, ms: 900 }))
  }, [live, following])

  const days = useMemo(() => [...new Set(stops.map(s => s.day).filter(Boolean))], [stops])
  const dayStops = useMemo(() => stops.filter(s => s.day === day), [stops, day])
  const selectedStop = stops.find(s => s.id === selected)
  const nowStop = stops.find(s => s.status === 'now')
  const nextStop = stops.find(s => s.status === 'next')
  const doneCount = stops.filter(s => s.status === 'done').length

  const openViewer = useCallback((list, index) => setViewer({ list, index: clamp(index, 0, list.length - 1) }), [])
  const closeViewer = useCallback(() => setViewer(null), [])
  const setIndex = useCallback(i => setViewer(v => v && ({ ...v, index: i })), [])

  // Optimistic, then reconciled with what the database actually stored — and
  // rolled back if it refused, so the UI never claims a comment that is not there.
  const addComment = useCallback(async (photoId, text) => {
    const temp = { id: 'tmp' + Date.now(), by: me.name, text, when: 'just now', pending: true }
    setComments(c => ({ ...c, [photoId]: [...(c[photoId] || []), temp] }))
    try {
      const saved = await saveComment(tripId, photoId, text, session)
      setComments(c => ({
        ...c,
        [photoId]: (c[photoId] || []).map(x => (x.id === temp.id ? { ...temp, ...saved, pending: false } : x)),
      }))
    } catch (e) {
      setComments(c => ({ ...c, [photoId]: (c[photoId] || []).filter(x => x.id !== temp.id) }))
      toast(e.message || 'Could not post that')
    }
  }, [tripId, session, me.name, toast])

  const toggleLike = useCallback(async id => {
    const on = !likes.has(id)
    setLikes(s => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n })
    try {
      await setLike(tripId, id, on, session)
    } catch (e) {
      setLikes(s => { const n = new Set(s); on ? n.delete(id) : n.add(id); return n })
      toast(e.message || 'Could not save that')
    }
  }, [likes, tripId, session, toast])

  const addPhoto = useCallback(({ src, caption, stopId }) => {
    setPhotos(list => [...list, {
      id: 'up' + Date.now(), stopId, lng: live[0], lat: live[1], by: me.name,
      when: 'Just now', caption, src, seed: 'up',
    }])
    if (stopId) setSelected(stopId)
  }, [live, me.name])

  const handleView = useCallback((next, opts) => {
    if (opts?.user) setFollowing(false)
    setView(next)
  }, [])

  const selectStop = useCallback(id => {
    setSelected(id); setTab('map'); setFollowing(false)
    const s = stops.find(x => x.id === id)
    if (s) {
      setView({ center: [s.lng, s.lat], zoom: Math.max(viewRef.current.zoom, 15), ms: 520 })
      if (s.day !== day) setDay(s.day)
    }
  }, [stops, day])

  // In edit mode a pin opens the editor rather than the hero card.
  const pickStop = useCallback(id => {
    setSelected(id)
    if (editing) setDraft(stops.find(s => s.id === id) || null)
  }, [editing, stops])

  const closeHero = useCallback(() => setSelected(null), [])

  const fitAll = useCallback(() => {
    setFollowing(false)
    if (!stops.length) return
    const lngs = stops.map(s => s.lng), lats = stops.map(s => s.lat)
    setView({
      center: [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2],
      zoom: 13.1, ms: 620,
    })
  }, [stops])

  const zoomBy = useCallback(d => {
    setFollowing(false)
    setView(v => ({ center: v.center, zoom: clamp(v.zoom + d, 3, 18), ms: 300 }))
  }, [])

  const toggleFollow = useCallback(() => {
    const next = !following
    setFollowing(next)
    if (next) setView({ center: live, zoom: Math.max(viewRef.current.zoom, 15), ms: 560 })
  }, [following, live])

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setMapOverride(next)
  }, [theme])

  /* ---- editing ----------------------------------------------------------- */
  const startEditing = useCallback(() => {
    setEditing(e => !e)
    setDraft(null)
  }, [])

  // Clicking bare map while editing drops a new stop there.
  const onMapClick = useCallback(lngLat => {
    setDraft(d => (d && !d.id)
      ? { ...d, lng: lngLat[0], lat: lngLat[1] }            // reposition the pending one
      : { name: '', icon: 'pin', status: 'planned', day: day || '',
          lng: lngLat[0], lat: lngLat[1] })
    setSelected(null)
  }, [day])

  // Dragging a pin writes straight through; there is nothing to confirm.
  const onStopMove = useCallback(async (id, lngLat) => {
    setStops(list => list.map(s => (s.id === id ? { ...s, lng: lngLat[0], lat: lngLat[1] } : s)))
    setDraft(d => (d && d.id === id ? { ...d, lng: lngLat[0], lat: lngLat[1] } : d))
    try {
      await updateStop(tripId, id, { lng: lngLat[0], lat: lngLat[1] })
    } catch (e) {
      toast(e.message || 'Could not move that stop')
    }
  }, [tripId, toast])

  const onDraftField = useCallback((k, v) => setDraft(d => ({ ...d, [k]: v })), [])

  const saveDraft = useCallback(async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      if (draft.id) {
        const saved = await updateStop(tripId, draft.id, {
          name: draft.name, kind: draft.kind, icon: draft.icon, day: draft.day,
          time: draft.time, status: draft.status, note: draft.note,
          lng: draft.lng, lat: draft.lat,
        })
        setStops(list => list.map(s => (s.id === draft.id ? { ...s, ...saved } : s)))
        toast('Stop saved')
      } else {
        const saved = await createStop(tripId, { ...draft, seq: stops.length })
        setStops(list => [...list, saved])
        setSelected(saved.id)
        toast('Stop added')
      }
      setDraft(null)
    } catch (e) {
      toast(e.message || 'Could not save that stop')
    } finally {
      setSaving(false)
    }
  }, [draft, saving, tripId, stops.length, toast])

  const removeDraft = useCallback(async () => {
    if (!draft?.id || saving) return
    setSaving(true)
    try {
      await deleteStop(tripId, draft.id)
      setStops(list => list.filter(s => s.id !== draft.id))
      setPhotos(list => list.map(p => (p.stopId === draft.id ? { ...p, stopId: null } : p)))
      if (selected === draft.id) setSelected(null)
      setDraft(null)
      toast('Stop deleted')
    } catch (e) {
      toast(e.message || 'Could not delete that stop')
    } finally {
      setSaving(false)
    }
  }, [draft, saving, tripId, selected, toast])

  const onPeople = useCallback(() => setShare(true), [])
  const onUpload = useCallback(() => setUpload(true), [])
  const backToMap = useCallback(() => setTab('map'), [])
  const onLive = useCallback(() => selectStop(nowStop?.id || stops[0]?.id), [selectStop, nowStop, stops])

  return (
    <div className="app wide">
      <Ticker trip={trip} km={km} doneCount={doneCount} stopCount={stops.length}
        photoCount={photos.length} nowStop={nowStop} nextStop={nextStop}
        liveKey={step} onPeople={onPeople} tab={tab} setTab={setTab}
        onUpload={onUpload} theme={theme} onToggleTheme={toggleTheme}
        sunPhase={mapOverride ? null : sun.phase}
        canEdit={canEdit} editing={editing} onToggleEdit={startEditing}
        me={me} onSignOut={hasBackend ? () => signOut().then(() => window.location.reload()) : null} />

      <div className="stagewrap">
        <MapCanvas theme={mapTheme} tint={sun} view={view} onView={handleView}
          route={track} stops={stops} photos={photos} live={live} selectedStop={selected}
          labels={view.zoom > 13} onStop={pickStop}
          onPhoto={openViewer} onLive={onLive} liveAvatar={family[0]?.avatar}
          editing={editing} onMapClick={onMapClick} onStopMove={onStopMove} />

        {editing && draft && (
          <StopEditor draft={draft} days={days} onField={onDraftField}
                      onSave={saveDraft} onDelete={removeDraft}
                      onClose={() => setDraft(null)} busy={saving} />
        )}

        {editing && !draft && (
          <div className="edithint">
            <b>Edit mode</b>
            <span>Click the map to add a stop, or a pin to change one. Drag pins to move them.</span>
          </div>
        )}

        {!editing && selectedStop && (
          <HeroCard stop={selectedStop} photos={photos} onClose={closeHero}
                    openViewer={openViewer} toast={toast} />
        )}

        <div className="wctl">
          <button className="wc" onClick={() => zoomBy(1)} title="Zoom in"><Icon n="plus" s={17} w={2} /></button>
          <button className="wc" onClick={() => zoomBy(-1)} title="Zoom out"><Icon n="minus" s={17} w={2} /></button>
          <button className="wc" onClick={fitAll} title="Fit the whole trip"><Icon n="expand" s={16} /></button>
          <button className={'wc' + (following ? ' on' : '')} title="Follow the family" onClick={toggleFollow}>
            <Icon n="loc" s={17} c={following ? '#0a0c10' : 'currentColor'} w={2} />
          </button>
        </div>

        {tab === 'timeline' && <TimelineView stops={stops} photos={photos} byName={byName}
                                             openViewer={openViewer} onSelect={selectStop} onClose={backToMap} />}
        {tab === 'photos' && <PhotosView stops={stops} photos={photos} byName={byName} openViewer={openViewer}
                                         person={person} setPerson={setPerson} onClose={backToMap} />}
        {tab === 'family' && <FamilyView family={family} photos={photos} toast={toast} onClose={backToMap} />}
      </div>

      <Filmstrip stops={dayStops} photos={photos} byName={byName} selected={selected} onSelect={selectStop}
                 day={day} setDay={setDay} days={days} openViewer={openViewer} />

      {viewer && (
        <PhotoViewer list={viewer.list} index={viewer.index} setIndex={setIndex}
          onClose={closeViewer} stops={stops} byName={byName} comments={comments} addComment={addComment}
          likes={likes} toggleLike={toggleLike} theme={mapTheme} tint={sun} me={me} />
      )}
      {share && <PeopleModal onClose={() => setShare(false)} toast={toast} tripId={tripId}
                             family={family} canEdit={canEdit}
                             appLink={window.location.origin + window.location.pathname
                                      + (trip.slug ? `?t=${trip.slug}` : '')} />}
      {upload && <UploadModal onClose={() => setUpload(false)} onAdd={addPhoto} live={live} stops={stops} toast={toast} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  )
}
