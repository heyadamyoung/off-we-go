/* Inside the terminal. OpenStreetMap maps many airports room by room (the
   Simple Indoor Tagging scheme), and Overpass hands that back as plain JSON.
   Everything here is the pure part — recognising an airport stop, building the
   query, turning Overpass elements into GeoJSON, and slicing it by floor — so
   the whole pipeline can be tested without a network or a map. */

import type { Feature, FeatureCollection, LineString, Point, Polygon, Position } from 'geojson'
import { stepMetres } from './airport-route-core'
import type { Coordinates, Stop } from './shared/model/types'

/** what every indoor feature carries; the map layers filter and label on it */
export interface IndoorProperties {
  kind: string
  name: string
  ref: string
  levels: number[]
  cat?: string
  stair?: boolean
}

export type IndoorFeature = Feature<Point | Polygon | LineString, IndoorProperties>

interface OverpassElement {
  type: string
  lon?: number
  lat?: number
  tags?: Record<string, string>
  geometry?: Array<{ lon?: number; lat?: number }>
}

export interface OverpassResponse {
  elements?: OverpassElement[]
}

const AIRPORT = /\bairport\b|\bairfield\b|luchthaven|flughafen|a[eé]roport|aeropuerto|aeroporto/i

export function isAirportStop(stop: Stop | null | undefined) {
  if (!stop) return false
  /* The plane icon is the strongest signal there is: a stop named just
     "Schiphol" or "EDI" says nothing an airport regex can catch, but the
     person who placed it chose the aeroplane. */
  if (stop.icon === 'plane') return true
  return AIRPORT.test(`${stop.name || ''} ${stop.kw || ''} ${stop.kind || ''}`)
}

/* Zooming into an airport is asking to see inside it; no button needed. The
   thresholds are apart on purpose — open past one zoom, close below a lower
   one — so the terminal does not flicker at the boundary. Only what opened by
   itself closes by itself, never while a gate route is up; and a terminal
   dismissed by hand stays dismissed until the camera has properly left. */
export function autoIndoorMove({
  view,
  stops,
  active,
  auto,
  dismissed,
  routing,
}: {
  view: { center: Coordinates; zoom: number } | null
  stops?: Stop[]
  /** the stop whose terminal is open, if any */
  active: Stop | null
  /** the stop id that auto-open chose, if it did */
  auto: string | null
  dismissed: string | null
  routing: boolean
}): { open: Stop } | { close: true } | { reset: true } | null {
  if (!view) return null
  if (!active) {
    if (view.zoom >= 14.6) {
      const stop = (stops || []).find(
        s => isAirportStop(s) && stepMetres(view.center, [s.lng, s.lat]) < 1800,
      )
      if (stop && dismissed !== stop.id) return { open: stop }
    }
    if (view.zoom < 13.8) return { reset: true }
    return null
  }
  if (
    auto === active.id &&
    !routing &&
    (view.zoom < 13.8 || stepMetres(view.center, [active.lng, active.lat]) > 4000)
  ) {
    return { close: true }
  }
  return null
}

/* Ways carry their own coordinates with `out geom`, so no second lookup and no
   converter library. The radius takes in the whole airfield from a pin dropped
   anywhere on it; the trailing count caps a runaway hub at something a phone
   can hold. */
export function overpassQueryFor(lng: number, lat: number, radius = 1500) {
  const around = `(around:${radius},${lat.toFixed(5)},${lng.toFixed(5)})`
  return (
    `[out:json][timeout:40];(` +
    `way["indoor"]${around};` +
    `way["aeroway"="terminal"]${around};` +
    `way["aeroway"="gate"]${around};` +
    `way["highway"~"^(footway|corridor|steps)$"]["level"]${around};` +
    `node["aeroway"="gate"]${around};` +
    `node["highway"="elevator"]${around};` +
    `node["level"]["name"]${around};` +
    `node["level"]["amenity"="toilets"]${around};` +
    `);out geom 4000;`
  )
}

/* The level tag is a small language: "1", "-1", "0;1" for a thing on two
   floors, "0-2" for a span, "0.5" for a mezzanine. Unparseable values become
   no levels at all, which downstream means "show it on every floor" — the
   right failure for a terminal outline and a harmless one for anything else. */
export function parseLevels(value?: string | null): number[] {
  const out: number[] = []
  for (const part of String(value ?? '').split(';')) {
    const token = part.trim()
    if (!token) continue
    if (/^-?\d+(\.\d+)?$/.test(token)) {
      out.push(+token)
      continue
    }
    const range = /^(-?\d+)-(-?\d+)$/.exec(token)
    if (!range) continue
    const from = Math.min(+range[1], +range[2]),
      to = Math.max(+range[1], +range[2])
    for (let n = from; n <= to && n < from + 10; n++) out.push(n)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/* What a feature is decides how it draws: walkable space as a wash, rooms as
   solid shapes, walls as lines, gates as points with their code on them, and
   corridors-as-lines as the walking network the gate routes run along. */
function kindOf(t: Record<string, string>, type: string) {
  if (t.aeroway === 'gate') return 'gate'
  if (t.aeroway === 'terminal') return 'terminal'
  if (type === 'way' && /^(footway|corridor|steps)$/.test(t.highway || '')) return 'path'
  if (type === 'node' && t.highway === 'elevator') return 'lift'
  if (t.indoor === 'wall' || t.barrier === 'wall') return 'wall'
  if (t.indoor === 'room') return 'room'
  if (t.indoor === 'corridor' || t.indoor === 'area') return 'walk'
  if (t.indoor === 'level') return 'floor'
  if (type === 'way' && t.indoor === 'yes') return 'walk'
  if (type === 'node' && t.level != null && (t.name || t.amenity === 'toilets')) return 'poi'
  return null
}

/* Which colour a landmark wears, and which ones matter enough to show. */
export function poiCat(t: Record<string, string>) {
  if (t.amenity === 'toilets') return 'wc'
  if (t.highway === 'elevator') return 'lift'
  if (/^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream)$/.test(t.amenity || ''))
    return 'food'
  if (t.shop) return 'shop'
  if (t.amenity === 'lounge') return 'lounge'
  if (t.tourism === 'information' || t.amenity === 'information') return 'info'
  return ''
}

const round6 = (pair: Position): Position => [+pair[0].toFixed(6), +pair[1].toFixed(6)]

const centroid = (coords: Position[]) =>
  round6(
    coords.reduce(
      (sum, c) => [sum[0] + c[0] / coords.length, sum[1] + c[1] / coords.length],
      [0, 0],
    ),
  )

export function indoorFeatures(json: OverpassResponse | null | undefined): IndoorFeature[] {
  const out: IndoorFeature[] = []
  for (const el of json?.elements || []) {
    const t = el.tags || {}
    const kind = kindOf(t, el.type)
    if (!kind) continue
    const properties: IndoorProperties = {
      kind,
      name: t.name || t.ref || (kind === 'lift' ? 'Lift' : t.amenity === 'toilets' ? 'WC' : ''),
      ref: t.ref || t.name || '',
      levels: parseLevels(t.level),
      cat: poiCat(t),
      stair: t.highway === 'steps',
    }
    if (el.type === 'node') {
      if (!Number.isFinite(el.lon) || !Number.isFinite(el.lat)) continue
      out.push({
        type: 'Feature',
        properties,
        geometry: { type: 'Point', coordinates: round6([el.lon!, el.lat!]) },
      })
      continue
    }
    const coords = (el.geometry || [])
      .filter(g => g && Number.isFinite(g.lon) && Number.isFinite(g.lat))
      .map(g => round6([g.lon!, g.lat!]))
    if (coords.length < 2) continue
    const closed =
      coords.length > 3 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1]
    // A gate drawn as an area still reads best as one point with a code on it.
    if (kind === 'gate') {
      out.push({
        type: 'Feature',
        properties,
        geometry: { type: 'Point', coordinates: centroid(coords) },
      })
    } else if (closed && kind !== 'wall' && kind !== 'path') {
      out.push({
        type: 'Feature',
        properties,
        geometry: { type: 'Polygon', coordinates: [coords] },
      })
    } else {
      out.push({
        type: 'Feature',
        properties,
        geometry: { type: 'LineString', coordinates: coords },
      })
    }
  }
  return out
}

export function levelsOf(features: IndoorFeature[]): number[] {
  const seen = new Set<number>()
  for (const f of features) for (const level of f.properties?.levels || []) seen.add(level)
  return [...seen].sort((a, b) => a - b)
}

/* Where the map opens: the ground floor if it is mapped, otherwise the lowest
   floor above ground — a terminal mapped only as "1;2" should not open on an
   empty screen, and neither should one that is all basement. */
export function defaultLevel(levels: number[]): number {
  if (!levels.length || levels.includes(0)) return 0
  const above = levels.filter(level => level >= 0)
  return above.length ? above[0] : levels[levels.length - 1]
}

export function onLevel(features: IndoorFeature[], level: number): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.filter(
      f => !f.properties.levels.length || f.properties.levels.includes(level),
    ),
  }
}
