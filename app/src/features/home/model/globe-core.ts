/* The globe on the home page, as maths only — no DOM and no map, so the arcs,
   the framing and what is round the back can be tested on their own. */

export type LngLat = [number, number]

export interface GlobePlace {
  name: string
  lng: number
  lat: number
  /** already been there, so the leg into it is drawn solid rather than dashed */
  done?: boolean
  /** print the name beside the dot */
  label?: boolean
}

export interface LineFeature {
  type: 'Feature'
  properties: Record<string, never>
  geometry: { type: 'LineString'; coordinates: LngLat[] }
}

export interface LineCollection {
  type: 'FeatureCollection'
  features: LineFeature[]
}

const RAD = Math.PI / 180

const toVector = ([lon, lat]: LngLat) => {
  const phi = lat * RAD
  const lambda = lon * RAD
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)]
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** True when a place is on the half of the planet turned towards the camera. */
export function facing(centre: LngLat, place: LngLat, margin = 0.03): boolean {
  return dot(toVector(centre), toVector(place)) > margin
}

/* The shortest path over the surface, densified: the map draws a two-point
   line as a straight run across the screen, which on a sphere is a shortcut
   through the planet rather than a flight path over it. */
export function greatCircle(from: LngLat, to: LngLat, steps = 48): LngLat[] {
  const a = toVector(from)
  const b = toVector(to)
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))))
  // Two names for the same place: interpolating would divide by sin(0).
  if (angle < 1e-6) return [from]

  const points: LngLat[] = []
  let previous = from[0]
  for (let step = 0; step <= steps; step++) {
    const t = step / steps
    const k1 = Math.sin((1 - t) * angle) / Math.sin(angle)
    const k2 = Math.sin(t * angle) / Math.sin(angle)
    const x = k1 * a[0] + k2 * b[0]
    const y = k1 * a[1] + k2 * b[1]
    const z = k1 * a[2] + k2 * b[2]
    let lon = Math.atan2(y, x) / RAD
    /* Longitude comes back wrapped into ±180. Left alone, a leg over the date
       line reads as one that goes the long way round the other side. */
    while (lon - previous > 180) lon -= 360
    while (previous - lon > 180) lon += 360
    previous = lon
    points.push([lon, Math.asin(z / Math.hypot(x, y, z)) / RAD])
  }
  return points
}

const collect = (features: LineFeature[]): LineCollection => ({
  type: 'FeatureCollection',
  features,
})

const leg = (coordinates: LngLat[]): LineFeature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates },
})

/** The trip as two sets of lines: the part already travelled, and the rest. */
export function legFeatures(places: GlobePlace[]) {
  const walked: LineFeature[] = []
  const planned: LineFeature[] = []
  for (let index = 1; index < places.length; index++) {
    const from = places[index - 1]
    const to = places[index]
    const line = greatCircle([from.lng, from.lat], [to.lng, to.lat])
    if (line.length < 2) continue
    ;(from.done && to.done ? walked : planned).push(leg(line))
  }
  return { walked: collect(walked), planned: collect(planned) }
}

/* MapLibre draws the globe with a radius of 512/2π pixels at zoom 0 and doubles
   it every zoom step, so the zoom that makes the planet a given size on screen
   is a logarithm rather than a number somebody nudged until it looked right. */
const RADIUS_AT_ZOOM_0 = 512 / (2 * Math.PI)

/** The zoom at which the planet stands `fill` of the container tall. */
export function globeZoom(height: number, fill = 0.98): number {
  const radius = (Math.max(1, height) * fill) / 2
  return Math.max(0.5, Math.min(4.5, Math.log2(radius / RADIUS_AT_ZOOM_0)))
}
