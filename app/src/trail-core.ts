import type { Coordinates } from './shared/model/types'

/* Where the phones actually went, turned into lines worth drawing.

   Raw fixes are not a path: they jitter sideways a few metres at a time, they
   stop for hours when a phone goes dark and then resume across town, and every
   device interleaves with every other. Drawn naively that renders as scribble,
   plus long false straights across the map. Three rules fix it:

   - only fixes accurate enough to trust are drawn at all,
   - a long gap in time starts a new line — nobody walked the straight line
     from the hotel at midnight to the airport at nine,
   - runs of near-collinear points collapse (Douglas–Peucker), so a walk down
     one street is one stroke rather than forty wobbles. */

export interface TrailFix {
  deviceId?: string | null
  lng: number
  lat: number
  at?: Date | null
  accuracy?: number | null
}

export const TRAIL_MAX_ACCURACY_METRES = 80
export const TRAIL_GAP_MS = 20 * 60_000
export const TRAIL_TOLERANCE_METRES = 6

const METRES_PER_DEGREE = 111_320

/* Perpendicular distance from a point to a segment, in metres, on a locally
   flattened earth — plenty for tolerances of a few metres. */
function offLine(point: Coordinates, a: Coordinates, b: Coordinates, latScale: number) {
  const px = (point[0] - a[0]) * latScale,
    py = point[1] - a[1]
  const bx = (b[0] - a[0]) * latScale,
    by = b[1] - a[1]
  const lengthSq = bx * bx + by * by
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq))
  const dx = px - t * bx,
    dy = py - t * by
  return Math.sqrt(dx * dx + dy * dy) * METRES_PER_DEGREE
}

export function simplifyLine(
  points: Coordinates[],
  toleranceMetres = TRAIL_TOLERANCE_METRES,
): Coordinates[] {
  if (points.length <= 2) return points
  const latScale = Math.cos((points[0][1] * Math.PI) / 180) || 1e-6
  const keep = new Array(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let worst = 0,
      index = -1
    for (let i = first + 1; i < last; i++) {
      const distance = offLine(points[i], points[first], points[last], latScale)
      if (distance > worst) {
        worst = distance
        index = i
      }
    }
    if (index !== -1 && worst > toleranceMetres) {
      keep[index] = true
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

export function buildTrail(
  fixes: TrailFix[],
  {
    maxAccuracy = TRAIL_MAX_ACCURACY_METRES,
    gapMs = TRAIL_GAP_MS,
    tolerance = TRAIL_TOLERANCE_METRES,
  }: { maxAccuracy?: number; gapMs?: number; tolerance?: number } = {},
): Coordinates[][] {
  const byDevice = new Map<string, TrailFix[]>()
  for (const fix of fixes) {
    if (fix.accuracy != null && fix.accuracy > maxAccuracy) continue
    const key = String(fix.deviceId ?? '')
    if (!byDevice.has(key)) byDevice.set(key, [])
    byDevice.get(key)!.push(fix)
  }
  const lines: Coordinates[][] = []
  for (const device of byDevice.values()) {
    device.sort((a, b) => (a.at?.getTime?.() ?? 0) - (b.at?.getTime?.() ?? 0))
    let run: TrailFix[] = []
    const flush = () => {
      if (run.length > 1) {
        const line = simplifyLine(
          run.map(fix => [fix.lng, fix.lat] as Coordinates),
          tolerance,
        )
        if (line.length > 1) lines.push(line)
      }
      run = []
    }
    for (const fix of device) {
      const previous = run[run.length - 1]
      if (previous?.at && fix.at && fix.at.getTime() - previous.at.getTime() > gapMs) flush()
      run.push(fix)
    }
    flush()
  }
  return lines
}
