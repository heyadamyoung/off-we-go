import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { Map as MapGL, Marker, setWorkerUrl } from 'maplibre-gl'   // v6 is named-exports only
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

// v6 ships its tile-parsing worker as a separate module and resolves it against
// import.meta.url, which no longer points anywhere useful once bundled. Without
// this the map builds, loads its style and then silently never requests a tile.
setWorkerUrl(maplibreWorkerUrl)
import { pic, picFallback } from './data'
import { findSights, describePlace, radiusForView, imageForPage, enrichStops,
         cellsCovering, attractionsInCell, attractionThumb, isHeadline,
         articleSummary } from './places'
import {
  hasBackend, authClient, completeBrowserLogin, loadTrip, createStop, updateStop, deleteStop,
  addComment as saveComment, setLike, listInvites, invitePerson, revokeInvite,
  uploadPhoto, updatePhoto, deletePhoto, replaceRoute, createTrip, updateTrip,
  updateMe, uploadAvatar, deleteComment, subscribeToTrip,
  sendMagicLink, signOut, deleteAccount, loadAttractions,
  loadLive, subscribeToPositions, listDevices, registerDevice, removeDevice,
  functionsUrl,
} from './backend'
import { isNativeApp, initializeNativeServices, mobileTracker, pickNativePhotos } from './mobile'
import { mergeLiveFixes } from './livePositionsCore'

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
  star:'M12 3.2l2.6 5.6 6 .8-4.4 4.3 1.1 6.1-5.3-3-5.3 3 1.1-6.1L3.4 9.6l6-.8z',
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
const TRAIL = '#3ecf8e'    // where the phones actually went, as distinct from the route drawn by hand
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

/* Ground covered on foot from the phones' fixes: each phone's trail in turn,
   keeping only the steps that were clearly a step (GPS drifts a few metres
   standing still) and clearly not a vehicle. The longest of the phones'
   totals, since two phones in one pocket walked the same distance once. */
function trailKm(fixes) {
  const by = new Map()
  for (const f of fixes) {
    if (f.accuracy != null && f.accuracy > 80) continue
    if (!by.has(f.deviceId)) by.set(f.deviceId, [])
    by.get(f.deviceId).push(f)
  }
  let best = 0
  for (const list of by.values()) {
    let d = 0
    for (let i = 1; i < list.length; i++) {
      const m = metres([list[i - 1].lng, list[i - 1].lat], [list[i].lng, list[i].lat])
      const dt = (list[i].at - list[i - 1].at) / 1000
      if (m < 12 || dt <= 0) continue
      if (m / dt > 40 / 3.6) continue      // faster than 40 km/h is a bus, a train or a plane
      d += m
    }
    best = Math.max(best, d)
  }
  return best / 1000
}

function agoLabel(d) {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
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

const linesOf = lines => ({
  type: 'FeatureCollection',
  features: lines.map(c => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c } })),
})

// One phone on the map — or, with no phone reporting, the family's best-known
// position. Eased between fixes so it walks rather than teleports.
function LiveMarker({ map, lng, lat, avatar, name, title, onClick, movedRef }) {
  const target = useMemo(() => [lng, lat], [lng, lat])
  const pt = useGliding(target, 800)
  return (
    <MapMarker map={map} lng={pt[0]} lat={pt[1]}>
      <div className="mme" title={title}
           onClick={e => { e.stopPropagation(); if (!movedRef.current) onClick?.() }}>
        <span className="halo" />
        {avatar ? <img src={avatar} alt="" draggable={false} />
                : <span className="ini">{(name || '?')[0]}</span>}
        <span className="dot" />
      </div>
    </MapMarker>
  )
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] }

/* Which attraction cells the screen is touching, and everything ever fetched.

   Cells are asked for one at a time and abandoned the moment the view moves
   again, so a long pan does not queue up a hundred requests for country you
   have already left. Anything fetched stays: the layer only ever grows. */
const boxFor = view => {
  const scale = 360 / (256 * Math.pow(2, view.zoom))
  const lngSpan = window.innerWidth * scale
  const latSpan = window.innerHeight * scale * Math.cos((view.center[1] * Math.PI) / 180)
  return {
    west: view.center[0] - lngSpan / 2, east: view.center[0] + lngSpan / 2,
    south: view.center[1] - latSpan / 2, north: view.center[1] + latSpan / 2,
  }
}

const featureFor = poi => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [poi.x, poi.y] },
  properties: {
    id: poi.id, n: poi.n, d: poi.d, k: poi.k,
    f: poi.f || '', big: isHeadline(poi.k),
  },
})

/* Where the attractions come from.

   Seeded, they are one indexed bounding-box query: everything on screen, in a
   single round trip, the same for everyone who opens the app. Nobody's phone
   pays to rediscover Edinburgh Castle.

   Unseeded — no database configured, or the table still empty — the map falls
   back to asking Wikipedia directly, ten kilometres at a time, and keeps what
   it finds in that browser. It works, but every visitor pays for it again, and
   only for the ground they personally wandered over. That fallback is what
   this was before there was anywhere to put the answers. */
function useAttractions(view, enabled) {
  const seen = useRef(new Map())
  const [data, setData] = useState(EMPTY_FC)
  const [filling, setFilling] = useState(0)
  /* Two ways this can go wrong, and they want different answers. A database
     that errors is out for the session. A database that simply holds nothing
     for the region you have panned to is fine — it has not been filled that
     far — so the live walk covers that view, and the next region that is in
     the table still comes back in one query. */
  const [dbUp, setDbUp] = useState(hasBackend)
  const [dbBlankHere, setDbBlankHere] = useState(false)
  const dirty = useRef(false)

  const handOn = useRef(false)
  useEffect(() => {
    const down = () => { handOn.current = true }
    const up = () => { handOn.current = false }
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', up, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  /* ---- seeded: one query per view ------------------------------------- */
  useEffect(() => {
    if (!enabled || !dbUp || view.zoom < 5) return
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const rows = await loadAttractions(boxFor(view), { headlineOnly: view.zoom < 10.5 })
        if (!alive || !rows) return
        setDbBlankHere(rows.length === 0)
        if (rows.length) setData({ type: 'FeatureCollection', features: rows.map(featureFor) })
      } catch {
        if (alive) setDbUp(false)            // fall back rather than show nothing
      }
    }, 260)
    return () => { alive = false; clearTimeout(timer) }
  }, [view, enabled, dbUp])

  /* ---- unseeded: walk Wikipedia in ten-kilometre cells ----------------- */
  useEffect(() => {
    if (!enabled || (dbUp && !dbBlankHere)) return
    const publish = setInterval(() => {
      if (!dirty.current) return
      dirty.current = false
      setData({
        type: 'FeatureCollection',
        features: [...seen.current.values()].map(featureFor),
      })
    }, 700)
    return () => clearInterval(publish)
  }, [enabled, dbUp, dbBlankHere])

  useEffect(() => {
    if (!enabled || (dbUp && !dbBlankHere) || view.zoom < 7.4) { setFilling(0); return }
    let alive = true

    const timer = setTimeout(async () => {
      const cells = cellsCovering(boxFor(view), { limit: 150, centre: view.center })
      let left = cells.length
      setFilling(left)
      // Two at a time: enough to blanket a country in a minute, few enough that
      // Wikipedia does not start refusing us. Cells already in the browser come
      // back without a request at all, so this is instant the second time.
      for (let i = 0; i < cells.length; i += 2) {
        if (!alive) return
        while (handOn.current && alive) await new Promise(r => setTimeout(r, 140))
        if (!alive) return
        const batch = cells.slice(i, i + 2)
        const got = await Promise.all(batch.map(c => attractionsInCell(c).catch(() => null)))
        if (!alive) return
        left -= batch.length
        setFilling(left)
        for (const poi of got.filter(Boolean).flat()) {
          if (!seen.current.has(poi.id)) { seen.current.set(poi.id, poi); dirty.current = true }
        }
      }
      setFilling(0)
    }, 320)

    return () => { alive = false; clearTimeout(timer) }
  }, [view, enabled, dbUp, dbBlankHere])

  return { data, filling, count: data.features.length }
}

const MapCanvas = memo(function MapCanvas({
  view, onView, theme, tint, interactive = true, route = [], stops = [], photos = [],
  markers = [], trail = [],
  selectedStop, onStop, onPhoto, onLive, labels = false, highlight = null,
  editing = false, onMapClick, onStopMove, places = [], onPickPlace,
  attractions = null, onPickAttraction, children,
}) {
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

/* =========================================================================
   Photo viewer — the Studio screen
   ========================================================================= */
function PhotoViewer({ list, index, setIndex, onClose, stops, byName, comments, addComment, likes,
                       toggleLike, theme, tint, me, canEdit, onPhotoChange, onPhotoDelete,
                       onCommentDelete }) {
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
              {stop ? stop.name : ''}
              {photo.lat != null && photo.lng != null
                ? `${stop ? ' · ' : ''}${photo.lat.toFixed(4)} N, ${photo.lng.toFixed(4)} E` : ''}
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
            route={[]} stops={stop ? [stop] : []} photos={here} highlight={photo.id} />
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

        {canEdit && (
          <div className="vedit">
            <input value={photo.caption || ''} placeholder="Caption"
                   onChange={e => onPhotoChange(photo.id, { caption: e.target.value })} />
            <div className="row">
              <select value={photo.stopId || ''}
                      onChange={e => onPhotoChange(photo.id, { stopId: e.target.value || null })}>
                <option value="">Not at a stop</option>
                {stops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="del" title="Delete photo"
                      onClick={() => onPhotoDelete(photo.id)}><Icon n="x" s={14} w={2} /></button>
            </div>
          </div>
        )}

        <div className="vcomments">
          {cmts.length === 0 && <div className="vnone">No notes yet. Be the first to say something.</div>}
          {cmts.map(c => (
            <div className={'cmt' + (c.pending ? ' pending' : '')} key={c.id}>
              <img src={byName(c.by).avatar} alt="" />
              <div className="t">
                <b>{c.by}</b><em>{c.when}</em>
                <p>{c.text}</p>
              </div>
              {(canEdit || c.by === me.name) && !c.pending && (
                <button className="cdel" title="Delete"
                        onClick={() => onCommentDelete(photo.id, c.id)}><Icon n="x" s={12} w={2} /></button>
              )}
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
  const [files, setFiles] = useState([])
  const fileUrls = useRef([])
  const [caption, setCaption] = useState('')
  const fileRef = useRef(null)
  const near = useMemo(() => {
    let best = null, bd = 400
    stops.forEach(s => { const d = metres([s.lng, s.lat], live); if (d < bd) { bd = d; best = s } })
    return best
  }, [live, stops])

  const setPicked = selected => {
    fileUrls.current.forEach(URL.revokeObjectURL)
    fileUrls.current = selected.map(URL.createObjectURL)
    setFiles(selected.map((file, i) => ({ file, url: fileUrls.current[i] })))
  }
  const pick = e => {
    const selected = [...(e.target.files || [])]
    if (selected.length) setPicked(selected)
  }
  const choose = async () => {
    try {
      const selected = await pickNativePhotos()
      if (selected) { if (selected.length) setPicked(selected); return }
      fileRef.current?.click()
    } catch (e) {
      if (!/cancel/i.test(e?.message || '')) toast(e.message || 'Could not open Photos')
    }
  }
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!files.length || busy) return
    setBusy(true)
    try {
      for (let i = 0; i < files.length; i++) {
        const meta = files[i].file.wayfareMetadata
        const exifPoint = meta?.lat != null && meta?.lng != null ? [meta.lng, meta.lat] : null
        // A captured-at timestamp with no EXIF position is deliberately sent
        // without today's live position: the VPS can then match it to the
        // uploader's historical GPS trail at the moment the picture was taken.
        const point = exifPoint || (!meta?.takenAt ? live : null)
        let photoStop = null, best = 400
        if (point) stops.forEach(stop => {
          const distance = metres([stop.lng, stop.lat], point)
          if (distance < best) { best = distance; photoStop = stop }
        })
        await onAdd({
          file: files[i].file, caption: caption.trim() || 'Untitled',
          stopId: photoStop?.id || null, lng: point?.[0], lat: point?.[1],
          locationSource: exifPoint ? 'exif' : point ? 'live' : undefined,
          when: meta?.takenAt || new Date().toISOString(), order: i,
        })
      }
      const what = `${files.length} photo${files.length === 1 ? '' : 's'} added`
      toast(`${what} to the map`)
      onClose()
    } catch (e) {
      toast(e.message || 'Could not upload that photo')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => () => fileUrls.current.forEach(URL.revokeObjectURL), [])

  return (
    <Modal title="Add a photo" onClose={onClose}>
      <div className="mb">
        {!files.length ? (
          <div className="drop" onClick={choose}>
            <Icon n="upload" s={26} c="var(--ink3)" />
            <b>{isNativeApp ? 'Choose photos from Apple Photos' : 'Choose photos from this device'}</b>
            <span>Select up to 20; they will be pinned where you are right now</span>
          </div>
        ) : <>
          <div className="previews">{files.map((file, i) => <img key={file.url} className="preview" src={file.url} alt={`Selected ${i + 1}`} />)}</div>
          <button className="btn choosephotos" onClick={choose}>Choose different photos</button>
        </>}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pick} />
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
          <button className="btn pri" style={{ flex: 1 }} disabled={!files.length || busy} onClick={submit}>
            {busy ? `Uploading ${files.length}…` : `Add ${files.length || ''} to the map`}
          </button>
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
  /* Capped at 99 minutes and rendered in a fixed-width slot. The label goes
     "now" then "5s" then "12m", and each is a different width, so every tick
     nudged the People button sideways. */
  const mins = Math.min(99, Math.floor(ago / 60))
  const label = ago < 5 ? 'now' : ago < 60 ? `${ago}s` : `${mins}m`
  return <div className="tlive"><span className="d" />LIVE<span className="n">{label}</span></div>
})

const Ticker = memo(function Ticker({ trip, km, doneCount, stopCount, photoCount, nowStop, nextStop,
                                     liveKey, onPeople, tab, setTab, onUpload, theme, onToggleTheme,
                                     sunPhase, canEdit, editing, onToggleEdit, me, onSignOut,
                                     attractionsOn, onToggleAttractions }) {
  const Item = ({ children, hot }) => <><span className="dot">·</span><span className={hot ? 'hot' : ''}>{children}</span></>
  return (
    <header className="ticker">
      <div className="tlogo"><span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        <span className="wm">Wayfare</span></div>
      <div className="tflow">
<span className="crew">{(trip.crew || '').toUpperCase()}</span>
        <Item>{trip.title}</Item>
        {trip.dates ? <Item hot>{trip.dates}</Item> : null}
        <Item>{km.toFixed(1)} km walked</Item>
        <Item>{doneCount} of {stopCount} stops</Item>
        <Item>{photoCount} photos</Item>
        {nowStop && <Item hot>NOW AT {(nowStop.name || '').toUpperCase()}</Item>}
        {nextStop && <Item>next: {nextStop.name}</Item>}
      </div>
      <div className="tright">
        <nav className="tnav">
          {[['map', 'map'], ['timeline', 'list'], ['photos', 'grid'],
            ['sights', 'star'], ['family', 'users']].map(([k, ic]) => (
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
        <button className={'tbtn ghost pref attr' + (attractionsOn ? ' on' : '')} onClick={onToggleAttractions}
                title={attractionsOn ? 'Hide attractions on the map' : 'Show attractions on the map'}>
          <Icon n="pin" s={15} />
        </button>
        <button className="tbtn ghost" onClick={onUpload} title="Add a photo"><Icon n="camera" s={15} /></button>
        <button className="tbtn ghost pref theme" onClick={onToggleTheme}
                title={sunPhase ? `Theme · the map is following ${sunPhase} where the family is`
                                : 'Theme'}>
          <Icon n={theme === 'dark' ? 'sun' : 'moon'} s={15} />
        </button>
        <LivePill resetKey={liveKey} />
        <button className="tbtn hot people" onClick={onPeople} title="People">
          <Icon n="users" s={14} c="#0a0c10" w={2.2} /><span className="lbl">People</span>
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
        <div className="ey"><span>{label}</span>
          <em>{[stop.day, stop.time].filter(Boolean).join(' · ')}</em></div>
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
          <a className="wbtn" title="Open in Google Maps" target="_blank" rel="noopener noreferrer"
             href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}>
            <Icon n="map" s={16} />
          </a>
          <button className="wbtn" onClick={() => toast('Saved to favourites')}><Icon n="heart" s={16} /></button>
          <button className="wbtn" onClick={() => toast('Note sent to the family')}><Icon n="send" s={16} /></button>
        </div>
      </div>
    </div>
  )
})

// A sentinel for the day filter. A plain string, not a control character:
// a literal NUL in the source makes grep and diff treat the file as binary.
const ALL_DAYS = 'all-days'

const ICON_FOR_KIND = {
  castle: 'museum', museum: 'museum', worship: 'pin', outdoors: 'walk',
  history: 'pin', culture: 'museum', food: 'food', fun: 'boat',
}

const Filmstrip = memo(function Filmstrip({ stops, photos, byName, selected, onSelect, day, setDay,
                                            days, openViewer, query, setQuery }) {
  return (
    <div className="filmstrip">
      <div className="fh">
        <div className="fdays">
          <button className={day === ALL_DAYS ? 'on' : ''} onClick={() => setDay(ALL_DAYS)}>ALL DAYS</button>
          {days.map(d => (
            <button key={d} className={day === d ? 'on' : ''} onClick={() => setDay(d)}>{d.toUpperCase()}</button>
          ))}
        </div>
        <label className="fsearch">
          <Icon n="search" s={14} c="var(--ink3)" />
          <input value={query} placeholder="Search stops and captions"
                 onChange={e => setQuery(e.target.value)} />
          {query && <button onClick={() => setQuery('')} title="Clear"><Icon n="x" s={13} w={2} /></button>}
        </label>
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
                {/* A stop added from the map may have no day or time yet, and the
                    old hardcoded "Sat" special case crashed on the first one. */}
                <span>{[s.day, s.time].filter(Boolean).join(' · ') || 'No time set'}
                  {here.length ? ` · ${here.length} photo${here.length === 1 ? '' : 's'}` : ''}</span>
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

/* =========================================================================
   Sights nearby

   A plain list of what is around, with a picture, a name and a description —
   browsable without entering edit mode, because deciding where to go and
   editing an itinerary are different jobs.
   ========================================================================= */
/* The card a pin on the map opens into. The name, the sort of thing it is and
   a picture are already in hand from the layer, so it appears at once and the
   fuller description arrives after. */
function AttractionCard({ poi, canEdit, inTrip, onAdd, onClose }) {
  const [more, setMore] = useState(null)
  const [adding, setAdding] = useState(false)

  /* A seeded pin already carries its paragraph, so the card is complete the
     moment it opens. Only a pin the seeder never reached goes and asks. */
  useEffect(() => {
    if (poi.t) { setMore(null); return }
    let alive = true
    setMore(null)
    articleSummary(poi.id).then(m => { if (alive) setMore(m) }).catch(() => {})
    return () => { alive = false }
  }, [poi.id, poi.t])

  const picture = more?.image || attractionThumb(poi.f)
  const note = poi.t || more?.note || ''
  // A page id resolves to its article on its own, so the link costs no request.
  const source = more?.source || `https://en.wikipedia.org/?curid=${poi.id}`

  return (
    <div className="acard">
      <button className="ax" onClick={onClose} title="Close"><Icon n="x" s={15} w={2} /></button>
      {picture && <div className="apic"><img src={picture} alt="" decoding="async" /></div>}
      <div className="abody">
        <b>{poi.n}</b>
        <span className="kind">{poi.d}</span>
        <p>{note}</p>
        <div className="aacts">
          {canEdit && (
            <button className="wbtn sm hot" disabled={inTrip || adding}
              onClick={async () => { setAdding(true); await onAdd({ ...poi, image: picture, source, note }); setAdding(false) }}>
              {inTrip ? 'In your trip' : adding ? 'Adding…' : 'Add to trip'}
            </button>
          )}
          <a className="wbtn sm" href={source} target="_blank" rel="noopener noreferrer">Wikipedia</a>
        </div>
      </div>
    </div>
  )
}

function SightsView({ centre, stops, canEdit, onAdd, onShow, onClose, toast }) {
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [added, setAdded] = useState(() => new Set())

  const load = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const found = await findSights({
        lng: centre.center[0], lat: centre.center[1],
        radius: Math.max(1200, radiusForView(centre.zoom, centre.center[1], window.innerWidth)),
        limit: 40,
      })
      setItems(found)
    } catch (e) {
      setError(e.message || 'Could not reach Wikipedia')
    } finally { setBusy(false) }
  }, [centre])

  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  /* A handful of articles lead with a logo rather than a photograph — the Van
     Gogh Museum is one — and the picture filter correctly rejects it, leaving a
     blank card. Go looking inside those articles afterwards, so the list is not
     held up waiting for the exceptions. */
  useEffect(() => {
    if (!items) return
    const blank = items.filter(p => !p.image && p.pageTitle).slice(0, 12)
    if (!blank.length) return
    let alive = true
    ;(async () => {
      for (const place of blank) {
        const url = await imageForPage(place.pageTitle).catch(() => null)
        if (!alive) return
        if (url) setItems(list => list.map(p => (p.id === place.id ? { ...p, image: url } : p)))
      }
    })()
    return () => { alive = false }
  }, [items])

  const already = new Set(stops.map(s => (s.name || '').toLowerCase()))
  const list = items || []

  return (
    <Pane
      title="Sights nearby"
      sub="Around the middle of the map, most visited first — not merely the nearest."
      onClose={onClose}
      actions={<button className="wbtn" onClick={load} disabled={busy}>
        <Icon n="search" s={15} />{busy ? 'Searching…' : 'Search this area'}
      </button>}>

      {error && <p className="swarn">{error}</p>}
      {!items && busy && <p className="snote">Looking for sights around here…</p>}
      {items && !list.length && !busy && (
        <p className="snote">Nothing found here. Move the map somewhere else and search again.</p>
      )}

      <div className="sights">
        {list.map(pl => {
          const have = already.has(pl.name.toLowerCase()) || added.has(pl.id)
          return (
            <article className="sight" key={pl.id}>
              <div className="spic">
                {pl.image
                  ? <img src={pl.image} alt="" loading="lazy" decoding="async" />
                  : <span className="none"><Icon n={pl.icon} s={22} c="var(--ink3)" /></span>}
                {pl.metres != null && <em>{pl.metres < 1000
                  ? pl.metres + ' m' : (pl.metres / 1000).toFixed(1) + ' km'}</em>}
              </div>
              <div className="sbody">
                {/* The name carries the attribution the licence asks for; a
                    separate "Wikipedia" link only crowded the buttons out. */}
                {pl.source
                  ? <a className="sname" href={pl.source} target="_blank" rel="noopener noreferrer"
                       title="Read about it on Wikipedia">{pl.name}</a>
                  : <b className="sname">{pl.name}</b>}
                {pl.kind && <span className="kind">{pl.kind}</span>}
                <p>{pl.note}</p>
                <div className="sacts">
                  <button className="wbtn sm" onClick={() => onShow(pl)}>Show on map</button>
                  {canEdit && (
                    <button className="wbtn sm hot" disabled={have}
                            onClick={async () => {
                              await onAdd(pl)
                              setAdded(a => new Set(a).add(pl.id))
                            }}>
                      {have ? 'In your trip' : 'Add to trip'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </Pane>
  )
}

function FamilyView({ family, photos, onClose, onInvite }) {
  const travelling = family.filter(f => f.role === 'Travelling').length
  const following = family.length - travelling
  const words = n => ['none', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n)
  const sub = following
    ? `${words(travelling)} on the road, ${words(following)} following from home.`
    : `${words(travelling)} on the road.`
  return (
    <Pane title="Family" sub={sub[0].toUpperCase() + sub.slice(1)} onClose={onClose}
          actions={<button className="wbtn hot" onClick={onInvite}>
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
    initializeNativeServices(authClient).then(() => completeBrowserLogin()).then(() => authClient.restore()).then(() => {
      if (!alive) return
      setSession(authClient.getSession())
      setReady(true)
    }).catch(() => { if (alive) setReady(true) })
    const unsubscribe = authClient.subscribe(setSession)
    return () => { alive = false; unsubscribe() }
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
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
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

/* Dates.

   The form used to ask for a line of text and, separately, a number of days.
   Nothing checked that "4 – 16 September" and 7 agreed, nothing explained what
   either was for, and the text was never shown anywhere at all. Now it asks
   for two dates and works out both from them. */
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June',
               'July', 'August', 'September', 'October', 'November', 'December']

// Parsed at midday: a date-only string read as UTC lands on the previous day
// for anyone west of Greenwich, which is a whole class of off-by-one bug.
const onDay = iso => (iso ? new Date(iso + 'T12:00:00') : null)

function formatRange(startsOn, endsOn) {
  const a = onDay(startsOn), b = onDay(endsOn)
  if (!a && !b) return ''
  if (a && !b) return `from ${a.getDate()} ${MONTH[a.getMonth()]}`
  if (!a && b) return `until ${b.getDate()} ${MONTH[b.getMonth()]}`
  const sameYear = a.getFullYear() === b.getFullYear()
  if (sameYear && a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${b.getDate()} ${MONTH[b.getMonth()]}`
  }
  if (sameYear) {
    return `${a.getDate()} ${MONTH[a.getMonth()]} – ${b.getDate()} ${MONTH[b.getMonth()]}`
  }
  return `${a.getDate()} ${MONTH[a.getMonth()]} ${a.getFullYear()}` +
         ` – ${b.getDate()} ${MONTH[b.getMonth()]} ${b.getFullYear()}`
}

// Inclusive: leaving on the 4th and coming home on the 16th is thirteen days.
function daysBetween(startsOn, endsOn) {
  const a = onDay(startsOn), b = onDay(endsOn)
  if (!a || !b) return null
  const days = Math.round((b - a) / 86400000) + 1
  return days > 0 ? days : null
}

/* A face, or the next best thing.

   Everybody starts without a picture, and an <img> with an empty src is drawn
   by every browser as a broken image — so the photo grid was full of them. An
   SVG data URI rather than a styled <span>, because every place a face appears
   already has CSS aimed at an img, and this way none of it has to change. */
function initialAvatar(name) {
  const label = (name || '?').trim() || '?'
  const initial = label.charAt(0).toUpperCase()
  const hue = [...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="hsl(${hue} 38% 34%)"/>` +
    `<text x="32" y="43" text-anchor="middle" fill="#fff" font-weight="700"` +
    ` font-size="30" font-family="system-ui,-apple-system,sans-serif">${initial}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

const withFace = person =>
  (person && person.avatar ? person : { ...person, avatar: initialAvatar(person && person.name) })

function NoTrip({ email, onCreated }) {
  const [making, setMaking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [f, setF] = useState({ title: '', crew: '', startsOn: '', endsOn: '' })
  const span = daysBetween(f.startsOn, f.endsOn)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  const create = async e => {
    e.preventDefault()
    if (!f.title.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      await createTrip({
        title: f.title, crew: f.crew,
        startsOn: f.startsOn || null, endsOn: f.endsOn || null,
        dates: formatRange(f.startsOn, f.endsOn),
        dayCount: span || 1,
      })
      onCreated()
    }
    catch (e2) { setErr(e2.message || 'Could not create that trip'); setBusy(false) }
  }
  const removeAccount = async () => {
    if (window.prompt('Permanently delete this Wayfare account? Type DELETE to continue.') !== 'DELETE') return
    try { await deleteAccount(); window.location.reload() }
    catch (error) { setErr(error.message || 'Could not delete your account') }
  }

  return (
    <div className="boot">
      <div className="bootIn wide">
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
        {making ? (
          <>
            <b>Start a trip</b>
            <p>You will be its owner, and can invite everyone else once it exists.</p>
            <form className="newtrip" onSubmit={create}>
              <label>Where are you going?
                <input autoFocus required placeholder="Amsterdam Weekend" value={f.title}
                       onChange={e => set('title', e.target.value)} />
              </label>
              <label>Who is going?
                <input placeholder="Sample Family" value={f.crew}
                       onChange={e => set('crew', e.target.value)} />
              </label>
              <div className="linkrow">
                <label>Leaving
                  <input type="date" value={f.startsOn} onChange={e => set('startsOn', e.target.value)} />
                </label>
                <label>Coming home
                  <input type="date" value={f.endsOn} min={f.startsOn || undefined}
                         onChange={e => set('endsOn', e.target.value)} />
                </label>
              </div>
              {span && <p className="span">{formatRange(f.startsOn, f.endsOn)}</p>}
              <div className="linkrow">
                <button type="button" className="btn" style={{ flex: 1 }}
                        onClick={() => setMaking(false)}>Back</button>
                <button type="submit" className="btn pri" style={{ flex: 1 }}
                        disabled={busy || !f.title.trim()}>{busy ? 'Creating…' : 'Create trip'}</button>
              </div>
            </form>
            {err && <p className="warn">{err}</p>}
          </>
        ) : (
          <>
            <b>No trip yet</b>
            <p>You are signed in as <strong>{email}</strong>, but nobody has invited that
               address to a trip. Invitations go by email address, so it has to be this one —
               ask whoever is running it to add you. Or start your own.</p>
            <div className="linkrow">
              <button className="btn" onClick={() => signOut().then(() => window.location.reload())}>
                Sign out
              </button>
              <button className="btn pri" onClick={() => setMaking(true)}>Start a trip</button>
            </div>
            <button className="btn danger" onClick={removeAccount}>Delete my account</button>
            {err && <p className="warn">{err}</p>}
          </>
        )}
      </div>
    </div>
  )
}

/* =========================================================================
   Who is on the trip
   ========================================================================= */
function TripSettings({ trip, onSave }) {
  const [f, setF] = useState({ title: trip.title || '', crew: trip.crew || '',
                               startsOn: trip.startsOn || '', endsOn: trip.endsOn || '' })
  const [dirty, setDirty] = useState(false)
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setDirty(true) }
  return (
    <div className="tset">
      <div className="linkrow">
        <input value={f.title} placeholder="Trip name" onChange={e => set('title', e.target.value)} />
        <input value={f.crew} placeholder="Crew" onChange={e => set('crew', e.target.value)} />
      </div>
      <div className="linkrow">
        <label>Leaving
          <input type="date" value={f.startsOn} onChange={e => set('startsOn', e.target.value)} />
        </label>
        <label>Coming home
          <input type="date" value={f.endsOn} min={f.startsOn || undefined}
                 onChange={e => set('endsOn', e.target.value)} />
        </label>
        <button className="btn" disabled={!dirty}
                onClick={() => {
                  onSave({ ...f, dates: formatRange(f.startsOn, f.endsOn),
                           dayCount: daysBetween(f.startsOn, f.endsOn) || 1 })
                  setDirty(false)
                }}>
          Save
        </button>
      </div>
    </div>
  )
}

function MyProfile({ me, onSave }) {
  const [name, setName] = useState(me.name || '')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  const preview = file ? URL.createObjectURL(file) : me.avatar

  const save = async () => {
    setBusy(true)
    try { await onSave({ name: name.trim() || me.name, file }) ; setFile(null) }
    finally { setBusy(false) }
  }
  const changed = name.trim() !== (me.name || '') || !!file

  return (
    <div className="mine">
      <button className="av" onClick={() => ref.current?.click()} title="Change your picture">
        {preview ? <img src={preview} alt="" /> : <span className="ini">{(name || '?')[0]}</span>}
        <em><Icon n="camera" s={12} /></em>
      </button>
      <input ref={ref} type="file" accept="image/*" hidden
             onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
      <input value={name} placeholder="Your name" onChange={e => setName(e.target.value)} />
      <button className="btn" disabled={!changed || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  )
}

/* =========================================================================
   Phones — live position and automatic photos

   A phone is registered here and gets a token, shown once. The native iPhone
   app stores that device-scoped token and posts Core Location fixes itself;
   the web app keeps the external tracker/uploader instructions for Android.
   ========================================================================= */
function Phones({ tripId, family, canEdit, me, toast, phones, onChange }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [card, setCard] = useState(null)        // the token, on screen exactly once
  const [tracking, setTracking] = useState(() => mobileTracker.getState())
  const suggested = `${me?.name || 'My'}'s phone`

  useEffect(() => mobileTracker.subscribe(setTracking), [])

  const enableTracking = async phone => {
    try {
      await mobileTracker.configure({
        endpoint: `${functionsUrl}/track`, token: phone.token,
        deviceId: phone.id, name: phone.name,
      })
      toast('Location sharing is on')
    } catch (e) {
      toast(e.message || 'Allow Always location access to start sharing')
      throw e
    }
  }

  const add = async e => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const made = await registerDevice(tripId, name.trim() || suggested)
      setCard(made); setName('')
      onChange?.(await listDevices(tripId))
      if (isNativeApp) await enableTracking(made).catch(() => {})
    } catch (e2) { toast(e2.message || 'Could not add that phone') }
    finally { setBusy(false) }
  }

  const remove = async id => {
    try {
      await removeDevice(tripId, id)
      if (tracking.deviceId === id) await mobileTracker.forget()
      onChange?.(phones.filter(p => p.id !== id))
      if (card?.id === id) setCard(null)
    } catch (e2) { toast(e2.message || 'Could not remove that phone') }
  }

  if (!hasBackend) return <p>Phones report to the database, and this is the sample trip.</p>

  return (
    <>
      {isNativeApp && (
        <div className={`tracking ${tracking.status}`}>
          <span className="trackdot" />
          <div><b>{tracking.status === 'tracking' ? 'Location sharing is on'
                  : tracking.status === 'waiting' ? 'Waiting to send location'
                  : tracking.status === 'starting' ? 'Starting location sharing…'
                  : tracking.configured ? 'Location sharing is off' : 'Set up this iPhone below'}</b>
            <span>{tracking.error || (tracking.queued ? `${tracking.queued} fix${tracking.queued === 1 ? '' : 'es'} queued for retry`
              : 'Wayfare sends a fix after you move about 10 metres, including while the screen is locked.')}</span></div>
          {tracking.configured && ['tracking', 'waiting', 'starting'].includes(tracking.status)
            ? <button className="btn" disabled={tracking.status === 'starting'} onClick={() => mobileTracker.stop()}>Pause</button>
            : tracking.configured && <button className="btn" onClick={() => mobileTracker.stop().then(() => mobileTracker.start()).catch(e => toast(e.message))}>Resume</button>}
        </div>
      )}
      {phones.length ? (
        <div className="roster">
          {phones.map(p => {
            const who = family.find(f => f.id === p.userId)
            return (
              <div className="rperson" key={p.id}>
                {who?.avatar ? <img src={who.avatar} alt="" /> : <span className="ini">{(p.name || '?')[0]}</span>}
                <div><b>{p.name}</b>
                  <span>{p.lastSeen ? `Last fix ${agoLabel(p.lastSeen)}` : 'No fixes yet'}{who ? ` · ${who.name}` : ''}</span></div>
                {canEdit && <button className="rm" onClick={() => remove(p.id)} title="Remove this phone">
                  <Icon n="x" s={13} w={2} /></button>}
              </div>
            )
          })}
        </div>
      ) : (
        <p>No phones yet.{canEdit ? ' Add one and it reports where it is and hands over every picture it takes, with nobody opening the app.' : ''}</p>
      )}

      {canEdit && (
        <>
          <form onSubmit={add} className="linkrow">
            <input placeholder={suggested} value={name} onChange={e => setName(e.target.value)} />
            <button className="btn pri" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add a phone'}</button>
          </form>
        </>
      )}

      {card && <SetupCard card={card} tripId={tripId} onClose={() => setCard(null)} toast={toast}
                          tracking={tracking} onEnableTracking={enableTracking} />}
    </>
  )
}

function SetupCard({ card, tripId, onClose, toast, tracking, onEnableTracking }) {
  const copy = (label, v) => navigator.clipboard?.writeText(v)
    .then(() => toast(`${label} copied`)).catch(() => toast('Copy failed'))
  const trackUrl = `${functionsUrl}/track`
  const Row = ({ k, v }) => (
    <div className="kv">
      <span>{k}</span>
      <code onClick={() => copy(k, v)} title="Click to copy">{v}</code>
      <button className="btn sq" title={`Copy ${k}`} onClick={() => copy(k, v)}><Icon n="copy" s={14} /></button>
    </div>
  )
  return (
    <div className="setup">
      <b>{card.name} — set-up card</b>
      <p>The token below is shown once and never again. If it is lost, remove the phone and add it back.</p>

      {isNativeApp ? <>
        <em>Location sharing</em>
        <p className="fine">Wayfare tracks this iPhone itself. Choose <b>Allow While Using App</b>, then
          approve <b>Always Allow</b> when iOS asks so fixes continue while the screen is locked. A blue
          location indicator may appear while tracking.</p>
        <button className="btn pri" disabled={tracking?.status === 'starting'}
                onClick={() => onEnableTracking(card).catch(() => {})}>
          {tracking?.deviceId === card.id && tracking.status === 'tracking' ? 'Tracking is on' : 'Enable location sharing'}
        </button>
        <em>Photos</em>
        <p className="fine">Take pictures normally in Apple Camera. In Wayfare, press the camera button,
          choose <b>Apple Photos</b>, select up to 20 pictures, and upload them together. iPhone converts
          HEIC selections to browser-ready JPEG automatically.</p>
      </> : <>

      <em>1 · Where it is — Traccar Client (free, Play Store)</em>
      <Row k="Device identifier" v={card.token} />
      <Row k="Server URL" v={trackUrl} />
      <p className="fine">Frequency 30 s, accuracy high, then start the service. Let it ignore battery
         optimisation when Android asks. OwnTracks or GPSLogger work too: post to
         <code>{trackUrl}?id=</code>token.</p>

      <em>2 · Its pictures</em>
      <p className="fine">Open Wayfare on the phone and use the camera button to select pictures.
         Wayfare uploads private, web-sized copies directly to your VPS; the originals stay in the
         phone's photo library and iCloud.</p>
      </>}

      <button className="btn" onClick={onClose}>Done</button>
    </div>
  )
}

function PeopleModal({ onClose, toast, tripId, family, canEdit, appLink, trip, onSaveTrip, me, onSaveMe,
                       phones = [], onPhonesChange }) {
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('viewer')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!canEdit) return
    listInvites(tripId).then(setInvites).catch(() => {})
  }, [tripId, canEdit])

  const pending = invites.filter(i => !i.claimedAt && !i.claimed_at)

  const add = async e => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    try {
      const row = await invitePerson(tripId, { email, name, role })
      setInvites(list => [...list.filter(i => i.id !== row.id), row])
      setEmail(''); setName('')
      // The invitation stands either way; say plainly which happened, because
      // "Invited" over a mail that never went is how somebody ends up waiting.
      toast(row.mailed
        ? `Invited ${row.email} — sign-in link sent`
        : `${row.email} can join, but the email did not send: ${row.mailError || 'unknown error'}`)
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

  const removeMyAccount = async () => {
    const confirmation = window.prompt('This permanently deletes your account, your uploads, and any trip you solely own. Type DELETE to continue.')
    if (confirmation !== 'DELETE') return
    try { await deleteAccount(); window.location.reload() }
    catch (error) { toast(error.message || 'Could not delete your account') }
  }

  return (
    <Modal title="Who is on this trip" onClose={onClose}>
      <div className="mb">
        <div className="sect">You</div>
        <MyProfile me={me} onSave={onSaveMe} />

        {canEdit && trip && (
          <>
            <div className="sect">Trip</div>
            <TripSettings trip={trip} onSave={onSaveTrip} />
          </>
        )}

        <div className="sect">Phones</div>
        <Phones tripId={tripId} family={family} canEdit={canEdit} me={me} toast={toast}
                phones={phones} onChange={onPhonesChange} />

        <div className="sect">Everyone</div>
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

        {hasBackend && <>
          <div className="sect">Account</div>
          <p className="fine">Deleting your account removes your profile, comments, likes, phones,
            GPS history, and uploaded photos. A trip disappears too if you are its only owner.</p>
          <button className="btn danger" onClick={removeMyAccount}>Delete my account</button>
        </>}
      </div>
    </Modal>
  )
}

/* =========================================================================
   The stop editor
   ========================================================================= */
const STOP_ICONS = ['pin', 'plane', 'bed', 'boat', 'museum', 'food', 'walk', 'camera']
const STOP_STATES = [['planned', 'Planned'], ['next', 'Up next'], ['now', 'Now'], ['done', 'Visited']]

function StopEditor({ draft, days, onField, onSave, onDelete, onMove, onLookUp, onClose, busy }) {
  const isNew = !draft.id
  return (
    <div className="editor">
      <div className="eh">
        <b>{isNew ? 'New stop' : 'Edit stop'}</b>
        <button onClick={onClose} title="Close"><Icon n="x" s={15} w={2} /></button>
      </div>

      {draft.src && (
        <div className="epic">
          <img src={draft.src} alt="" />
          <button title="Remove this picture" onClick={() => { onField('src', null); onField('sourceUrl', null) }}>
            <Icon n="x" s={13} w={2} />
          </button>
          {draft.sourceUrl && (
            <a href={draft.sourceUrl} target="_blank" rel="noopener noreferrer">Wikipedia</a>
          )}
        </div>
      )}

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

        <button className="lookup" onClick={onLookUp} disabled={busy}>
          <Icon n="search" s={14} />
          Fill in from Wikipedia
        </button>
      </div>

      <div className="ef">
        {!isNew && (
          <>
            <button className="ord" onClick={() => onMove(-1)} disabled={busy} title="Move earlier">
              <Icon n="chevl" s={14} w={2} />
            </button>
            <button className="ord" onClick={() => onMove(1)} disabled={busy} title="Move later">
              <Icon n="chev" s={14} w={2} />
            </button>
            <button className="del" onClick={onDelete} disabled={busy}>Delete</button>
          </>
        )}
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
        <span className="mk brand"><img src="/wayfare-icon.png" alt="" /></span>
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
  const reload = useCallback(() => setAttempt(a => a + 1), [])

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
  if (data.noTrip) return <NoTrip email={data.email} onCreated={reload} />
  // Remount cleanly if the signed-in identity changes which trip we are showing.
  return <TripApp key={data.tripId + ':' + (session?.user?.id || 'anon')}
                  data={data} session={session} onReload={reload} />
}

function TripApp({ data, session, onReload }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('wf-theme') || 'dark' } catch { return 'dark' }
  })
  const [tab, setTab] = useState('map')
  const [stops, setStops] = useState(data.stops)
  const [photos, setPhotos] = useState(data.photos)
  const [comments, setComments] = useState(data.comments || {})
  const [likes, setLikes] = useState(() => new Set(data.likes || []))
  const [selected, setSelected] = useState(() => data.stops[0]?.id || null)
  const [viewer, setViewer] = useState(null)
  const [day, setDay] = useState(() => data.stops.find(s => s.status === 'now')?.day || data.stops[0]?.day || '')
  const [query, setQuery] = useState('')
  const [person, setPerson] = useState(null)
  const [share, setShare] = useState(false)
  const [upload, setUpload] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)
  const [following, setFollowing] = useState(true)

  // --- editing ---
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [routeDraft, setRouteDraft] = useState(null)   // non-null while editing the line
  const [places, setPlaces] = useState([])             // candidates from a place search
  const [attraction, setAttraction] = useState(null)   // the pin whose card is open
  const [showAttractions, setShowAttractions] = useState(() => {
    try { return localStorage.getItem('wf-attractions') !== 'off' } catch { return true }
  })
  const [finding, setFinding] = useState(false)

  const { tripId, canEdit } = data
  const [trip, setTrip] = useState(data.trip)
  const [route, setRoute] = useState(data.route)
  const [family, setFamily] = useState(() => (data.family || []).map(withFace))
  const [me, setMe] = useState(data.me || data.family[0] || { name: 'You', avatar: '' })
  /* No falling back to the first person on the trip: a photograph credited to
     somebody who is not a member belongs to them, not to whoever happens to be
     listed first. They get their initial instead. */
  const byName = useCallback(
    n => withFace(family.find(f => f.name === n) || { name: n }), [family])

  const [view, setView] = useState(() => ({
    center: data.stops.length
      ? [data.stops.reduce((a, s) => a + s.lng, 0) / data.stops.length,
         data.stops.reduce((a, s) => a + s.lat, 0) / data.stops.length]
      : [4.8760, 52.3670],
    zoom: 13.9,
  }))
  const viewRef = useRef(view); viewRef.current = view

  const [mapOverride, setMapOverride] = useState(null)
  useEffect(() => {
    document.body.dataset.theme = theme
    try { localStorage.setItem('wf-theme', theme) } catch { /* private mode */ }
  }, [theme])

  // A reload (realtime, or the retry button) hands down new data; adopt it.
  useEffect(() => {
    setTrip(data.trip); setRoute(data.route); setFamily((data.family || []).map(withFace))
    setStops(data.stops); setPhotos(data.photos)
    setComments(data.comments || {}); setLikes(new Set(data.likes || []))
    if (data.me) setMe(data.me)
  }, [data])

  const toastT = useRef(0)
  const toast = useCallback(m => {
    setToastMsg(m)
    window.clearTimeout(toastT.current)
    toastT.current = window.setTimeout(() => setToastMsg(null), 2600)
  }, [])
  useEffect(() => () => window.clearTimeout(toastT.current), [])

  /* Where the phones are. Fixes arrive on their own channel and move only the
     markers; nothing else is refetched for them. */
  const [phones, setPhones] = useState([])
  const [fixes, setFixes] = useState([])
  useEffect(() => {
    let alive = true, stop = () => {}
    loadLive(tripId)
      .then(r => {
        if (!alive) return
        setPhones(r.devices)
        setFixes(r.fixes)
        stop = subscribeToPositions(tripId, fix => setFixes(list => mergeLiveFixes(list, [fix])), r.cursor)
      })
      .catch(() => {})
    return () => { alive = false; stop() }
  }, [tripId])

  const latestByPhone = useMemo(() => {
    const m = new Map()
    for (const f of fixes) { const cur = m.get(f.deviceId); if (!cur || f.at > cur.at) m.set(f.deviceId, f) }
    return m
  }, [fixes])
  const latestFix = useMemo(() => {
    let best = null
    for (const f of latestByPhone.values()) if (!best || f.at > best.at) best = f
    return best
  }, [latestByPhone])

  /* Where the family is. The most recent fix from any phone; with none, the
     end of the walked route if one has been drawn; failing that, the stop
     marked "now", then the next one up, then the first. Nothing is simulated:
     a marker that strolled a demo route on its own timer was fine for a sample
     and a lie about a real trip. */
  const track = route
  const live = useMemo(() => {
    if (latestFix) return [latestFix.lng, latestFix.lat]
    if (track.length) return track[track.length - 1]
    const s = stops.find(x => x.status === 'now') || stops.find(x => x.status === 'next') || stops[0]
    return s ? [s.lng, s.lat] : [4.876, 52.367]
  }, [latestFix, track, stops])
  const sun = useDaylight(live)
  const mapTheme = mapOverride || sun.base

  // Kilometres from the phones when they have reported today, else the drawn route.
  const km = useMemo(() => trailKm(fixes) || routeKm(track), [fixes, track])

  // One marker per phone heard from in the last day; none reporting, one for the family.
  const markers = useMemo(() => {
    const fresh = [...latestByPhone.values()].filter(f => Date.now() - f.at.getTime() < 24 * 3600_000)
    if (!fresh.length) {
      return [{ key: 'family', lng: live[0], lat: live[1], avatar: family[0]?.avatar || null,
                name: family[0]?.name, title: 'The family is here' }]
    }
    return fresh.map(f => {
      const phone = phones.find(p => p.id === f.deviceId)
      const who = phone && family.find(p => p.id === phone.userId)
      const name = who?.name || phone?.name || 'Phone'
      return { key: f.deviceId, lng: f.lng, lat: f.lat, avatar: who?.avatar || null, name,
               title: `${name} · ${agoLabel(f.at)}` }
    })
  }, [latestByPhone, phones, family, live])

  // Each phone's path over the last day, poor fixes left out so the line does not spike.
  const trail = useMemo(() => {
    const by = new Map()
    for (const f of fixes) {
      if (f.accuracy != null && f.accuracy > 80) continue
      if (!by.has(f.deviceId)) by.set(f.deviceId, [])
      by.get(f.deviceId).push([f.lng, f.lat])
    }
    return [...by.values()].filter(l => l.length > 1)
  }, [fixes])

  // Live updates. Held off while someone is mid-edit, since refetching under an
  // open editor would pull the ground out from under them.
  const busyEditing = useRef(false)
  busyEditing.current = editing || !!draft || !!routeDraft
  useEffect(() => {
    if (!onReload) return
    let timer = 0
    const stop = subscribeToTrip(tripId, () => {
      clearTimeout(timer)
      timer = setTimeout(() => { if (!busyEditing.current) onReload() }, 400)
    })
    return () => { clearTimeout(timer); stop() }
  }, [tripId, onReload])

  useEffect(() => {
    if (following) setView(v => ({ center: live, zoom: v.zoom, ms: 900 }))
  }, [live, following])

  const ordered = useMemo(
    () => [...stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), [stops])
  const days = useMemo(() => [...new Set(ordered.map(s => s.day).filter(Boolean))], [ordered])

  // Search wins over the day filter: a query searches the whole trip, matching a
  // stop's own text or the caption of any photo taken there.
  const dayStops = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) {
      const hit = s => [s.name, s.kind, s.note, s.day].some(v => (v || '').toLowerCase().includes(q))
        || photos.some(p => p.stopId === s.id && (p.caption || '').toLowerCase().includes(q))
      return ordered.filter(hit)
    }
    return day === ALL_DAYS ? ordered : ordered.filter(s => s.day === day)
  }, [ordered, photos, day, query])
  const selectedStop = stops.find(s => s.id === selected)
  const nowStop = stops.find(s => s.status === 'now')
  const nextStop = stops.find(s => s.status === 'next')
  const doneCount = stops.filter(s => s.status === 'done').length
  // Which day of the trip we are on, read off the stop marked "now" rather than
  // stored separately and left to drift.

  // Ids, not a snapshot: the viewer must reflect edits and deletions made while
  // it is open, which a captured array cannot.
  const openViewer = useCallback((list, index) => setViewer({
    ids: list.map(p => p.id), index: clamp(index, 0, list.length - 1),
  }), [])
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

  const addPhoto = useCallback(async ({ file, caption, stopId, lng = live[0], lat = live[1], when = 'Just now', order = 0 }) => {
    const saved = await uploadPhoto(tripId, file, {
      stopId, lng, lat, by: me.name, when,
      caption, seq: photos.length + order,
    })
    setPhotos(list => [...list, saved])
    if (stopId) setSelected(stopId)
  }, [tripId, live, me.name, photos.length])

  const changePhoto = useCallback(async (id, fields) => {
    const before = photos.find(p => p.id === id)
    setPhotos(list => list.map(p => (p.id === id ? { ...p, ...fields } : p)))
    try { await updatePhoto(tripId, id, fields) }
    catch (e) {
      setPhotos(list => list.map(p => (p.id === id ? before : p)))
      toast(e.message || 'Could not save that')
    }
  }, [tripId, photos, toast])

  const removePhoto = useCallback(async id => {
    const before = photos
    setPhotos(list => list.filter(p => p.id !== id))
    setViewer(v => {
      if (!v) return v
      const ids = v.ids.filter(x => x !== id)
      return ids.length ? { ids, index: clamp(v.index, 0, ids.length - 1) } : null
    })
    try { await deletePhoto(tripId, id); toast('Photo deleted') }
    catch (e) { setPhotos(before); toast(e.message || 'Could not delete that') }
  }, [tripId, photos, toast])

  const removeComment = useCallback(async (photoId, id) => {
    const before = comments
    setComments(c => ({ ...c, [photoId]: (c[photoId] || []).filter(x => x.id !== id) }))
    try { await deleteComment(tripId, id) }
    catch (e) { setComments(before); toast(e.message || 'Could not delete that') }
  }, [tripId, comments, toast])

  const handleView = useCallback((next, opts) => {
    if (opts?.user) setFollowing(false)
    setView(next)
  }, [])

  const selectStop = useCallback(id => {
    setSelected(id); setTab('map'); setFollowing(false)
    const s = stops.find(x => x.id === id)
    if (s) {
      setView({ center: [s.lng, s.lat], zoom: Math.max(viewRef.current.zoom, 15), ms: 520 })
      if (day !== ALL_DAYS && s.day !== day) setDay(s.day)
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
  // The day filter's "all" is a sentinel, not a day — never write it to a stop.
  const dayForNewStop = day === ALL_DAYS ? (days[0] || '') : (day || '')

  const onMapClick = useCallback(lngLat => {
    if (routeDraft) { setRouteDraft(r => [...r, lngLat]); return }
    setDraft(d => (d && !d.id)
      ? { ...d, lng: lngLat[0], lat: lngLat[1] }            // reposition the pending one
      : { name: '', icon: 'pin', status: 'planned', day: dayForNewStop,
          lng: lngLat[0], lat: lngLat[1] })
    setSelected(null)
  }, [dayForNewStop, routeDraft])

  /* Stops with no picture of their own get one looked up, once, on load. This
     is the difference between a trip that arrives already looking like
     something and one you have to fill in by hand a stop at a time. Strict
     name matching, so an unrecognised stop keeps its placeholder rather than
     being handed a photograph of somewhere else. */
  const enriched = useRef(false)
  useEffect(() => {
    if (enriched.current || !stops.length) return
    enriched.current = true
    let alive = true
    enrichStops(stops).then(found => {
      if (!alive || !found.length) return
      setStops(list => list.map(s => {
        const p = found.find(f => f.id === s.id)
        return p ? { ...s, src: p.src, sourceUrl: p.sourceUrl,
                     note: p.note === undefined ? s.note : p.note } : s
      }))
      // Persist so it is a one-time cost, but only if this account may write.
      if (canEdit) {
        for (const p of found) {
          updateStop(tripId, p.id, {
            src: p.src, sourceUrl: p.sourceUrl,
            ...(p.note === undefined ? {} : { note: p.note }),
          }).catch(() => {})
        }
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [stops, canEdit, tripId])

  /* ---- places ------------------------------------------------------------
     Search what is currently on screen, drop the results as candidates, and let
     a click turn one into a stop with its name, description and photograph
     already filled in. */
  const searchPlaces = useCallback(async () => {
    if (finding) return
    setFinding(true)
    try {
      const v = viewRef.current
      const found = await findSights({
        // The narrower screen dimension, not the wider one: a candidate you
        // cannot see is a candidate you cannot click, and results are ranked by
        // how well known they are now rather than by how close they are.
        lng: v.center[0], lat: v.center[1],
        radius: radiusForView(v.zoom, v.center[1],
          Math.min(window.innerWidth, window.innerHeight) * 0.8),
      })
      const taken = new Set(stops.map(x => (x.name || '').toLowerCase()))
      const fresh = found.filter(pl => !taken.has(pl.name.toLowerCase()))
      setPlaces(fresh)
      toast(fresh.length ? `Found ${fresh.length} place${fresh.length === 1 ? '' : 's'} here`
                         : 'Nothing new found here — try zooming out')
    } catch (e) {
      toast(e.message || 'Could not search for places')
    } finally {
      setFinding(false)
    }
  }, [finding, stops, toast])

  const pickPlace = useCallback(pl => {
    setPlaces(list => list.filter(x => x.id !== pl.id))
    setDraft({
      name: pl.name, kind: pl.kind || '', icon: pl.icon || 'pin', status: 'planned',
      day: dayForNewStop, note: pl.note || '', lng: pl.lng, lat: pl.lat,
      src: pl.image || null, sourceUrl: pl.source || null,
    })
    setSelected(null)

    // No lead photograph — go looking in the article body, and drop it in if the
    // draft is still the same one by the time it arrives.
    if (!pl.image && pl.pageTitle) {
      imageForPage(pl.pageTitle)
        .then(url => { if (url) setDraft(d => (d && !d.id && d.name === pl.name && !d.src ? { ...d, src: url } : d)) })
        .catch(() => {})
    }
  }, [dayForNewStop])

  // Fill in a stop you placed by hand from whatever is at those coordinates.
  const lookUpDraft = useCallback(async () => {
    if (!draft) return
    try {
      const pl = await describePlace({ lng: draft.lng, lat: draft.lat, name: draft.name })
      if (!pl) { toast('Nothing found at that spot'); return }
      const image = pl.image || (pl.pageTitle ? await imageForPage(pl.pageTitle).catch(() => null) : null)
      setDraft(d => ({
        ...d,
        name: (d.name || '').trim() || pl.name,
        kind: d.kind || pl.kind || '',
        icon: d.icon && d.icon !== 'pin' ? d.icon : pl.icon,
        note: (d.note || '').trim() || pl.note || '',
        src: d.src || image || null,
        sourceUrl: d.sourceUrl || pl.source || null,
      }))
      toast('Filled in from ' + pl.name)
    } catch (e) {
      toast(e.message || 'Could not look that up')
    }
  }, [draft, toast])

  const saveRoute = useCallback(async () => {
    if (!routeDraft) return
    const next = routeDraft
    setRoute(next); setRouteDraft(null)
    try { await replaceRoute(tripId, next); toast('Route saved') }
    catch (e) { toast(e.message || 'Could not save the route') }
  }, [routeDraft, tripId, toast])

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

  // Swap seq with the neighbour. Both rows move, so both are saved.
  const moveStop = useCallback(async dir => {
    if (!draft || !draft.id) return
    const i = ordered.findIndex(x => x.id === draft.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ordered.length) return
    const a = ordered[i], b = ordered[j]
    const aSeq = a.seq ?? i, bSeq = b.seq ?? j
    setStops(list => list.map(x =>
      x.id === a.id ? { ...x, seq: bSeq } : x.id === b.id ? { ...x, seq: aSeq } : x))
    try {
      await Promise.all([updateStop(tripId, a.id, { seq: bSeq }), updateStop(tripId, b.id, { seq: aSeq })])
    } catch (e) { toast(e.message || 'Could not reorder those') }
  }, [draft, ordered, tripId, toast])

  const saveDraft = useCallback(async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      if (draft.id) {
        const saved = await updateStop(tripId, draft.id, {
          name: draft.name, kind: draft.kind, icon: draft.icon, day: draft.day,
          time: draft.time, status: draft.status, note: draft.note,
          lng: draft.lng, lat: draft.lat, src: draft.src || null,
          sourceUrl: draft.sourceUrl || null,
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

  const saveTrip = useCallback(async fields => {
    const before = trip
    setTrip(t => ({ ...t, ...fields }))
    try { await updateTrip(tripId, fields) }
    catch (e) { setTrip(before); toast(e.message || 'Could not save that') }
  }, [trip, tripId, toast])

  const saveMe = useCallback(async ({ name, file }) => {
    let avatarUrl
    try {
      if (file) avatarUrl = await uploadAvatar(tripId, me.id, file)
      const saved = await updateMe(tripId, me.id, { name, avatarUrl })
      setMe(m => ({ ...m, ...saved }))
      setFamily(list => list.map(f => (f.id === me.id ? withFace({ ...f, ...saved }) : f)))
      toast('Saved')
    } catch (e) { toast(e.message || 'Could not save that') }
  }, [tripId, me.id, toast])

  // From the sights list: add it to the trip outright, rather than opening an
  // editor — you are browsing, not authoring.
  const addSight = useCallback(async pl => {
    try {
      const image = pl.image || (pl.pageTitle ? await imageForPage(pl.pageTitle).catch(() => null) : null)
      const saved = await createStop(tripId, {
        name: pl.name, kind: pl.kind || '', icon: pl.icon || 'pin', status: 'planned',
        day: dayForNewStop, note: pl.note || '', lng: pl.lng, lat: pl.lat,
        src: image || null, sourceUrl: pl.source || null, seq: stops.length,
      })
      setStops(list => [...list, saved])
      toast(`${pl.name} added to the trip`)
    } catch (e) {
      toast(e.message || 'Could not add that')
    }
  }, [tripId, dayForNewStop, stops.length, toast])

  const { data: attractions, filling: attrFilling, count: attrCount } =
    useAttractions(view, showAttractions && tab === 'map')

  const toggleAttractions = useCallback(() => {
    setShowAttractions(on => {
      const next = !on
      try { localStorage.setItem('wf-attractions', next ? 'on' : 'off') } catch { /* private mode */ }
      if (!next) setAttraction(null)
      return next
    })
  }, [])

  const addAttraction = useCallback(async poi => {
    try {
      const saved = await createStop(tripId, {
        name: poi.n, kind: poi.d || '', icon: ICON_FOR_KIND[poi.k] || 'pin', status: 'planned',
        day: dayForNewStop, note: poi.note || '', lng: poi.lng, lat: poi.lat,
        src: poi.image || null, sourceUrl: poi.source || null, seq: stops.length,
      })
      setStops(list => [...list, saved])
      toast(`${poi.n} added to the trip`)
    } catch (e) { toast(e.message || 'Could not add that') }
  }, [tripId, dayForNewStop, stops.length, toast])

  const showSight = useCallback(pl => {
    setTab('map'); setFollowing(false)
    setView({ center: [pl.lng, pl.lat], zoom: Math.max(viewRef.current.zoom, 16), ms: 620 })
  }, [])

  const onPeople = useCallback(() => setShare(true), [])
  const onUpload = useCallback(() => setUpload(true), [])
  const backToMap = useCallback(() => setTab('map'), [])
  const onLive = useCallback(() => selectStop(nowStop?.id || stops[0]?.id), [selectStop, nowStop, stops])

  const viewerList = useMemo(() => {
    if (!viewer) return null
    const by = new Map(photos.map(p => [p.id, p]))
    return viewer.ids.map(id => by.get(id)).filter(Boolean)
  }, [viewer, photos])

  return (
    <div className="app wide">
      <Ticker trip={trip} km={km} doneCount={doneCount} stopCount={stops.length}
        photoCount={photos.length} nowStop={nowStop} nextStop={nextStop}
        liveKey={`${live[0]},${live[1]}`} onPeople={onPeople} tab={tab} setTab={setTab}
        onUpload={onUpload} theme={theme} onToggleTheme={toggleTheme}
        attractionsOn={showAttractions} onToggleAttractions={toggleAttractions}
        sunPhase={mapOverride ? null : sun.phase}
        canEdit={canEdit} editing={editing} onToggleEdit={startEditing}
        me={me} onSignOut={hasBackend ? () => signOut().then(() => window.location.reload()) : null} />

      <div className="stagewrap">
        <MapCanvas theme={mapTheme} tint={sun} view={view} onView={handleView}
          route={routeDraft || track} stops={stops} photos={photos} markers={markers} trail={trail}
          selectedStop={selected} labels={view.zoom > 13} onStop={pickStop}
          onPhoto={openViewer} onLive={onLive}
          editing={editing} onMapClick={onMapClick} onStopMove={onStopMove}
          places={editing && !routeDraft ? places : []} onPickPlace={pickPlace}
          attractions={attractions} onPickAttraction={setAttraction} />

        {showAttractions && attrFilling > 0 && (
          <div className="attrfill"><i /> Finding attractions… {attrCount}</div>
        )}

        {attraction && (
          <AttractionCard poi={attraction} canEdit={canEdit}
            inTrip={stops.some(s => (s.name || '').toLowerCase() === (attraction.n || '').toLowerCase())}
            onAdd={addAttraction} onClose={() => setAttraction(null)} />
        )}

        {editing && draft && (
          <StopEditor draft={draft} days={days} onField={onDraftField}
                      onSave={saveDraft} onDelete={removeDraft} onMove={moveStop}
                      onLookUp={lookUpDraft}
                      onClose={() => setDraft(null)} busy={saving} />
        )}

        {editing && !draft && (
          <div className="edithint">
            <b>{routeDraft ? 'Route' : 'Edit mode'}</b>
            {routeDraft ? (
              <>
                <span>Click to extend the line · {routeDraft.length} point{routeDraft.length === 1 ? '' : 's'}</span>
                <button onClick={() => setRouteDraft(r => r.slice(0, -1))}
                        disabled={!routeDraft.length}>Undo</button>
                <button onClick={() => setRouteDraft([])}>Clear</button>
                <button onClick={() => setRouteDraft(null)}>Cancel</button>
                <button className="go" onClick={saveRoute}>Save route</button>
              </>
            ) : (
              <>
                <span>Click the map to add a stop, or a pin to change one. Drag pins to move them.</span>
                <button onClick={searchPlaces} disabled={finding}>
                  {finding ? 'Searching…' : 'Find places'}
                </button>
                {places.length > 0 && (
                  <button onClick={() => setPlaces([])}>Hide {places.length}</button>
                )}
                <button onClick={() => setRouteDraft(route.slice())}>Edit route</button>
              </>
            )}
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
        {tab === 'sights' && <SightsView centre={view} stops={stops} canEdit={canEdit}
                                         onAdd={addSight} onShow={showSight}
                                         onClose={backToMap} toast={toast} />}
        {tab === 'family' && <FamilyView family={family} photos={photos} onClose={backToMap} onInvite={onPeople} />}
      </div>

      <Filmstrip stops={dayStops} photos={photos} byName={byName} selected={selected} onSelect={selectStop}
                 day={day} setDay={setDay} days={days} openViewer={openViewer}
                 query={query} setQuery={setQuery} />

      {viewerList && viewerList.length > 0 && (
        <PhotoViewer list={viewerList} index={clamp(viewer.index, 0, viewerList.length - 1)} setIndex={setIndex}
          onClose={closeViewer} stops={stops} byName={byName} comments={comments} addComment={addComment}
          likes={likes} toggleLike={toggleLike} theme={mapTheme} tint={sun} me={me}
          canEdit={canEdit} onPhotoChange={changePhoto} onPhotoDelete={removePhoto}
          onCommentDelete={removeComment} />
      )}
      {share && <PeopleModal onClose={() => setShare(false)} toast={toast} tripId={tripId}
                             family={family} canEdit={canEdit} trip={trip} onSaveTrip={saveTrip}
                             me={me} onSaveMe={saveMe} phones={phones} onPhonesChange={setPhones}
                             appLink={window.location.origin + window.location.pathname
                                      + (trip.slug ? `?t=${trip.slug}` : '')} />}
      {upload && <UploadModal onClose={() => setUpload(false)} onAdd={addPhoto} live={live} stops={stops} toast={toast} />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  )
}
