import { aircraftName } from './cabin-core'
import {
  flightPhases,
  flightSource,
  ticketColumns,
  type FlightPhase,
  type FlightTone,
  type SourceLine,
  type TicketColumn,
} from './flight-day-core'
import { flightTimeLeft } from './flight-left-core'
import { localTime, segmentName, type Segment } from './segments-core'
import { legDay } from './travel-order-core'

/* A leg's own screen, the way an airline's app draws a flight: the answer
   on top, the two ends of the journey large with their times, what the
   airport has said laid out as a board, and the day as a list from check-in
   to the belt. Everything here is already on the ticket somewhere; the
   screen is the same facts with room to breathe, and a note on each step
   that the ticket's columns had no room for. */

export interface ScreenEnd {
  code: string
  name: string
  /** the time to plan by: the board's estimate or actual when it has one */
  time: string
  /** the time it was before the board moved it, or null when the plan held */
  was: string | null
  day: string
}

export interface ScreenStep extends FlightPhase {
  /** what the ticket's columns had no room to say under this step */
  note: string | null
}

export interface FlightScreenModel {
  title: string
  date: string
  status: { text: string; tone: FlightTone }
  from: ScreenEnd
  to: ScreenEnd
  /** "9 h 30" from the departure to plan by to the arrival to plan by */
  duration: string | null
  aircraft: string | null
  board: TicketColumn[]
  steps: ScreenStep[]
  people: Array<{ name: string; seat: string | null }>
  bags: string | null
  ref: string | null
  cost: string | null
  source: SourceLine | null
  note: string | null
}

const parse = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const value = Date.parse(iso)
  return Number.isFinite(value) ? value : null
}

/* The minute the board says, and the minute it said before that, as two
   clocks — the second only when it differs, because a strike-through under
   the same time is noise. */
function clocks(
  planned: string | null | undefined,
  moved: string | null | undefined,
  tz: string | null | undefined,
): { time: string; was: string | null } {
  const time = localTime(moved || planned, tz)
  const before = localTime(planned, tz)
  return { time, was: moved && planned && before !== time ? before : null }
}

export function spanWords(from: number | null, to: number | null): string | null {
  if (from === null || to === null || to <= from) return null
  const minutes = Math.round((to - from) / 60_000)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} min`
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`
}

function stepNote(step: FlightPhase, segment: Segment): string | null {
  const flight = segment.flight || null
  switch (step.key) {
    case 'checkinClosesAt': {
      const zone = flight?.checkinZone
        ? /^\d+$/.test(flight.checkinZone)
          ? `Zone ${flight.checkinZone}`
          : flight.checkinZone
        : null
      const desks = flight?.checkinDesks ? `Desks ${flight.checkinDesks.replace('-', '–')}` : null
      return [zone, desks].filter(Boolean).join(' · ') || null
    }
    case 'bagsCloseAt':
      return segment.bags?.checked ? `Checked ${segment.bags.checked}` : null
    case 'goToGate': {
      const gate = segment.gate || flight?.gate
      const walk = flight?.walkMinutes ? `${flight.walkMinutes} min walk` : null
      return [gate ? `Gate ${gate}` : null, walk].filter(Boolean).join(' · ') || null
    }
    case 'boardingAt': {
      const gate = segment.gate || flight?.gate
      return gate ? `Gate ${gate}${segment.gateWas ? ` (was ${segment.gateWas})` : ''}` : null
    }
    case 'departs': {
      const planned = flight?.scheduledDeparture || segment.departsWas || null
      const moved = flight?.actualDeparture || flight?.estimatedDeparture || null
      const { was } = clocks(planned, moved, segment.departTz)
      return was ? `Scheduled ${was}` : null
    }
    case 'lands': {
      const belt = flight?.baggageBelt ? `Baggage belt ${flight.baggageBelt}` : null
      const planned = flight?.scheduledArrival || segment.arrivesAt || null
      const moved = flight?.actualArrival || flight?.estimatedArrival || null
      const { was } = clocks(planned, moved, segment.arriveTz)
      return [was ? `Scheduled ${was}` : null, belt].filter(Boolean).join(' · ') || null
    }
    default:
      return null
  }
}

export function flightScreen(segment: Segment, now: number): FlightScreenModel {
  const flight = segment.flight || null
  const departure = clocks(
    flight?.scheduledDeparture || segment.departsWas || segment.departsAt,
    flight?.actualDeparture ||
      flight?.estimatedDeparture ||
      (segment.departsWas ? segment.departsAt : null),
    segment.departTz,
  )
  const arrival = clocks(
    flight?.scheduledArrival || segment.arrivesAt,
    flight?.actualArrival || flight?.estimatedArrival || null,
    segment.arriveTz,
  )
  const leaves = parse(flight?.actualDeparture || flight?.estimatedDeparture || segment.departsAt)
  const lands = parse(flight?.actualArrival || flight?.estimatedArrival || segment.arrivesAt)
  const bags = segment.bags
  return {
    title: segmentName({ carrier: segment.carrier, number: segment.number, mode: segment.mode }),
    date: legDay(segment.departsAt, segment.departTz),
    status: flightTimeLeft(segment, now),
    from: {
      code: segment.fromCode || segment.fromName,
      name: segment.fromName,
      ...departure,
      day: legDay(segment.departsAt, segment.departTz),
    },
    to: {
      code: segment.toCode || segment.toName,
      name: segment.toName,
      ...arrival,
      day: legDay(segment.arrivesAt, segment.arriveTz),
    },
    duration: spanWords(leaves, lands),
    aircraft:
      aircraftName(segment.aircraft || segment.flight?.aircraft) ||
      (segment.flight?.usualAircraft
        ? `${aircraftName(segment.flight.usualAircraft)} · usually`
        : null),
    board: ticketColumns(segment),
    steps: flightPhases(segment, now).map(step => ({ ...step, note: stepNote(step, segment) })),
    people: segment.passengers.map(person => ({ name: person.name, seat: person.seat || null })),
    bags:
      bags?.checked || bags?.carryOn
        ? [bags.checked && `Checked ${bags.checked}`, bags.carryOn && `Carry-on ${bags.carryOn}`]
            .filter(Boolean)
            .join(' · ')
        : null,
    ref: segment.ref || null,
    cost:
      segment.costAmount != null
        ? `${segment.costAmount} ${segment.costCurrency || ''}`.trim()
        : null,
    source: flightSource(segment, now),
    note:
      segment.statusNote && segment.statusNote !== segment.flight?.note ? segment.statusNote : null,
  }
}
