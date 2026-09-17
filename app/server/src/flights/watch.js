/* The airports, looking at the trip's legs without being asked.
 *
 * Every minute, for every flight leg leaving within the next thirty hours or
 * landed within the last four: the board at each end is read (once per
 * airport, whoever is watching it), the leg's record found on it, and what
 * the board says compared with what the leg says. What differs is written
 * onto the leg — the gate, the terminal, the departure and everything that
 * hangs off it, the arrival, a cancellation — and said as a sentence in the
 * leg's status note, and the change is kept as an event so the phone can
 * tell somebody and a wrong one can be understood afterwards.
 *
 * The comparison is against the last snapshot when there is one and against
 * the leg as typed when there is not, so the first look at a board already
 * saying "delayed" is news.
 *
 * Boards are public and this reads nothing of anybody's, so unlike the
 * mailbox watch it is on for every leg whose airport it knows. */

import { event, span } from '../tracing.js'
import { describeFlightEvent, detectFlightEvents } from './events.js'
import { bestArrival, bestDeparture, flightNumberOf, matchFlight } from './model.js'
import { callsignFor, verdictFromPosition } from './providers/adsb.js'

export const WATCH_EVERY_MS = 60_000
export const WATCH_BEFORE_MS = 30 * 60 * 60 * 1000
export const WATCH_AFTER_MS = 4 * 60 * 60 * 1000

/* The transponder is asked only when a board should have said something
   and has not: twenty minutes past the best-known departure with the
   status still "scheduled". Once every ten minutes per leg, because the
   network's rate limit is theirs to set. */
const ADSB_SILENCE_MS = 20 * 60_000
const ADSB_EVERY_MS = 10 * 60_000

const SEGMENT_STATUS = { cancelled: 'cancelled', done: 'arrived', delayed: 'delayed' }

/** The leg as the traveller typed it, in the board's shape, for a first comparison. */
export function baselineFromSegment(segment) {
  return {
    flightNumber: flightNumberOf(segment),
    status: SEGMENT_STATUS[segment.status] || 'scheduled',
    scheduledDeparture: segment.departsAt || null,
    scheduledArrival: segment.arrivesAt || null,
    gate: segment.gate || null,
    terminal: segment.terminal || null,
    baggageBelt: null,
    boardingStatus: null,
    aircraft: null,
  }
}

/**
 * Both ends of one flight as one view: the origin's departures board knows
 * the gate and when it leaves; the destination's arrivals board knows the
 * belt and when it lands. Where both have an opinion about the status, the
 * later stage wins — landed outranks departed outranks boarding.
 */
export function mergeBoards(departure, arrival) {
  if (!departure && !arrival) return null
  const base = departure || arrival
  const view = {
    ...base,
    sources: [departure?.source, arrival?.source].filter(Boolean),
  }
  if (arrival) {
    view.scheduledArrival = arrival.scheduledArrival
    view.estimatedArrival = arrival.estimatedArrival
    view.actualArrival = arrival.actualArrival
    view.baggageBelt = arrival.baggageBelt
    view.arrivalTerminal = arrival.terminal
    view.origin = departure?.origin || arrival.origin
    view.destination = arrival.destination || departure?.destination || null
    if (['landed', 'arrived', 'diverted', 'cancelled'].includes(arrival.status)) {
      view.status = arrival.status
      view.statusText = arrival.statusText
    }
  }
  if (departure && arrival) {
    view.lastUpdated = [departure.lastUpdated, arrival.lastUpdated].sort().pop()
  }
  return view
}

/** What to write onto the leg so it says what the boards say. */
export function changesFor(segment, view) {
  const changes = {}
  if (view.gate && view.gate !== (segment.gate || null)) changes.gate = view.gate
  if (view.terminal && view.terminal !== (segment.terminal || null))
    changes.terminal = view.terminal
  const departs =
    view.direction === 'departure' || view.scheduledDeparture ? bestDeparture(view) : null
  if (departs && Math.abs(new Date(departs) - new Date(segment.departsAt)) >= 60_000) {
    changes.departsAt = departs
  }
  const arrives = bestArrival(view)
  if (
    arrives &&
    (!segment.arrivesAt || Math.abs(new Date(arrives) - new Date(segment.arrivesAt)) >= 60_000)
  ) {
    changes.arrivesAt = arrives
  }
  if (view.status === 'cancelled' && segment.status !== 'cancelled') changes.status = 'cancelled'
  return changes
}

const dayAt = (iso, zone) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'UTC' }).format(new Date(iso))
  } catch {
    return new Date(iso).toISOString().slice(0, 10)
  }
}

/* The sentence for the status note: the most consequential event, with
   where it came from and when, in the airport's clock. */
const NOTE_ORDER = [
  'FlightCancelled',
  'FlightDiverted',
  'FlightDelayed',
  'FlightRescheduled',
  'GateChanged',
  'TerminalChanged',
  'BoardingStarted',
  'BoardingEnded',
  'FlightDeparted',
  'FlightLanded',
  'ArrivalEstimateChanged',
  'BaggageUpdated',
  'AircraftChanged',
]

export function noteFor(events, { flight, zone, sourceName, at }) {
  const said = [...events].sort(
    (a, b) => NOTE_ORDER.indexOf(a.type) - NOTE_ORDER.indexOf(b.type),
  )[0]
  if (!said) return null
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone || 'UTC',
  }).format(new Date(at))
  return `${describeFlightEvent(said, { flight, zone })} ${sourceName}, ${clock}.`
}

/**
 * One pass over every leg worth watching.
 *
 * @param {object} deps
 * @param {object} deps.repository   flightLegsToWatch, flightSnapshot, saveFlightSnapshot, recordFlightEvents, applyFlightUpdate
 * @param {ReturnType<import('./registry.js').createFlightSources>} deps.sources
 * @param {(tripId: string, kind: string) => void} [deps.announce]
 * @param {number} [deps.now]
 * @param {object} [deps.log]
 * @param {Map<string, number>} [deps.asked]  when the transponder was last asked per leg
 */
export async function watchFlights({
  repository,
  sources,
  announce = () => {},
  now = Date.now(),
  log = null,
  asked = new Map(),
}) {
  const legs = await repository.flightLegsToWatch({
    now,
    beforeMs: WATCH_BEFORE_MS,
    afterMs: WATCH_AFTER_MS,
  })
  const stats = { legs: legs.length, matched: 0, changed: 0, events: 0, unwatched: 0 }

  for (const leg of legs) {
    try {
      const number = flightNumberOf(leg)
      const from = sources.providerFor(leg.fromCode)
      const to = sources.providerFor(leg.toCode)
      if (!number || (!from && !to)) {
        stats.unwatched += 1
        continue
      }

      const departureBoard = from
        ? await sources.board(from.airportCode, 'departure', dayAt(leg.departsAt, from.zone))
        : null
      const arrivalBoard = to
        ? await sources.board(
            to.airportCode,
            'arrival',
            dayAt(leg.arrivesAt || leg.departsAt, to.zone),
          )
        : null
      const departure = matchFlight(departureBoard?.value, number, leg.departsAt)
      const arrival = matchFlight(arrivalBoard?.value, number, leg.arrivesAt || leg.departsAt)
      let view = mergeBoards(departure, arrival)

      /* A board that should have said "departed" and has not: ask the sky. */
      const snapshot = await repository.flightSnapshot(leg.id)
      const known = view || snapshot?.info || null
      const leaves = bestDeparture(known) || leg.departsAt
      const silent =
        known &&
        !['departed', 'landed', 'arrived', 'cancelled', 'diverted'].includes(known.status) &&
        now - new Date(leaves).getTime() > ADSB_SILENCE_MS
      if (silent && now - (asked.get(leg.id) || 0) > ADSB_EVERY_MS && sources.adsb) {
        asked.set(leg.id, now)
        const callsign = callsignFor(number)
        const aircraft = callsign ? await sources.adsb.byCallsign(callsign).catch(() => null) : null
        const verdict = verdictFromPosition(aircraft, {
          from: leg.fromLat != null ? { lat: leg.fromLat, lon: leg.fromLng } : null,
          to: leg.toLat != null ? { lat: leg.toLat, lon: leg.toLng } : null,
        })
        if (verdict) {
          view = {
            ...(view || snapshot.info),
            status: verdict,
            statusText: `${verdict === 'landed' ? 'On the ground' : 'In the air'} (ADS-B)`,
            aircraft: aircraft.type || (view || snapshot.info).aircraft || null,
            sources: [...((view || snapshot.info).sources || []), sources.adsb.source],
            lastUpdated: new Date(now).toISOString(),
          }
        }
      }
      if (!view) continue
      stats.matched += 1

      const previous = snapshot?.info || baselineFromSegment(leg)
      const events = detectFlightEvents(previous, view)
      const changes = changesFor(leg, view)
      const zone = from?.zone || to?.zone
      if (events.length) {
        const note = noteFor(events, {
          flight: number,
          zone,
          sourceName: sourceNameOf(view.sources?.[0] || view.source),
          at: now,
        })
        if (note) changes.statusNote = note
      }

      if (Object.keys(changes).length) {
        await repository.applyFlightUpdate(leg.id, changes)
        stats.changed += 1
      }
      if (events.length) {
        const stamped = events.map(one => ({
          ...one,
          text: describeFlightEvent(one, { flight: number, zone }),
          source: view.sources?.[0] || view.source,
          at: new Date(now).toISOString(),
        }))
        stats.events += await repository.recordFlightEvents(leg.id, stamped)
      }
      await repository.saveFlightSnapshot(leg.id, {
        info: view,
        fetchedAt: new Date(now).toISOString(),
      })
      if (events.length || Object.keys(changes).length) announce(leg.tripId, 'segments')
    } catch (error) {
      log?.warn?.({ err: error, segment: leg.id }, 'flight watch failed for a leg')
      event('flights.watch.failed', { 'segment.id': leg.id, 'error.message': error?.message })
    }
  }
  return stats
}

const SOURCE_NAMES = {
  'api.dublinairport.com': 'Dublin Airport',
  'yqr.simpleway.cloud': 'Regina Airport',
  'www.torontopearson.com': 'Toronto Pearson',
  'gtaa-fl-prod.azureedge.net': 'Toronto Pearson',
  'api.adsb.lol': 'ADS-B',
}
export const sourceNameOf = source => SOURCE_NAMES[source] || source || 'the airport'

/** The timer, started once on boot beside the others. A pass still running
    when the next tick comes is left to finish: a board that is being asked
    slowly must not be asked twice at once. */
export function startFlightWatch({ repository, sources, announce, log, every = WATCH_EVERY_MS }) {
  const asked = new Map()
  let running = null
  const run = () => {
    if (running) return running
    running = span('flights.watch', {}, () =>
      watchFlights({ repository, sources, announce, log, asked }),
    )
      .then(stats => {
        if (stats.changed || stats.events) {
          log?.info?.({ evt: 'flights.watch', ...stats }, 'the airports said something')
        }
      })
      .catch(error => log?.warn?.({ err: error }, 'flight watch failed'))
      .finally(() => {
        running = null
      })
    return running
  }
  const timer = setInterval(run, every)
  timer.unref?.()
  return { run, stop: () => clearInterval(timer) }
}
