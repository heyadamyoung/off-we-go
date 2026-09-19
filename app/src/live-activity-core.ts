import { flightHeadline } from './flight-day-core'
import { landedSegments } from './segment-arrival-core'
import {
  delayLabel,
  makeIt,
  MODE_GLYPH,
  nextDeadline,
  segmentName,
  type Segment,
  type SegmentDeadlines,
  type Traveller,
} from './segments-core'
import type { LiveFix } from './shared/model/types'

/* What the card on the Lock Screen says, and when there is one at all.
 *
 * On a travel day somebody looks at their phone thirty times and opens the
 * app twice. The Live Activity is the other twenty-eight glances: the leg,
 * the gate, what the countdown is to, and whether they are going to make it —
 * without unlocking, without finding the app, without the tab that Travel
 * turned out to be on the last trip.
 *
 * A function of the legs, the family's positions and a clock, like the rest
 * of the getting-there layer. The countdown is not in here: the system draws
 * it from the deadline, so the state only changes when something real does —
 * a gate, a delay, boarding, wheels down — and only then is the card redrawn.
 */

/* Apple ends an Activity after eight hours whatever the app does, so a card
   that went up the night before would be stale by the time it was wanted. It
   appears when somebody would plausibly be setting off. */
export const ACTIVITY_BEFORE_MS = 4 * 3600_000
/* With no trail to say they landed, a leg is over a little after it was due
   to be — planes are late more often than early, and "Lands: now" for twenty
   minutes is more honest than "Landed" on a plane still circling. */
export const LANDED_GRACE_MS = 20 * 60_000
/* The card says Landed and then goes, rather than vanishing the moment it
   would have been the nicest thing to see. */
export const HOLD_AFTER_LANDING_MS = 15 * 60_000

export type ActivityPhase = 'before' | 'boarding' | 'airborne' | 'landed'

export interface ActivityAttributes {
  segmentId: string
  mode: Segment['mode']
  glyph: string
  /** "KL 677" — the carrier dropped when the number carries it */
  title: string
  /** "AMS", or the name when there is no code */
  from: string
  to: string
  fromName: string
  toName: string
}

export interface ActivityState {
  phase: ActivityPhase
  status: Segment['status']
  gate: string | null
  gateWas: string | null
  terminal: string | null
  platform: string | null
  /** what the countdown is to: "Boarding", "Doors close", "Lands" */
  deadlineLabel: string
  /** null once there is nothing left to count to */
  deadlineAt: string | null
  departsAt: string
  arrivesAt: string | null
  /** "25 min later", or nothing to say */
  moved: string
  /** the make-it meter's word, when there are positions to judge by */
  verdict: 'here' | 'ok' | 'tight' | 'late' | null
  verdictWord: string
  /** the Travel tab's own sentence — "On time · gate E19", "Boarding · gate
      E19", "Landed 16:02 · baggage claim belt 14" — less any countdown,
      which the system draws itself and which would otherwise redraw the
      card every minute */
  headline: string
  /** the belt, once the board has named one: the last thing the card can say */
  belt: string | null
}

export interface TravelActivity {
  attributes: ActivityAttributes
  state: ActivityState
}

/* The deadline labels as a card wants them: a noun over a timer, not a
   sentence. "Check-in by" reads as a time; "Check-in closes" reads as a
   countdown. */
const CARD_LABELS: Record<keyof SegmentDeadlines, string> = {
  checkinOpensAt: 'Check-in opens',
  checkinClosesAt: 'Check-in closes',
  bagsCloseAt: 'Bag drop closes',
  boardingAt: 'Boarding',
  doorsAt: 'Doors close',
}

const VERDICT_WORDS = {
  here: 'Here',
  ok: 'On pace',
  tight: 'Cutting it close',
  late: 'Too far out',
} as const

const at = (iso: unknown): number | null => {
  const when = Date.parse(String(iso ?? ''))
  return Number.isFinite(when) ? when : null
}

/**
 * The card for this moment, or null when there is nothing to put up.
 *
 * The leg on it is the first one in the day that is live and not yet over —
 * so a train to the airport hands the card to the flight the moment the
 * train is done. Only the last leg of the day gets to say Landed: for any
 * other, the next leg is already the better thing to show.
 */
export function travelActivity(
  segments: readonly Segment[] | null | undefined,
  travellers: readonly Traveller[],
  fixes: readonly LiveFix[] | null | undefined,
  now: number,
): TravelActivity | null {
  const legs = (segments || [])
    .filter(leg => leg && leg.status !== 'done' && at(leg.departsAt) !== null)
    .sort((a, b) => (at(a.departsAt) as number) - (at(b.departsAt) as number))
  const arrivesOf = (leg: Segment) => at(leg.arrivesAt) ?? (at(leg.departsAt) as number)
  const live = legs.filter(
    leg =>
      now >= (at(leg.departsAt) as number) - ACTIVITY_BEFORE_MS &&
      now <= arrivesOf(leg) + LANDED_GRACE_MS + HOLD_AFTER_LANDING_MS,
  )
  if (!live.length) return null

  // The airport's board says so first when there is one; the trail knows
  // before the airline's app does; a scheduled arrival long enough ago
  // counts too, for a phone that stayed in a pocket.
  const landedIds = new Set(landedSegments(live, fixes))
  const boardSays = (leg: Segment) => leg.flight?.status ?? null
  const isLanded = (leg: Segment) =>
    ['landed', 'arrived'].includes(boardSays(leg) || '') ||
    landedIds.has(leg.id) ||
    now >= arrivesOf(leg) + LANDED_GRACE_MS
  const leg = live.find(candidate => !isLanded(candidate)) ?? live[live.length - 1]

  const departs = at(leg.departsAt) as number
  const boardingAt = at(leg.deadlines?.boardingAt)
  const boarding = ['go-to-gate', 'boarding', 'final-call', 'closed'].includes(
    leg.flight?.boardingStatus || '',
  )
  const phase: ActivityPhase = isLanded(leg)
    ? 'landed'
    : boardSays(leg) === 'departed' || now >= departs
      ? 'airborne'
      : boarding || (boardingAt !== null && now >= boardingAt)
        ? 'boarding'
        : 'before'

  const flying = leg.mode === 'flight'
  let deadlineLabel: string
  let deadlineAt: string | null
  if (phase === 'landed') {
    deadlineLabel = flying ? 'Landed' : 'Arrived'
    deadlineAt = null
  } else if (phase === 'airborne') {
    deadlineLabel = flying ? 'Lands' : 'Arrives'
    deadlineAt = leg.arrivesAt ?? null
  } else {
    const next = nextDeadline(leg, now)
    deadlineLabel = next ? CARD_LABELS[next.key] : 'Departs'
    deadlineAt = next ? next.at : leg.departsAt
  }

  /* A verdict about reaching a gate is only a verdict before you have. */
  let verdict: ActivityState['verdict'] = null
  if ((phase === 'before' || phase === 'boarding') && travellers.length) {
    const met = makeIt(leg, [...travellers], now)
    if (met) {
      const worst = met.verdict
      verdict = met.people.every(person => person.state === 'here')
        ? 'here'
        : worst === 'late' || worst === 'tight'
          ? worst
          : 'ok'
    }
  }

  const said = segmentName({ carrier: leg.carrier, number: leg.number })
  const headline = cardHeadline(leg, now)
  return {
    attributes: {
      segmentId: leg.id,
      mode: leg.mode,
      glyph: MODE_GLYPH[leg.mode],
      title: said === 'Journey' ? `To ${leg.toName}` : said,
      from: leg.fromCode || leg.fromName,
      to: leg.toCode || leg.toName,
      fromName: leg.fromName,
      toName: leg.toName,
    },
    state: {
      phase,
      status: leg.status,
      gate: leg.gate ?? null,
      gateWas: leg.gateWas ?? null,
      terminal: leg.terminal ?? null,
      platform: leg.platform ?? null,
      deadlineLabel,
      deadlineAt,
      departsAt: leg.departsAt,
      arrivesAt: leg.arrivesAt ?? null,
      moved: delayLabel(leg),
      verdict,
      verdictWord: verdict ? VERDICT_WORDS[verdict] : '',
      headline,
      belt: leg.flight?.baggageBelt || null,
    },
  }
}

/* The Travel tab's headline as the card wants it: the same words, without
   the phrase that counts — "check-in closes in 2 h 57" is a countdown the
   system already draws, and a sentence that changes every minute is a card
   redrawn every minute. */
export function cardHeadline(leg: Segment, now: number): string {
  return flightHeadline(leg, now)
    .text.split(' · ')
    .filter(piece => !/\bin \d/.test(piece) && !/^leaves (in|now)/.test(piece))
    .join(' · ')
}

/** Whether two cards say the same thing — the system ticks the countdown, so
 *  a minute passing is not a change. */
export function sameActivity(a: TravelActivity | null, b: TravelActivity | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}
