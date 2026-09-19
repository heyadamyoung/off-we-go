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
import { bestArrival, bestDeparture, flightNumberOf, inFlyingWindow, matchFlight } from './model.js'
import { callsignFor, verdictFromPosition } from './providers/adsb.js'
import { keepFarEnd, keepNearEnd } from './quiet.js'

export const WATCH_EVERY_MS = 60_000
export const WATCH_BEFORE_MS = 30 * 60 * 60 * 1000
export const WATCH_AFTER_MS = 4 * 60 * 60 * 1000

/* The transponder is asked only when a board should have said something
   and has not: twenty minutes past the best-known departure with the
   status still "scheduled". Once every ten minutes per leg, because the
   network's rate limit is theirs to set. */
const ADSB_SILENCE_MS = 20 * 60_000
const ADSB_EVERY_MS = 10 * 60_000
/* Before the flying window the sky is asked for the number's earlier
   rotation — a flight that is up for an hour is heard at this cadence. */
const ADSB_EARLY_EVERY_MS = 20 * 60_000

/* The sky, asked, with a failure said rather than swallowed: a network the
   server cannot reach looked exactly like a flight nobody was hearing, and
   was believed for a whole flight. The answer is what was heard, or null. */
async function askSky(sources, callsign, segmentId) {
  try {
    const heard = await sources.adsb.byCallsign(callsign)
    event('flights.sky.asked', {
      'segment.id': segmentId,
      callsign,
      heard: !!heard,
      type: heard?.type || null,
      network: heard?.network || null,
    })
    return heard
  } catch (error) {
    event('flights.sky.failed', {
      'segment.id': segmentId,
      callsign,
      'error.message': error?.message,
    })
    return null
  }
}

const SEGMENT_STATUS = { cancelled: 'cancelled', done: 'arrived', delayed: 'delayed' }
const SETTLED = new Set(['departed', 'landed', 'arrived', 'cancelled', 'diverted'])

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
  if (!departure) {
    /* An arrivals board's gate and terminal are where the flight comes in.
       The leg's gate is where it leaves from, which only the near board
       knows: with that board quiet the view says nothing about leaving, and
       what the near board last said is put back by the watch. Boarding and
       the extras — the desks, the walk to the gate — are the near end's too.
       Taken as the leg's, the far gate was written over the real one hours
       after the flight had left, and announced as a gate change. */
    view.gate = null
    view.terminal = null
    view.boardingStatus = null
    view.extra = undefined
  }
  if (arrival) {
    view.scheduledArrival = arrival.scheduledArrival
    view.estimatedArrival = arrival.estimatedArrival
    view.actualArrival = arrival.actualArrival
    view.baggageBelt = arrival.baggageBelt
    view.arrivalTerminal = arrival.terminal
    view.arrivalGate = arrival.gate
    /* Which aircraft: the near board's word when it has one, else the far
       board's — Regina names the type on its arrivals board, Pearson never
       does, and a leg to Regina wants the seat map to know. */
    view.aircraft = departure?.aircraft || arrival.aircraft || null
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
  /* Landed before departed: a first look at a flight that has already
     landed is news of a landing, and the leaving is history. */
  'FlightLanded',
  'FlightDeparted',
  'ArrivalEstimateChanged',
  'BaggageUpdated',
  'AircraftChanged',
]

const GONE_FOR_GOOD = new Set(['departed', 'landed', 'arrived'])
/* The far end's news: said by the arrivals board, in the far end's clock. */
export const ARRIVAL_SIDE = new Set(['FlightLanded', 'ArrivalEstimateChanged', 'BaggageUpdated'])

export function noteFor(
  events,
  {
    flight,
    zone,
    sourceName,
    at,
    status = null,
    arrivalZone = zone,
    arrivalSourceName = sourceName,
  },
) {
  /* "Delayed by six minutes" about a flight that has left is history; the
     leaving is the news. The delay is still an event, just not the note.
     A belt named before the flight has left — Pearson assigns carousels
     hours ahead — is on the ticket, and is not the sentence either. */
  const worth = events.filter(one => {
    if (GONE_FOR_GOOD.has(status)) return !['FlightDelayed', 'FlightRescheduled'].includes(one.type)
    return one.type !== 'BaggageUpdated'
  })
  const said = [...worth].sort((a, b) => NOTE_ORDER.indexOf(a.type) - NOTE_ORDER.indexOf(b.type))[0]
  if (!said) return null
  const far = ARRIVAL_SIDE.has(said.type)
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: (far ? arrivalZone : zone) || 'UTC',
  }).format(new Date(at))
  const where = far ? arrivalSourceName : sourceName
  return `${describeFlightEvent(said, { flight, zone: far ? arrivalZone : zone })} ${where}, ${clock}.`
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

      const snapshot = await repository.flightSnapshot(leg.id)
      /* A board that has gone quiet keeps its last word about its own end
         until it says otherwise — see quiet.js. */
      if (view && snapshot?.info) {
        if (!arrival) view = keepFarEnd(view, snapshot.info)
        if (!departure) view = keepNearEnd(view, snapshot.info)
      }
      /* A board that should have said "departed" and has not: ask the sky. */
      const known = view || snapshot?.info || null
      const leaves = bestDeparture(known) || leg.departsAt
      const silent =
        known &&
        !['departed', 'landed', 'arrived', 'cancelled', 'diverted'].includes(known.status) &&
        now - new Date(leaves).getTime() > ADSB_SILENCE_MS
      if (silent && now - (asked.get(leg.id) || 0) > ADSB_EVERY_MS && sources.adsb) {
        asked.set(leg.id, now)
        const callsign = callsignFor(number)
        const aircraft = callsign ? await askSky(sources, callsign, leg.id) : null
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
      /* Which aircraft, when nobody has said. A board that names no type —
         Pearson never does — left the seat map drawing a guess for a leg
         whose booking named none either. The transponder knows the type
         from the moment the crew set the callsign at the gate, so through
         the flying window a view with no type asks the sky for one, once
         in a while: the type only, the status stays the board's. */
      let typed = view || snapshot?.info || null
      /* A board that names no type must not unsay one already known. */
      if (typed && !typed.aircraft && snapshot?.info?.aircraft) {
        view = { ...typed, aircraft: snapshot.info.aircraft }
        typed = view
      }
      if (
        typed &&
        !typed.aircraft &&
        sources.adsb &&
        inFlyingWindow(leg, now) &&
        now - (asked.get(leg.id) || 0) > ADSB_EVERY_MS
      ) {
        asked.set(leg.id, now)
        const callsign = callsignFor(number)
        const heard = callsign ? await askSky(sources, callsign, leg.id) : null
        if (heard?.type) {
          view = {
            ...typed,
            aircraft: heard.type,
            sources: [...new Set([...(typed.sources || []), sources.adsb.source])],
          }
        }
      }
      /* Which aircraft it will be, before anybody can say: the same number
         flew the same way yesterday, or this morning, and the sky asked for
         the callsign outside the flying window hears that rotation. Its
         type is what this leg will almost surely fly — kept apart from the
         day's own type, so a swap on the day is news and a guess is not,
         and let go the moment a board or the transponder names the day's. */
      if (typed && !typed.usualAircraft && snapshot?.info?.usualAircraft) {
        view = { ...typed, usualAircraft: snapshot.info.usualAircraft }
        typed = view
      }
      if (
        typed &&
        !typed.aircraft &&
        !typed.usualAircraft &&
        sources.adsb &&
        !inFlyingWindow(leg, now) &&
        now - (asked.get(leg.id) || 0) > ADSB_EARLY_EVERY_MS
      ) {
        asked.set(leg.id, now)
        const callsign = callsignFor(number)
        const heard = callsign ? await askSky(sources, callsign, leg.id) : null
        if (heard?.type) view = { ...typed, usualAircraft: heard.type }
      }
      if (!view) continue
      stats.matched += 1

      /* The queue at security, where the origin's board publishes one, for
         the terminal the leg leaves from. Not an event — nobody is woken for
         a queue — it rides on the leg for the card to draw, and only while
         there is still a queue to stand in. */
      if (from && sources.queues && !SETTLED.has(view.status)) {
        const queues = await sources.queues(from.airportCode).catch(() => null)
        const terminal = view.terminal || leg.terminal || null
        const minutes = queues?.value && terminal ? queues.value[terminal] : undefined
        if (Number.isFinite(minutes)) {
          view = { ...view, extra: { ...(view.extra || {}), securityWaitMinutes: minutes } }
        }
      }

      const previous = snapshot?.info || baselineFromSegment(leg)
      const events = detectFlightEvents(previous, view)
      const changes = changesFor(leg, view)
      const zone = from?.zone || to?.zone
      /* The status note is the traveller's unless it is still the watch's
         own last sentence: a note somebody typed is never written over. */
      let note = snapshot?.note ?? null
      const ours = !leg.statusNote || leg.statusNote === note
      const nearSource = view.sources?.[0] || view.source
      const farSource = arrival?.source || null
      if (events.length) {
        const next = noteFor(events, {
          flight: number,
          zone,
          sourceName: sourceNameOf(nearSource),
          at: now,
          status: view.status,
          arrivalZone: to?.zone || zone,
          arrivalSourceName: sourceNameOf(farSource || nearSource),
        })
        if (next && ours) {
          changes.statusNote = next
          note = next
        }
      }

      if (Object.keys(changes).length) {
        await repository.applyFlightUpdate(leg.id, changes)
        stats.changed += 1
      }
      if (events.length) {
        const stamped = events.map(one => {
          const far = ARRIVAL_SIDE.has(one.type)
          return {
            ...one,
            text: describeFlightEvent(one, { flight: number, zone: far ? to?.zone || zone : zone }),
            source: far && farSource ? farSource : nearSource,
            at: new Date(now).toISOString(),
          }
        })
        stats.events += await repository.recordFlightEvents(leg.id, stamped)
      }
      await repository.saveFlightSnapshot(leg.id, {
        info: view,
        fetchedAt: new Date(now).toISOString(),
        note,
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
  'opendata.adsb.fi': 'ADS-B',
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
