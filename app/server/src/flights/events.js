/* What changed between two looks at the same flight.
 *
 * Pure: two FlightInfo shapes in, a list of events out. The previous look is
 * the last snapshot when there is one and the leg as the traveller typed it
 * when there is not, so the first sighting of a board already saying
 * "delayed" is news about the plan and not silence about it.
 *
 * Every event carries the old and new value, because the sentence on the
 * phone ("moved from C34 to D12") and the row in the audit table both want
 * both, and a detector that only said "gate changed" would make somebody go
 * and look. */

import { bestArrival, bestDeparture } from './model.js'

export const FLIGHT_EVENT_TYPES = Object.freeze([
  'FlightDelayed',
  'FlightRescheduled',
  'ArrivalEstimateChanged',
  'FlightCancelled',
  'FlightDiverted',
  'GateChanged',
  'TerminalChanged',
  'BoardingStarted',
  'BoardingEnded',
  'BaggageUpdated',
  'AircraftChanged',
  'FlightDeparted',
  'FlightLanded',
])

/* Under this, a new estimate is the board rounding, not the flight moving.
   Airlines re-estimate by the minute; travellers do not want to hear it. */
export const MOVED_THRESHOLD_MINUTES = 5

const minutesBetween = (fromIso, toIso) => {
  const from = fromIso ? new Date(fromIso).getTime() : Number.NaN
  const to = toIso ? new Date(toIso).getTime() : Number.NaN
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.round((to - from) / 60_000)
}

const same = (a, b) => (a ?? null) === (b ?? null)

const BOARDING = new Set(['boarding', 'final-call'])
const GONE = new Set(['departed', 'landed', 'arrived'])

/**
 * @param {import('./model.js').FlightInfo|object|null} previous
 * @param {import('./model.js').FlightInfo} current
 * @returns {Array<{type: string, oldValue: *, newValue: *, minutes?: number}>}
 */
export function detectFlightEvents(previous, current) {
  const events = []
  const was = previous || {}
  const add = (type, oldValue, newValue, extra = {}) =>
    events.push({ type, oldValue: oldValue ?? null, newValue: newValue ?? null, ...extra })

  /* Time first: it is the biggest thing that can change. Compared on the
     best-known departure each side, so an estimate that appears beside an
     unchanged schedule still counts. */
  const departure = minutesBetween(bestDeparture(was), bestDeparture(current))
  if (departure !== null && Math.abs(departure) >= MOVED_THRESHOLD_MINUTES) {
    add(
      departure > 0 ? 'FlightDelayed' : 'FlightRescheduled',
      bestDeparture(was),
      bestDeparture(current),
      {
        minutes: departure,
      },
    )
  }
  const arrival = minutesBetween(bestArrival(was), bestArrival(current))
  if (arrival !== null && Math.abs(arrival) >= MOVED_THRESHOLD_MINUTES) {
    add('ArrivalEstimateChanged', bestArrival(was), bestArrival(current), { minutes: arrival })
  }

  if (current.status === 'cancelled' && was.status !== 'cancelled') {
    add('FlightCancelled', was.status, 'cancelled')
  }
  if (current.status === 'diverted' && was.status !== 'diverted') {
    add('FlightDiverted', was.status, 'diverted')
  }

  /* Places. A first assignment is an event with no old value: "your gate is
     D12" is worth a buzz too. A gate that goes blank is not — boards clear
     a gate after departure, and that is the flight leaving, said below. */
  if (current.gate && !same(was.gate, current.gate)) add('GateChanged', was.gate, current.gate)
  if (current.terminal && !same(was.terminal, current.terminal)) {
    add('TerminalChanged', was.terminal, current.terminal)
  }
  if (current.baggageBelt && !same(was.baggageBelt, current.baggageBelt)) {
    add('BaggageUpdated', was.baggageBelt, current.baggageBelt)
  }
  if (current.aircraft && was.aircraft && !same(was.aircraft, current.aircraft)) {
    add('AircraftChanged', was.aircraft, current.aircraft)
  }

  /* Boarding: entered, then over — over by the gate closing or by the
     flight leaving, whichever the board says first. */
  const boardingNow = BOARDING.has(current.boardingStatus)
  const boardingThen = BOARDING.has(was.boardingStatus)
  if (boardingNow && !boardingThen)
    add('BoardingStarted', was.boardingStatus, current.boardingStatus)
  const overNow = current.boardingStatus === 'closed' || GONE.has(current.status)
  const overThen = was.boardingStatus === 'closed' || GONE.has(was.status)
  if (boardingThen && overNow && !overThen) {
    add('BoardingEnded', was.boardingStatus, current.boardingStatus || current.status)
  }

  /* Gone, and arrived. The actual time is the value when the board gives
     one; the status word when it does not. */
  const departedNow = current.status === 'departed' || !!current.actualDeparture
  const departedThen = was.status === 'departed' || !!was.actualDeparture
  if (departedNow && !departedThen && !GONE.has(was.status)) {
    add('FlightDeparted', bestDeparture(was), current.actualDeparture || bestDeparture(current))
  }
  const landedNow = ['landed', 'arrived'].includes(current.status) || !!current.actualArrival
  const landedThen = ['landed', 'arrived'].includes(was.status) || !!was.actualArrival
  if (landedNow && !landedThen) {
    add('FlightLanded', bestArrival(was), current.actualArrival || bestArrival(current))
  }

  return events
}

/* The sentence a person reads. `flight` is the number they know it by; the
   times are spelt in the zone given, which is the airport's, because "delayed
   to 18:05" in UTC is a puzzle and not a message. */
export function describeFlightEvent(event, { flight, zone = 'UTC' } = {}) {
  const who = flight ? `${flight}` : 'Your flight'
  const at = iso => {
    if (!iso) return ''
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: zone,
      }).format(new Date(iso))
    } catch {
      return ''
    }
  }
  const span = minutes => {
    const total = Math.abs(minutes)
    return total < 60
      ? `${total} minutes`
      : `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}`
  }
  switch (event.type) {
    case 'FlightDelayed':
      return `${who} is delayed by ${span(event.minutes)}${event.newValue ? `, now leaving at ${at(event.newValue)}` : ''}.`
    case 'FlightRescheduled':
      return `${who} now leaves ${span(event.minutes)} earlier${event.newValue ? `, at ${at(event.newValue)}` : ''}.`
    case 'ArrivalEstimateChanged':
      return event.minutes > 0
        ? `${who} now lands ${span(event.minutes)} later${event.newValue ? `, at ${at(event.newValue)}` : ''}.`
        : `${who} now lands ${span(event.minutes)} earlier${event.newValue ? `, at ${at(event.newValue)}` : ''}.`
    case 'FlightCancelled':
      return `${who} has been cancelled.`
    case 'FlightDiverted':
      return `${who} has been diverted.`
    case 'GateChanged':
      return event.oldValue
        ? `${who} has moved from gate ${event.oldValue} to ${event.newValue}.`
        : `${who} boards from gate ${event.newValue}.`
    case 'TerminalChanged':
      return event.oldValue
        ? `${who} has moved from terminal ${event.oldValue} to terminal ${event.newValue}.`
        : `${who} leaves from terminal ${event.newValue}.`
    case 'BoardingStarted':
      return event.newValue === 'final-call' ? `Final call for ${who}.` : `${who} is boarding.`
    case 'BoardingEnded':
      return `Boarding has closed for ${who}.`
    case 'BaggageUpdated':
      return `Bags from ${who} are on belt ${event.newValue}.`
    case 'AircraftChanged':
      return `${who} is now operated by a ${event.newValue}.`
    case 'FlightDeparted':
      return `${who} has departed${event.newValue ? ` at ${at(event.newValue)}` : ''}.`
    case 'FlightLanded':
      return `${who} has landed${event.newValue ? ` at ${at(event.newValue)}` : ''}.`
    default:
      return `${who}: ${event.type}.`
  }
}
