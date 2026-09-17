/* Dublin (DUB): daa's own JSON API behind dublinairport.com.
 *
 * The site is a Next.js application; what it draws comes from
 * api.dublinairport.com/dap/flight-listing/{departures,arrivals}?date=YYYY-MM-DD
 * &limit=N, answered for any caller that sends the site's Origin, with a
 * thirty-second public cache and a `lastUpdated` stamp of its own. First seen
 * in public code, confirmed and recorded by the source probe.
 *
 * Each record carries the flight, the far airport, the schedule and an
 * estimate as UTC instants, a numeric status with the board's words beside it
 * (3 "DELAYED", 2 "GO TO GATE"), the terminal, the gate or the belt, and for
 * departures the check-in zone and how long the walk to the gate is. The
 * words are what the mapping keys on: the numbers are not documented, and a
 * word can be read by a person when a new one appears.
 *
 * Its own airport's side only: DUB departures know the gate, DUB arrivals
 * know the belt. The other end of the same flight is another airport's
 * board, or nobody's. */

import { blankToNull, emptyFlight, normalizeFlightNumber, normalizeTerminal } from '../model.js'
import { localToIso } from '../time.js'

export const DUBLIN_AIRPORT = 'DUB'
export const DUBLIN_ZONE = 'Europe/Dublin'
export const DUBLIN_SOURCE = 'api.dublinairport.com'
export const DUBLIN_LISTING = 'https://api.dublinairport.com/dap/flight-listing'
export const DUBLIN_HEADERS = Object.freeze({
  accept: 'application/json',
  origin: 'https://www.dublinairport.com',
  referer: 'https://www.dublinairport.com/',
})

const STATUS_WORDS = [
  [/cancel/i, 'cancelled'],
  [/divert/i, 'diverted'],
  [/final call/i, 'boarding', 'final-call'],
  [/boarding/i, 'boarding', 'boarding'],
  [/go to gate/i, 'scheduled', 'go-to-gate'],
  [/gate closed|closed/i, 'gate-closed', 'closed'],
  [/departed|airborne/i, 'departed'],
  [/landed/i, 'landed'],
  [/arrived|in hall|baggage/i, 'arrived'],
  [/delay/i, 'delayed'],
  [/on schedule|scheduled|on time|expected|estimated|early/i, 'scheduled'],
]

/**
 * "LANDED AT 23:28" carries the touchdown in Dublin's own clock, beside an
 * estimatedDateTime that goes on being the on-blocks estimate. The clock is
 * read against the scheduled day, choosing the day either side that puts it
 * nearest the schedule, so a landing just after midnight files correctly.
 */
export function clockInMessage(message, nearIso, zone = DUBLIN_ZONE) {
  const match = /(?:AT|@)\s*(\d{1,2}):(\d{2})/i.exec(String(message || ''))
  const near = nearIso ? new Date(nearIso).getTime() : Number.NaN
  if (!match || !Number.isFinite(near)) return null
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(near))
  const [year, month, day] = local.split('-').map(Number)
  let best = null
  for (const shift of [-1, 0, 1]) {
    const candidate = localToIso(
      { year, month, day: day + shift, hour: match[1], minute: match[2] },
      zone,
    )
    if (!candidate) continue
    const gap = Math.abs(new Date(candidate).getTime() - near)
    if (best === null || gap < best.gap) best = { iso: candidate, gap }
  }
  return best?.iso ?? null
}

export function readDublinStatus(record) {
  const words = blankToNull(record?.statusMessage)
  let status = 'unknown'
  let boardingStatus = null
  if (words) {
    for (const [pattern, mapped, boarding = null] of STATUS_WORDS) {
      if (pattern.test(words)) {
        status = mapped
        boardingStatus = boarding
        break
      }
    }
  }
  /* The flag outranks a word that says nothing about time: "GO TO GATE" on
     a flight the board also marks delayed is a delayed flight boarding. */
  if (record?.isDelayed === true && (status === 'scheduled' || status === 'unknown')) {
    status = 'delayed'
  }
  return { status, boardingStatus }
}

const iso = value => {
  if (!value) return null
  const at = new Date(value).getTime()
  return Number.isFinite(at) ? new Date(at).toISOString() : null
}

const codesharesOf = value =>
  (Array.isArray(value) ? value : [])
    .map(one => (typeof one === 'string' ? one : one?.flightIdentity || one?.flightNumber || ''))
    .map(normalizeFlightNumber)
    .filter(Boolean)

/**
 * A listing as FlightInfo rows. `body` is the parsed JSON, `direction` the
 * board it was asked from.
 */
export function parseDublinBoard(body, direction, { fetchedAt = new Date().toISOString() } = {}) {
  const records = Array.isArray(body?.content) ? body.content : []
  const updated = iso(body?.lastUpdated) || fetchedAt
  const out = []
  for (const record of records) {
    const number = normalizeFlightNumber(record?.flightIdentity)
    if (!number) continue
    const row = emptyFlight(DUBLIN_AIRPORT, direction, DUBLIN_SOURCE, updated)
    row.flightNumber = number
    row.carrierCode = blankToNull(record.carrierCode) || number.slice(0, 2)
    row.carrierName = blankToNull(record.carrierName)
    const far = blankToNull(record.airportCode)
    if (direction === 'arrival') {
      row.origin = far
      row.originName = blankToNull(record.originAirportName)
      row.destination = DUBLIN_AIRPORT
      row.scheduledArrival = iso(record.scheduledDateTime)
      row.estimatedArrival = iso(record.estimatedDateTime)
      row.actualArrival = iso(record.actualDateTime)
    } else {
      row.destination = far
      row.destinationName = blankToNull(record.destinationAirportName)
      row.origin = DUBLIN_AIRPORT
      row.scheduledDeparture = iso(record.scheduledDateTime)
      row.estimatedDeparture = iso(record.estimatedDateTime)
      row.actualDeparture = iso(record.actualDateTime)
    }
    const { status, boardingStatus } = readDublinStatus(record)
    row.status = status
    row.boardingStatus = boardingStatus
    row.statusText = blankToNull(record.statusMessage)
    /* "LANDED AT 23:28" names the moment, and the estimate beside it goes on
       being the on-blocks estimate. Without a clock in the words, a board
       that says it has happened and gives one time gave the actual. */
    const clock = clockInMessage(
      record.statusMessage,
      direction === 'arrival' ? row.scheduledArrival : row.scheduledDeparture,
    )
    if (status === 'departed' && !row.actualDeparture) {
      row.actualDeparture = clock || row.estimatedDeparture
      if (!clock) row.estimatedDeparture = null
    }
    if ((status === 'landed' || status === 'arrived') && !row.actualArrival) {
      row.actualArrival = clock || row.estimatedArrival
      if (!clock) row.estimatedArrival = null
    }
    row.terminal = normalizeTerminal(record.terminalName)
    row.gate = blankToNull(record.gate)
    row.baggageBelt = blankToNull(record.baggageBelt)
    row.codeshares = codesharesOf(record.codeShares)
    const extra = {
      internalFlightId: blankToNull(record.internalFlightId),
      statusCode: Number.isFinite(record.status) ? record.status : null,
      checkinZone: blankToNull(record.checkinZone),
      checkinDeskRange: blankToNull(record.checkinDeskRange),
      goToGateTime: iso(record.goToGateTime),
      walkMinutes: Number.isFinite(Number(record.walkTime)) ? Number(record.walkTime) : null,
      preClearance: record.requiresPreClearance === true ? true : null,
    }
    row.extra = Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== null))
    out.push(row)
  }
  return out
}

/* The API hands out two hundred records at most, and today's listing starts
   at "now". The site's own listing turns pages with after=<latestTimestamp>
   &after-id=<latestId> going forward and before=/before-id= going back, so
   the whole day is walked forward, and a few hours are walked back for the
   legs that have already left. Bounded, because a loop over a paginator is
   a loop somebody's bug can make infinite. */
export const DUBLIN_PAGE = 200
export const DUBLIN_MAX_PAGES = 6
export const DUBLIN_LOOK_BACK_MS = 4 * 60 * 60 * 1000

/**
 * The provider. One request per page per board per day asked for.
 */
export function createDublinProvider({ fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  const page = async (kind, day, extra = {}) => {
    const query = new URLSearchParams({ date: day, limit: String(DUBLIN_PAGE), ...extra })
    const response = await fetch(`${DUBLIN_LISTING}/${kind}?${query}`, { headers: DUBLIN_HEADERS })
    if (!response.ok) throw new Error(`${DUBLIN_SOURCE} answered ${response.status}`)
    const body = await response.json()
    if (!Array.isArray(body?.content)) {
      throw new Error(`${DUBLIN_SOURCE} ${kind} has no content array`)
    }
    return body
  }

  const read = async (direction, date) => {
    const kind = direction === 'arrival' ? 'arrivals' : 'departures'
    const day = String(date || new Date(now()).toISOString().slice(0, 10))
    const fetchedAt = new Date(now()).toISOString()
    const first = await page(kind, day)
    const bodies = [first]
    let cursor = first.pagination
    for (
      let turned = 1;
      cursor?.hasNext && cursor.latestTimestamp && turned < DUBLIN_MAX_PAGES;
      turned++
    ) {
      const next = await page(kind, day, {
        after: cursor.latestTimestamp,
        'after-id': String(cursor.latestId ?? ''),
      })
      bodies.push(next)
      cursor = next.pagination
    }
    /* Back a few hours from where today's listing starts, for the legs that
       left already and whose actual time is what the trip wants now. */
    cursor = first.pagination
    const floor = now() - DUBLIN_LOOK_BACK_MS
    for (
      let turned = 0;
      cursor?.hasPrevious &&
      cursor.earliestTimestamp &&
      new Date(cursor.earliestTimestamp).getTime() > floor &&
      turned < 2;
      turned++
    ) {
      const previous = await page(kind, day, {
        before: cursor.earliestTimestamp,
        'before-id': String(cursor.earliestId ?? ''),
      })
      bodies.push(previous)
      cursor = previous.pagination
    }
    const seen = new Set()
    const rows = []
    for (const body of bodies) {
      for (const row of parseDublinBoard(body, direction, { fetchedAt })) {
        const key =
          row.extra?.internalFlightId ||
          `${row.flightNumber}:${row.scheduledDeparture || row.scheduledArrival}`
        if (seen.has(key)) continue
        seen.add(key)
        rows.push(row)
      }
    }
    return rows
  }

  return {
    airportCode: DUBLIN_AIRPORT,
    source: DUBLIN_SOURCE,
    zone: DUBLIN_ZONE,
    datedBoards: true,
    departures: date => read('departure', date),
    arrivals: date => read('arrival', date),
  }
}
