import { segmentName, type Segment } from './segments-core'

/* The plane on the map — pure.
 *
 * While a flight leg is plausibly in the air the server relays where the
 * transponder network last heard it; this decides which leg that is and
 * turns the answer into a marker with a heading and a title. The window is
 * the server's window, so nothing is asked that would be refused. */

const OVER = new Set(['landed', 'arrived', 'cancelled', 'diverted'])

const at = (iso: unknown): number | null => {
  const when = Date.parse(String(iso ?? ''))
  return Number.isFinite(when) ? when : null
}

/** What the transponder network heard, as the server relays it. */
export interface AircraftHeard {
  callsign: string | null
  registration: string | null
  type: string | null
  onGround: boolean
  airborne: boolean
  altitudeFeet: number | null
  groundSpeedKnots: number | null
  trackDegrees: number | null
  lat: number | null
  lon: number | null
  heardAt: string | null
}

export interface PlaneOnMap {
  key: string
  lng: number
  lat: number
  /** degrees clockwise from north, or null when the network did not say */
  heading: number | null
  title: string
  airborne: boolean
  heardAt: string | null
}

/* The sky is asked from a little before a leg is due to leave to a while
   after it was due to land — the same window the server answers for. */
export const PLANE_BEFORE_MS = 30 * 60_000
export const PLANE_AFTER_MS = 2 * 3600_000
export const PLANE_EVERY_MS = 60_000

/** The flight leg worth asking the sky about right now, or null. */
export function airborneLeg(segments: readonly Segment[], now: number): Segment | null {
  for (const leg of segments) {
    if (leg.mode !== 'flight' || leg.status === 'cancelled' || leg.status === 'done') continue
    const status = leg.flight?.status
    if (status && OVER.has(status)) continue
    const departs = at(leg.departsAt)
    if (departs === null) continue
    const arrives = at(leg.arrivesAt) ?? departs
    if (now >= departs - PLANE_BEFORE_MS && now <= arrives + PLANE_AFTER_MS) return leg
  }
  return null
}

/** The marker for what was heard, or null when nothing was. */
export function planeOnMap(
  leg: Segment,
  heard: AircraftHeard | null,
  now: number,
): PlaneOnMap | null {
  if (!heard || heard.lat === null || heard.lon === null) return null
  const number = String(leg.number ?? '').trim()
  const name = /^[A-Z0-9]{2}\s?\d/i.test(number)
    ? number
    : segmentName({ carrier: leg.carrier, number: leg.number })
  const when = at(heard.heardAt)
  const age =
    when === null
      ? ''
      : (() => {
          const minutes = Math.max(0, Math.round((now - when) / 60_000))
          return minutes < 1
            ? 'just now'
            : minutes < 60
              ? `${minutes} min ago`
              : `${Math.round(minutes / 60)} h ago`
        })()
  const state = heard.airborne
    ? `in the air${heard.altitudeFeet ? ` at ${Math.round(heard.altitudeFeet / 100) * 100} ft` : ''}`
    : 'on the ground'
  return {
    key: `plane:${leg.id}`,
    lng: heard.lon,
    lat: heard.lat,
    heading: heard.trackDegrees,
    title: [name, state, age ? `heard ${age}` : ''].filter(Boolean).join(' · '),
    airborne: heard.airborne,
    heardAt: heard.heardAt,
  }
}
