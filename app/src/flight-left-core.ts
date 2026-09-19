import type { FlightTone } from './flight-day-core'
import { dueLabel } from './live-progress-copy-core'
import { nextDeadline, type Segment, type SegmentDeadlines } from './segments-core'

/* What is left, in one line — pure.
 *
 * The ticket under this line already says everything that is a fact: the
 * times, the old time struck through beside the new one, the gate, the
 * belt. A line on top that reads "Departed 12:13 · lands 13:20" said all of
 * it twice, and "delayed 3 min later" a third time. What the ticket cannot
 * say is how long there is: a landing time is in the far end's clock, and a
 * family in the air want "41 min", not arithmetic across a time zone. So
 * this says the one thing the clock knows and the ticket does not — how
 * long until the next thing, and after that how long until the ground. */

const LANDED = new Set(['landed', 'arrived'])

const at = (iso: unknown): number | null => {
  const when = Date.parse(String(iso ?? ''))
  return Number.isFinite(when) ? when : null
}

const minutesUntil = (when: number, now: number) => (when - now) / 60_000

/* The deadline as a sentence starts: "Check-in closes in 42 min". */
const NEXT_WORDS: Record<keyof SegmentDeadlines, string> = {
  checkinOpensAt: 'Check-in opens',
  checkinClosesAt: 'Check-in closes',
  bagsCloseAt: 'Bags close',
  boardingAt: 'Boarding',
  doorsAt: 'Doors close',
}

/**
 * The one line for a leg on its day, and its tone: how long until the next
 * thing that has to happen, then how long until it leaves, then how long
 * until it lands, then how long ago it did. Never a time, never a gate,
 * never the size of a delay — the ticket carries those.
 */
export function flightTimeLeft(segment: Segment, now: number): { text: string; tone: FlightTone } {
  const flight = segment.flight || null
  const status = flight?.status || null
  const flying = segment.mode === 'flight'
  if (segment.status === 'cancelled' || status === 'cancelled')
    return { text: 'Cancelled', tone: 'late' }
  if (status === 'diverted') return { text: 'Diverted', tone: 'late' }

  const lands = at(
    flight?.actualArrival ||
      flight?.estimatedArrival ||
      flight?.scheduledArrival ||
      segment.arrivesAt,
  )
  const down = flying ? 'landed' : 'arrived'
  if (status && LANDED.has(status)) {
    /* The bags out is the last word, and the one the hall wants. */
    if (flight?.bagsInHall)
      return {
        text: `Bags in the hall${flight.baggageBelt ? ` · belt ${flight.baggageBelt}` : ''}`,
        tone: 'done',
      }
    const word = flying ? 'Landed' : 'Arrived'
    /* An actual behind us is "12 min ago"; an estimate the board has not
       corrected yet is not "in 5 min" — the board says it is down. */
    const ago = lands !== null && lands < now ? ` ${dueLabel(minutesUntil(lands, now))}` : ''
    return { text: `${word}${ago}`, tone: 'done' }
  }

  const departs = at(segment.departsAt) ?? now
  /* Gone: the board said so, or the time passed and no board has called
     it — a plane past its time with a board still saying scheduled is not
     "delayed", it is most likely in the air, and the app says what is due. */
  const gone =
    status === 'departed' ||
    (now >= departs && (!flight || status === 'scheduled' || status === 'unknown'))
  if (gone) {
    if (lands === null) return { text: flying ? 'In the air' : 'On the way', tone: 'ok' }
    const minutes = minutesUntil(lands, now)
    if (minutes < -1) return { text: `Due to have ${down} ${dueLabel(minutes)}`, tone: 'done' }
    const word =
      status === 'departed'
        ? flying
          ? 'Lands'
          : 'Arrives'
        : `Due to ${flying ? 'land' : 'arrive'}`
    return { text: `${word} ${dueLabel(minutes)}`, tone: 'ok' }
  }

  const leaving = `leaves ${dueLabel(minutesUntil(departs, now))}`
  switch (flight?.boardingStatus) {
    case 'final-call':
      return { text: `Final call · ${leaving}`, tone: 'late' }
    case 'closed':
      return { text: `Gate closed · ${leaving}`, tone: 'late' }
    case 'boarding':
      return { text: `Boarding · ${leaving}`, tone: 'tight' }
    case 'go-to-gate':
      return { text: `Go to gate · ${leaving}`, tone: 'tight' }
  }

  const next = nextDeadline(segment, now)
  const nextAt = next ? at(next.at) : null
  const minutes = nextAt !== null && next ? minutesUntil(nextAt, now) : minutesUntil(departs, now)
  const text =
    nextAt !== null && next
      ? `${NEXT_WORDS[next.key]} ${dueLabel(minutes)}`
      : leaving.charAt(0).toUpperCase() + leaving.slice(1)
  return { text, tone: minutes <= 15 ? 'tight' : 'ok' }
}
