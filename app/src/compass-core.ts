import type { Coordinates } from './shared/model/types'

/* The maths of "which way": reading a facing out of the browser's orientation
   events, and turning a needle the short way round. Pure on purpose — the
   sensors are unplayable in a test, the arithmetic is not. */

export interface OrientationReading {
  alpha?: number | null
  absolute?: boolean
  webkitCompassHeading?: number | null
}

const normalize = (degrees: number) => ((degrees % 360) + 360) % 360

/* What the phone's compass says, as degrees clockwise from north.

   Two dialects: iOS speaks webkitCompassHeading, already clockwise-from-north;
   everyone else speaks alpha, counterclockwise and only trustworthy when the
   event calls itself absolute — a relative alpha is "since the page loaded",
   which is a random lie of an origin. The screen angle folds in so a phone
   held sideways still points where its screen-up points. */
export function headingFromEvent(event: OrientationReading, screenAngle = 0): number | null {
  const webkit = event.webkitCompassHeading
  if (typeof webkit === 'number' && Number.isFinite(webkit)) return normalize(webkit)
  if (event.absolute && typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    return normalize(360 - event.alpha + screenAngle)
  }
  return null
}

/** The signed short way from one heading to another, in (-180, 180]. */
export function shortestTurn(from: number, to: number): number {
  const raw = normalize(to) - normalize(from)
  return raw > 180 ? raw - 360 : raw <= -180 ? raw + 360 : raw
}

/* A needle animated with CSS must never take the long way round: 350° to 10°
   is a 20° nudge, not a 340° pirouette. So the rendered rotation is cumulative
   — free to read 370 or -40 — and each new heading adds only its short turn. */
export function turnTowards(current: number | null, next: number): number {
  if (current == null || !Number.isFinite(current)) return normalize(next)
  return current + shortestTurn(current, next)
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingBetween(a: Coordinates, b: Coordinates): number {
  const toRad = Math.PI / 180
  const dLng = (b[0] - a[0]) * toRad
  const lat1 = a[1] * toRad
  const lat2 = b[1] * toRad
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return normalize((Math.atan2(y, x) * 180) / Math.PI)
}
