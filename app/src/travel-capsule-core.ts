import { flightHeadline, type FlightTone } from './flight-day-core'
import { MODE_GLYPH, segmentFace, segmentName, type Segment } from './segments-core'

/* The one line over the map on a travel day — pure.
 *
 * Which leg the day is about right now, and the pill's words for it:
 * "✈ KL 677 · boarding in 42 min". The headline is flight-day-core's; this
 * only chooses the leg and dresses the line. */

const OVER = new Set(['landed', 'arrived', 'cancelled', 'diverted'])

const at = (iso: unknown): number | null => {
  const when = Date.parse(String(iso ?? ''))
  return Number.isFinite(when) ? when : null
}

/* With no board to say so, a leg is over a little after it was due to be —
   the same grace the Lock Screen card gives a plane the trail has not seen
   land. */
export const OVER_GRACE_MS = 20 * 60_000

/**
 * The leg the day is about right now: the first one on its day that is not
 * over, or the last one that just was, so a landing is still the story for
 * a while. Null on any other day.
 */
export function liveLeg(segments: readonly Segment[], now: number): Segment | null {
  const today = segments.filter(leg => segmentFace(leg, now) === 'day')
  if (!today.length) return null
  const over = (leg: Segment) => {
    const status = leg.flight?.status
    if (leg.status === 'done' || (status && OVER.has(status))) return true
    const arrives = at(leg.arrivesAt) ?? at(leg.departsAt)
    return arrives !== null && now >= arrives + OVER_GRACE_MS
  }
  return today.find(leg => !over(leg)) ?? today[today.length - 1]
}

export type CapsuleTone = 'waiting' | 'heading' | 'approaching' | 'arrived' | 'complete'

const CAPSULE_TONES: Record<FlightTone, CapsuleTone> = {
  ok: 'heading',
  tight: 'approaching',
  late: 'approaching',
  done: 'arrived',
  quiet: 'heading',
}

/** The capsule over the map on a travel day: "✈ KL 677 · boarding in 42 min". */
export function travelCapsule(
  segments: readonly Segment[],
  now: number,
): {
  leg: Segment
  text: string
  meta: string
  tone: CapsuleTone
  title: string
  headline: { text: string; tone: FlightTone }
} | null {
  const leg = liveLeg(segments, now)
  if (!leg) return null
  const headline = flightHeadline(leg, now)
  /* The number alone when it carries its airline — "KL 677" — because the
     pill has one line and "KLM KL 677" spends it saying the airline twice. */
  const number = String(leg.number ?? '').trim()
  const name = /^[A-Z0-9]{2}\s?\d/i.test(number)
    ? number
    : segmentName({ carrier: leg.carrier, number: leg.number })
  const said = name === 'Journey' ? `To ${leg.toName}` : name
  return {
    leg,
    text: `${MODE_GLYPH[leg.mode]} ${said} · ${headline.text}`,
    meta: `${leg.fromCode || leg.fromName} → ${leg.toCode || leg.toName}`,
    tone: CAPSULE_TONES[headline.tone],
    title: said,
    headline,
  }
}
