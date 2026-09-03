import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapGL, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { MapMarker } from '../../map'
import {
  CLOUD_BOUNDS,
  CLOUD_DRIFT,
  CLOUD_REFRESH,
  loadWeather,
  type Weather,
} from '../model/clouds'
import { facing, globeZoom, legFeatures, type GlobePlace, type LngLat } from '../model/globe-core'

setWorkerUrl(maplibreWorkerUrl)

interface GlobeProps {
  places?: GlobePlace[]
  home?: GlobePlace | null
  live?: GlobePlace | null
  /** pulse the home marker — used before there is a trip to draw */
  waiting?: boolean
}

/* NASA's Blue Marble: shaded relief with bathymetry, so the planet behind the
   trip is the real one — forest, desert, ice and ocean floor. Public domain, no
   key, served to zoom 8, which is past anything a background globe asks for.
   Today's weather goes over the top of it; see ../model/clouds. */
const BLUE_MARBLE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
  'BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'

// The map feature's accent, hardcoded for the same reason it is there: the trip
// line stays gold over imagery, whichever way the app's own theme has gone.
const ACCENT = '#F0A63C'

const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  sources: {
    world: {
      type: 'raster',
      tiles: [BLUE_MARBLE],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 8,
      attribution: 'NASA EOSDIS GIBS',
    },
  },
  // Sea-coloured under the map, so a tile that has not arrived yet reads as
  // ocean rather than as a hole in the planet.
  layers: [
    { id: 'deep', type: 'background', paint: { 'background-color': '#0a1b2e' } },
    { id: 'world', type: 'raster', source: 'world' },
  ],
  sky: {
    'sky-color': '#0d1830',
    'horizon-color': '#8fb9e0',
    'fog-color': '#0a1b2e',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.4,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 4, 0.6, 7, 0],
  },
}

/* MapLibre closes the top and bottom of the globe with a fan of the topmost
   and bottommost rows of the highest raster layer, and Web Mercator has no
   tiles past 85° to fill it: over Blue Marble the north pole comes out as a
   disc of Arctic Ocean, which reads as a hole punched in the planet. This tile
   is transparent apart from those rows, so it changes nothing anywhere else
   and caps both poles with ice. Three rows rather than one: at a glancing
   angle a hairline cap does not quite cover the dark fan behind it. */
function iceCap(): string {
  const tile = document.createElement('canvas')
  tile.width = 256
  tile.height = 256
  const paint = tile.getContext('2d')!
  paint.fillStyle = '#E8EFF5'
  paint.fillRect(0, 0, 256, 3)
  paint.fillRect(0, 253, 256, 3)
  return tile.toDataURL()
}

const stillness = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const START: LngLat = [-42, 26]
const DRIFT = 0.00025 // degrees per millisecond, about a lap an hour
const IDLE_BEFORE_DRIFT = 2500

const Globe = memo(function Globe({ places = [], home, live, waiting }: GlobeProps) {
  const holder = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<MapGL | null>(null)
  const [centre, setCentre] = useState<LngLat>(START)
  const held = useRef(false) // a pointer is down on the planet
  const idleSince = useRef(0)

  /* ---- create once ------------------------------------------------------ */
  useEffect(() => {
    const box = holder.current
    if (!box) return
    let created: MapGL | null = null
    try {
      created = new MapGL({
        container: box,
        style: STYLE,
        center: START,
        zoom: globeZoom(box.clientHeight || window.innerHeight),
        minZoom: 0.5,
        maxZoom: 7,
        // NASA asks for the credit their tiles declare; show it.
        attributionControl: { compact: true },
        // Dragging spins the planet; everything else belongs to the page. A
        // background that swallowed the scroll wheel would trap the reader.
        scrollZoom: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
        dragRotate: false,
        pitchWithRotate: false,
        keyboard: false,
        renderWorldCopies: false,
      })
    } catch {
      return // no WebGL: the page keeps its background and its text
    }
    setMap(created)
    // A handle for the test suite, as on the trip map: the planet is drawn by
    // the GPU, so there is no element to select and assert against.
    window.__offwegoGlobe = created
    return () => {
      created.remove()
      setMap(null)
    }
  }, [])

  const legs = useMemo(() => legFeatures(places), [places])
  const legsRef = useRef(legs)
  legsRef.current = legs

  /* ---- the trip's arcs, re-added whenever the style loads ---------------
     Seeded from the ref rather than left empty: the trip is usually known
     before the style has finished loading, and the update below has nothing to
     write to until the sources exist. */
  useEffect(() => {
    if (!map) return
    const add = () => {
      if (map.getSource('ice')) return
      map.addSource('ice', {
        type: 'raster',
        tiles: [iceCap()],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 0,
      })
      map.addLayer({
        id: 'ice-cap',
        type: 'raster',
        source: 'ice',
        paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
      })
      map.addSource('planned', { type: 'geojson', data: legsRef.current.planned })
      map.addSource('walked', { type: 'geojson', data: legsRef.current.walked })
      map.addLayer({
        id: 'planned-line',
        type: 'line',
        source: 'planned',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ACCENT,
          'line-width': 2,
          'line-opacity': 0.6,
          'line-dasharray': [1.5, 3.5],
        },
      })
      map.addLayer({
        id: 'walked-glow',
        type: 'line',
        source: 'walked',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ACCENT, 'line-width': 11, 'line-opacity': 0.22, 'line-blur': 6 },
      })
      map.addLayer({
        id: 'walked-line',
        type: 'line',
        source: 'walked',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ACCENT, 'line-width': 3 },
      })
    }
    /* `isStyleLoaded` also waits on the tiles, and an inline style document is
       parsed before React gets to run this — between the two, checking it here
       missed the event and left the trip undrawn. */
    if (map.loaded()) add()
    else map.once('load', add)
    map.on('style.load', add)
    return () => {
      map.off('style.load', add)
    }
  }, [map])

  /* ---- today's weather --------------------------------------------------
     Fetched after the planet is up rather than with it: the frame is a couple
     of megabytes and the land underneath is what the page is waiting on. */
  const weather = useRef<Weather | null>(null)
  useEffect(() => {
    if (!map) return
    let live = true
    const show = async () => {
      const sky = await loadWeather()
      if (!live || !sky || !map.getStyle()) return
      weather.current = sky
      map.addSource('clouds', {
        type: 'canvas',
        canvas: sky.canvas,
        coordinates: CLOUD_BOUNDS,
        // The texture is redrawn as the weather rolls, so it is re-read every
        // frame; standing still, it is uploaded once and left alone.
        animate: !stillness(),
      })
      map.addLayer({
        id: 'cloud-cover',
        type: 'raster',
        source: 'clouds',
        // Under the trip, over the planet: the route is the point of the page.
        ...(map.getLayer('planned-line') ? { beforeId: 'planned-line' } : {}),
        paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0 },
      })
    }
    const start = () => {
      void show()
    }
    if (map.loaded()) start()
    else map.once('load', start)
    const again = setInterval(() => {
      void weather.current?.refresh()
    }, CLOUD_REFRESH)
    return () => {
      live = false
      clearInterval(again)
      weather.current = null
    }
  }, [map])

  /* ---- spin on release, then the slow drift -----------------------------
     One frame loop, so the drift and the user's own inertia never fight over
     the camera: while a hand is on the planet, or MapLibre is still easing a
     fling, this stands off. */
  useEffect(() => {
    if (!map) return
    const reduced = stillness()
    let frame = 0
    let last = 0
    let rolled = 0
    const tick = (now: number) => {
      const elapsed = last ? Math.min(now - last, 64) : 0
      last = now
      try {
        if (!reduced) {
          // The weather keeps moving while the planet is being dragged: it is
          // the one thing on the page that is not the reader's to hold still.
          rolled += (elapsed / 1000) * CLOUD_DRIFT
          weather.current?.roll(rolled)
        }
        if (
          !reduced &&
          !held.current &&
          !map.isMoving() &&
          now - idleSince.current > IDLE_BEFORE_DRIFT
        ) {
          const at = map.getCenter()
          map.setCenter([at.lng + DRIFT * elapsed, at.lat])
        }
      } catch {
        /* A frame that throws must not take the loop with it. Left to
           propagate, the exception skips the call below and the planet stops
           for the rest of the session with nothing on the page to say why. */
      } finally {
        frame = requestAnimationFrame(tick)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [map])

  /* Markers are hidden by hand rather than left to the renderer: the trip's
     dots sit above the canvas as DOM, and DOM has no idea it is round the back
     of a planet. */
  useEffect(() => {
    if (!map) return
    const box = holder.current
    const follow = (event: { originalEvent?: unknown }) => {
      const at = map.getCenter()
      setCentre([at.lng, at.lat])
      // Anything the reader caused counts as a hand on the planet; the drift's
      // own moves carry no original event and so do not hold it off.
      if (event?.originalEvent) idleSince.current = performance.now()
    }
    /* Held is read from the pointer rather than from MapLibre's own drag,
       which our once-a-frame `setCenter` can end without ever saying so. Every
       way a press can finish releases it — including letting go outside the
       window, which sends no pointerup at all, only a blur. */
    const grab = () => {
      held.current = true
      idleSince.current = performance.now()
    }
    const release = () => {
      held.current = false
      idleSince.current = performance.now()
    }
    box?.addEventListener('pointerdown', grab)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    map.on('move', follow)
    return () => {
      box?.removeEventListener('pointerdown', grab)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
      map.off('move', follow)
    }
  }, [map])

  useEffect(() => {
    const box = holder.current
    if (!map || !box) return
    const observer = new ResizeObserver(() => {
      map.resize()
      map.setZoom(globeZoom(box.clientHeight || window.innerHeight))
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [map])

  const near = (place: GlobePlace) => facing(centre, [place.lng, place.lat])
  const dots = places.filter(place => place.label !== false)

  return (
    <div className="world">
      <div className="globe" ref={holder} />
      {map &&
        dots.map((place, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the dot list is fixed module data; index only splits repeated names
          <MapMarker key={place.name + index} map={map} lng={place.lng} lat={place.lat}>
            <div className={'wdot' + (near(place) ? '' : ' back')}>
              <i />
              {place.label && <span>{place.name}</span>}
            </div>
          </MapMarker>
        ))}
      {map && live && (
        <MapMarker map={map} lng={live.lng} lat={live.lat}>
          <div className={'wdot live' + (near(live) ? '' : ' back')}>
            <b className="pulse" />
            <i />
            <span>{live.name} · live</span>
          </div>
        </MapMarker>
      )}
      {map && home && (
        <MapMarker map={map} lng={home.lng} lat={home.lat}>
          <div className={'wdot home' + (near(home) ? '' : ' back')}>
            {waiting && <b className="pulse" />}
            <i />
            <span>{home.name} · home</span>
          </div>
        </MapMarker>
      )}
      <div className="wcredit">NASA Blue Marble · live cloud: NOAA, EUMETSAT, JMA</div>
    </div>
  )
})

export default Globe
