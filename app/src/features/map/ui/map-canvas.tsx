import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Map as MapGL,
  prewarm,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import Icon from '../../../shared/ui/icon'
import Img from '../../../shared/ui/img'
import { validLngLat } from '../../../shared/lib/geo'
import { paddingOffset } from '../../../live-map-view-core'
import useIndoorLayers from '../model/indoor-layers'
import makeTrailSweep from '../model/trail-sweep'
import useMapLayers from '../model/use-map-layers'
import { creditControl, STYLE } from '../model/map-style'
import registerOfflineTiles from '../model/offline-tiles'
import { LiveMarker, MapMarker } from './map-marker'
import type { MapCanvasProps } from '../model/map-props'
import type { Id, TripPhoto } from '../../../shared/model/types'

setWorkerUrl(maplibreWorkerUrl)
/* Start the worker pool as soon as this module loads rather than when the map
   is constructed. The chunk lands around 30ms and the map is not built until
   ~100ms, so the worker can be up and waiting in time it would otherwise spend
   starting on the critical path. */
prewarm()
// Before any map exists: a style that has already asked for a tile will not
// ask again, so the handler has to be in place first.
registerOfflineTiles()

/** photographs stacked on one spot, so a busy corner is one tidy pile */
interface PhotoGroup {
  key: string
  lng: number
  lat: number
  items: TripPhoto[]
}

const MapCanvas = memo(function MapCanvas({
  view,
  onView,
  theme,
  tint,
  interactive = true,
  route = [],
  stops = [],
  photos = [],
  markers = [],
  trail = [],
  selectedStop,
  onStop,
  onPhoto,
  onLive,
  labels = false,
  highlight = null,
  padding = null,
  editing = false,
  placing = false,
  onMapClick,
  onStopMove,
  places = [],
  onPickPlace,
  attractions = null,
  onPickAttraction,
  indoor = null,
  onPickGate,
  children,
}: MapCanvasProps) {
  const holder = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapGL | null>(null)
  const [moving, setMoving] = useState(false) // any camera movement
  const [dragging, setDragging] = useState(false) // the user's hand, specifically

  const oref = useRef(onView)
  oref.current = onView
  const routeRef = useRef(route)
  routeRef.current = route
  const trailRef = useRef(trail)
  trailRef.current = trail
  const themeRef = useRef(theme)
  themeRef.current = theme
  const tintRef = useRef(tint)
  tintRef.current = tint
  const viewRef = useRef(view)
  viewRef.current = view
  const userMove = useRef(false)
  const moved = useRef(false)

  const sweepIn = useMemo(() => makeTrailSweep({ trailRef, interactive }), [interactive])

  /* ---- create once ------------------------------------------------------ */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the map is created exactly once; live values reach it through refs and the effects below
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
      // The credit is our own control, added below — bottom-left, clear of
      // the map controls, resting at the one line the licences insist on.
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    /* "© OpenStreetMap" always readable, everything else on /credits.html
       behind More tools — the split each licence actually asks for. */
    m.addControl(creditControl(), 'bottom-right')
    m.touchZoomRotate?.disableRotation?.()
    setMap(m)
    // A handle for the test suite: the attraction layer is drawn by the GPU,
    // so there is no element to select and assert against.
    if (interactive) window.__offwegoMap = m
    return () => {
      m.remove()
      setMap(null)
    }
  }, [])

  useMapLayers({
    map,
    routeRef,
    trailRef,
    tintRef,
    themeRef,
    route,
    trail,
    sweepIn,
    onPickAttraction,
  })

  useEffect(() => {
    if (!map || !attractions) return
    const src = map.getSource<GeoJSONSource>('attr')
    if (src) src.setData(attractions)
  }, [map, attractions])

  // The inside of an airport terminal, when a stop has asked for it.
  useIndoorLayers(map, indoor, themeRef, onPickGate)

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
  const fitted = useRef('')
  useEffect(() => {
    if (!map) return
    const pad = padding || 32
    const ms = view.ms == null ? 420 : view.ms
    if (view.bounds) {
      // Live positions arrive on a timer; re-fitting the same box every time one
      // does turns a still map into one that keeps sliding under the reader.
      const key = JSON.stringify(view.bounds) + JSON.stringify(pad)
      if (key === fitted.current) return
      fitted.current = key
      map.fitBounds(view.bounds, { padding: pad, maxZoom: 15, duration: ms, essential: true })
      return
    }
    fitted.current = ''
    const c = map.getCenter()
    if (
      Math.abs(c.lng - view.center[0]) < 1e-7 &&
      Math.abs(c.lat - view.center[1]) < 1e-7 &&
      Math.abs(map.getZoom() - view.zoom) < 1e-4
    )
      return
    map.easeTo({
      center: view.center,
      zoom: view.zoom,
      duration: ms,
      essential: true,
      // A focus goes to the middle of the map you can see, not the middle of the
      // container — a third of which is behind the chrome on a phone. Anything
      // else keeps the centre it was given: offsetting a camera that is only
      // changing zoom walks the map a little further away on every press.
      offset: padding && view.focus ? paddingOffset(padding) : [0, 0],
    })
  }, [map, view, padding])

  useEffect(() => {
    if (!map) return
    const start = (e: { originalEvent?: unknown }) => {
      userMove.current = !!e.originalEvent
      setMoving(true)
    }
    const end = () => {
      setMoving(false)
      const c = map.getCenter()
      oref.current(
        { center: [c.lng, c.lat], zoom: map.getZoom() },
        userMove.current ? { user: true } : undefined,
      )
      userMove.current = false
    }
    // A drag must not also count as a click on whatever marker was underneath.
    const dragStart = () => {
      moved.current = true
      setDragging(true)
    }
    const dragEnd = () => {
      setDragging(false)
      setTimeout(() => {
        moved.current = false
      }, 0)
    }
    map.on('movestart', start)
    map.on('moveend', end)
    map.on('dragstart', dragStart)
    map.on('dragend', dragEnd)
    return () => {
      map.off('movestart', start)
      map.off('moveend', end)
      map.off('dragstart', dragStart)
      map.off('dragend', dragEnd)
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
  const clickRef = useRef(onMapClick)
  clickRef.current = onMapClick
  useEffect(() => {
    if (!map || (!editing && !placing)) return
    const h = (e: MapMouseEvent) => clickRef.current?.([e.lngLat.lng, e.lngLat.lat])
    map.on('click', h)
    return () => {
      map.off('click', h)
    }
  }, [map, editing, placing])

  /* ---- overlays --------------------------------------------------------- */
  // Photos are grouped per stop so a busy corner shows one tidy stack, not a pile.
  const groups = useMemo(() => {
    const byStop = new Map<Id, TripPhoto[]>(),
      loose: TripPhoto[] = []
    photos.forEach(p => {
      if (!p.stopId) {
        if (validLngLat(p.lng, p.lat)) loose.push(p)
        return
      }
      if (!byStop.has(p.stopId)) byStop.set(p.stopId, [])
      byStop.get(p.stopId)!.push(p)
    })
    const out: PhotoGroup[] = []
    byStop.forEach((items, stopId) => {
      const s = stops.find(x => x.id === stopId) || items.find(p => validLngLat(p.lng, p.lat))
      if (!s) return
      items.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
      // The anchor's coordinates exist by construction: a stop always has
      // them, and the fallback photo was chosen for having them.
      out.push({ key: 'g' + stopId, lng: s.lng!, lat: s.lat!, items })
    })
    loose.forEach(p => {
      out.push({ key: String(p.id), lng: p.lng!, lat: p.lat!, items: [p] })
    })
    return out
  }, [photos, stops])

  return (
    <div
      className={
        'mapcanvas' +
        (moving ? ' busy' : '') +
        (dragging ? ' drag' : '') +
        (editing ? ' editing' : '') +
        (placing ? ' placing' : '')
      }
      ref={holder}>
      {map &&
        stops.map(s => (
          <MapMarker
            key={s.id}
            map={map}
            lng={s.lng}
            lat={s.lat}
            draggable={editing}
            onDragEnd={p => onStopMove?.(s.id, p)}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: map pins are the pointer route; the itinerary rail is the keyboard route */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: map pins are the pointer route; the itinerary rail is the keyboard route */}
            <div
              className={
                'mstop ' +
                (s.status === 'done' ? 'done ' : '') +
                (editing ? 'edit ' : '') +
                (selectedStop === s.id ? 'sel' : '')
              }
              onClick={e => {
                e.stopPropagation()
                if (!moved.current) onStop?.(s.id)
              }}>
              <div className="pin">
                <Icon n={s.icon || 'pin'} s={13} c="#fff" w={2} />
              </div>
              {(labels || selectedStop === s.id) && <div className="lab">{s.name}</div>}
            </div>
          </MapMarker>
        ))}

      {map &&
        groups.map(g => (
          <MapMarker key={g.key} map={map} lng={g.lng} lat={g.lat}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: photo stacks are the pointer route; the photo rail is the keyboard route */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: photo stacks are the pointer route; the photo rail is the keyboard route */}
            <div
              className={'mstack' + (g.items.some(p => p.id === highlight) ? ' hi' : '')}
              onClick={e => {
                e.stopPropagation()
                if (!moved.current) onPhoto?.(g.items, 0)
              }}
              title={`${g.items.length} photo${g.items.length === 1 ? '' : 's'}`}>
              <span className="in">
                {g.items.slice(0, 3).map((p, i) => (
                  <span
                    className="sh"
                    key={p.id}
                    style={{
                      zIndex: 3 - i,
                      transform: `translate(${i * 5}px,${i * -4}px) rotate(${(i - 1) * 4}deg)`,
                    }}>
                    <Img item={p} w={160} h={160} />
                  </span>
                ))}
                {g.items.length > 1 && <span className="ct">{g.items.length}</span>}
              </span>
            </div>
          </MapMarker>
        ))}

      {map &&
        places.map(pl => (
          <MapMarker key={pl.id} map={map} lng={pl.lng} lat={pl.lat}>
            <button
              className="mfind"
              title={pl.kind || pl.name}
              onClick={e => {
                e.stopPropagation()
                onPickPlace?.(pl)
              }}>
              {pl.image && <img src={pl.image} alt="" />}
              <span>{pl.name}</span>
            </button>
          </MapMarker>
        ))}

      {map &&
        markers.map(m => (
          <LiveMarker
            key={m.key}
            map={map}
            lng={m.lng}
            lat={m.lat}
            avatar={m.avatar}
            name={m.name}
            title={m.title}
            stale={m.stale}
            onClick={onLive}
            movedRef={moved}
          />
        ))}

      {children}
    </div>
  )
})

export default MapCanvas
