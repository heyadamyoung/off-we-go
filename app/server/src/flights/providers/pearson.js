/* Toronto Pearson (YYZ): the list behind the GTAA's own departures page.
 *
 * torontopearson.com is a Sitecore site whose board is drawn by a script
 * that calls the site's own origin — /api/flightsapidata/getflightlist
 * ?type=DEP|ARR&day=today|tomorrow|yesterday&useScheduleTimeOnly=false —
 * and gets {lastUpdate, serverTime, today, tomorrow, yesterday, list: [...]}
 * with the whole day's flights. Read by the source probe on 17 September
 * 2026: 522 departures, every row with the ICAO and IATA numbers (id, id2),
 * scheduled and latest times as ISO with Toronto's offset, a gate, a status
 * code, a terminal, the codeshares (ids) and the far airport (routes), the
 * belt (carousel), the check-in zone and the stand.
 *
 * The site sits behind Radware Bot Manager, which answered the second
 * cookie-less request in a minute with a captcha. So this is read through
 * flights/http.js — a browser-like client with a cookie jar and a large
 * header budget — and a challenge is reported as one, by name, into the
 * source's health, never parsed as a board. If the site ever closes this
 * door, the GTAA's partner programme on developer.torontopearson.com is the
 * proper one, and the parser below is the only thing that would change.
 *
 * The status is a short code. The ones the probe has seen are mapped; any
 * other is kept as its code and reported 'unknown' rather than guessed. */

import { blankToNull, emptyFlight, normalizeFlightNumber, normalizeTerminal } from '../model.js'
import { localToIso } from '../time.js'

export const PEARSON_AIRPORT = 'YYZ'
export const PEARSON_ZONE = 'America/Toronto'
export const PEARSON_SOURCE = 'www.torontopearson.com'
export const PEARSON_LIST = 'https://www.torontopearson.com/api/flightsapidata/getflightlist'

/* Status codes, as the list writes them. The words in the comments are the
   ones the site's own board shows beside each code. */
export const PEARSON_STATUS_CODES = Object.freeze({
  CAN: ['cancelled', null], // Cancelled
  DEL: ['delayed', null], // Delayed
  DLY: ['delayed', null],
  ONT: ['scheduled', null], // On time
  SCH: ['scheduled', null], // Scheduled
  EXP: ['scheduled', null], // Expected
  EST: ['scheduled', null], // Estimated
  EAR: ['scheduled', null], // Early
  GTO: ['scheduled', 'go-to-gate'], // Gate open
  GTC: ['gate-closed', 'closed'], // Gate closed
  BRD: ['boarding', 'boarding'], // Boarding
  FNL: ['boarding', 'final-call'], // Final call
  DEP: ['departed', null], // Departed
  AIR: ['departed', null], // Airborne
  LND: ['landed', null], // Landed
  ARR: ['arrived', null], // Arrived
  DIV: ['diverted', null], // Diverted
})

export function readPearsonStatus(code) {
  const text = blankToNull(code)
  if (!text) return { status: 'unknown', boardingStatus: null }
  const known = PEARSON_STATUS_CODES[text.toUpperCase()]
  if (known) return { status: known[0], boardingStatus: known[1] }
  const words = text.toLowerCase()
  if (/cancel/.test(words)) return { status: 'cancelled', boardingStatus: null }
  if (/delay/.test(words)) return { status: 'delayed', boardingStatus: null }
  if (/on time|scheduled/.test(words)) return { status: 'scheduled', boardingStatus: null }
  if (/depart/.test(words)) return { status: 'departed', boardingStatus: null }
  if (/land/.test(words)) return { status: 'landed', boardingStatus: null }
  if (/arriv/.test(words)) return { status: 'arrived', boardingStatus: null }
  return { status: 'unknown', boardingStatus: null }
}

/* A time as the list writes it — "2026-09-16T18:15:00-04:00" says its own
   offset; a bare "2026-09-16T18:15:00" would be Toronto wall-clock. */
const iso = value => {
  const text = blankToNull(value)
  if (!text) return null
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(text)) {
    const at = new Date(text).getTime()
    return Number.isFinite(at) ? new Date(at).toISOString() : null
  }
  const match = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(text)
  return match
    ? localToIso(
        { year: match[1], month: match[2], day: match[3], hour: match[4], minute: match[5] },
        PEARSON_ZONE,
      )
    : null
}

const HAPPENED = new Set(['departed', 'landed', 'arrived'])

/**
 * The list as FlightInfo rows. `direction` names the board asked for; a row
 * whose `type` disagrees is skipped rather than trusted.
 */
export function parsePearsonBoard(body, direction, { fetchedAt = new Date().toISOString() } = {}) {
  const records = Array.isArray(body?.list) ? body.list : []
  const updated = iso(body?.lastUpdate) || fetchedAt
  const wanted = direction === 'arrival' ? 'ARR' : 'DEP'
  const out = []
  for (const record of records) {
    if (record?.type && String(record.type).toUpperCase() !== wanted) continue
    const number = normalizeFlightNumber(record?.id2) || normalizeFlightNumber(record?.id)
    if (!number) continue
    const row = emptyFlight(PEARSON_AIRPORT, direction, PEARSON_SOURCE, updated)
    row.flightNumber = number
    row.carrierCode = number.slice(0, 2)
    row.carrierName = blankToNull(record.al)
    const far = Array.isArray(record.routes) ? record.routes[0] : null
    const farCode = blankToNull(far?.code)
    const farName = blankToNull(far?.city) || blankToNull(far?.name)
    const scheduled = iso(record.schTime)
    const latest = iso(record.latestTm)
    const { status, boardingStatus } = readPearsonStatus(record.status)
    const happened = HAPPENED.has(status)
    if (direction === 'arrival') {
      row.origin = farCode
      row.originName = farName
      row.destination = PEARSON_AIRPORT
      row.scheduledArrival = scheduled
      if (happened) row.actualArrival = latest
      else row.estimatedArrival = latest
    } else {
      row.destination = farCode
      row.destinationName = farName
      row.origin = PEARSON_AIRPORT
      row.scheduledDeparture = scheduled
      if (happened) row.actualDeparture = latest
      else row.estimatedDeparture = latest
    }
    row.status = status
    row.boardingStatus = boardingStatus
    row.statusText = blankToNull(record.status)
    row.terminal = normalizeTerminal(record.term)
    row.gate = blankToNull(record.gate)
    row.baggageBelt = blankToNull(record.carousel)
    row.codeshares = (Array.isArray(record.ids) ? record.ids : [])
      .map(one => normalizeFlightNumber(one?.id2) || normalizeFlightNumber(one?.id))
      .filter(one => one && one !== number)
    const extra = {
      key: blankToNull(record.key),
      icao: blankToNull(record.id),
      stand: blankToNull(record.stand),
      checkinZone: blankToNull(record.zone),
      aisle: blankToNull(record.aisle),
      region: blankToNull(record.termzone),
      serviceType: blankToNull(record.svctype),
      farAirportName: blankToNull(far?.name),
    }
    row.extra = Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== null))
    out.push(row)
  }
  return out
}

/* The list knows three days by name. A date is one of them relative to
   Toronto's own calendar, or it is not on the list at all. */
export function pearsonDayFor(date, now = Date.now()) {
  if (!date) return 'today'
  const local = at =>
    new Intl.DateTimeFormat('en-CA', { timeZone: PEARSON_ZONE }).format(new Date(at))
  const today = local(now)
  if (date === today) return 'today'
  if (date === local(now + 24 * 60 * 60 * 1000)) return 'tomorrow'
  if (date === local(now - 24 * 60 * 60 * 1000)) return 'yesterday'
  return null
}

/* The bot manager let one request through and challenged the next three,
   cookies or no cookies, all inside a minute. So the list is asked slowly:
   never two requests within the spacing, and after a challenge nothing for
   a while — a provider that hammers a challenged door is one that gets the
   whole address blocked. */
export const PEARSON_SPACING_MS = 30_000
export const PEARSON_BACKOFF_MS = 10 * 60_000

/**
 * The provider. `fetch` is the board client from flights/http.js in
 * production and whatever a test hands in; `sleep` is for the spacing.
 */
export function createPearsonProvider({
  fetch,
  now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  spacingMs = PEARSON_SPACING_MS,
  backoffMs = PEARSON_BACKOFF_MS,
} = {}) {
  let lastAskedAt = 0
  let challengedUntil = 0
  let queue = Promise.resolve()

  const ask = async (direction, day) => {
    const type = direction === 'arrival' ? 'ARR' : 'DEP'
    if (now() < challengedUntil) {
      const minutes = Math.ceil((challengedUntil - now()) / 60_000)
      throw new Error(`${PEARSON_SOURCE} asked for a captcha; not asking again for ${minutes} min`)
    }
    const wait = lastAskedAt + spacingMs - now()
    if (wait > 0) await sleep(wait)
    lastAskedAt = now()
    const response = await fetch(
      `${PEARSON_LIST}?type=${type}&day=${day}&useScheduleTimeOnly=false`,
      {
        headers: {
          accept: 'application/json, text/plain, */*',
          referer: `https://www.torontopearson.com/en/${direction === 'arrival' ? 'arrivals' : 'departures'}`,
          'x-requested-with': 'XMLHttpRequest',
        },
      },
    )
    if (response.challenged) {
      challengedUntil = now() + backoffMs
      throw new Error(`${PEARSON_SOURCE} asked for a captcha`)
    }
    if (!response.ok) throw new Error(`${PEARSON_SOURCE} answered ${response.status}`)
    const body = await response.json()
    if (!Array.isArray(body?.list)) {
      throw new Error(`${PEARSON_SOURCE} ${type} list has no list array`)
    }
    return parsePearsonBoard(body, direction, { fetchedAt: new Date(now()).toISOString() })
  }

  const read = (direction, date) => {
    const day = pearsonDayFor(date, now())
    if (!day) return Promise.resolve([])
    /* One at a time, so two boards asked in the same pass are spaced. */
    const turn = queue.then(() => ask(direction, day))
    queue = turn.catch(() => {})
    return turn
  }

  return {
    airportCode: PEARSON_AIRPORT,
    source: PEARSON_SOURCE,
    zone: PEARSON_ZONE,
    configured: typeof fetch === 'function',
    datedBoards: true,
    departures: date => read('departure', date),
    arrivals: date => read('arrival', date),
  }
}
