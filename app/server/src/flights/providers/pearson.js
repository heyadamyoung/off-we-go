/* Toronto Pearson (YYZ): the GTAA's flight list behind its own website.
 *
 * What the probe established. torontopearson.com is a Sitecore site behind
 * Radware Bot Manager — the second page fetched in a minute from a runner
 * was a captcha — and its board is a lazily loaded "flight-listing" chunk.
 * The list itself is served from an ASP.NET service on Azure Front Door,
 * gtaa-fl-prod.azureedge.net/api/flights/list?type=DEP|ARR&day=today
 * &useScheduleTimeOnly=false, which answers 401 with an empty body to a
 * request carrying only the site's Origin: it wants a credential.
 *
 * The door for that credential is the GTAA's own developer programme
 * (developer.torontopearson.com lists an Airport Resource API for partners),
 * and this provider is wired for the day one is issued: it knows the URL,
 * sends the header it is configured with (PEARSON_FLIGHTS_HEADER and
 * PEARSON_FLIGHTS_KEY, from that programme and nowhere else), and parses the
 * answer with `parsePearsonBoard` — written against field names REMEMBERED
 * from the list's traffic, which no probe has confirmed, so a best guess to
 * be corrected the day a 200 is in hand and not a fact. Until then every
 * call reports `unavailable` with the reason rather than pretending, and
 * Pearson legs get the far airport's board and ADS-B. */

import { blankToNull, emptyFlight, normalizeFlightNumber, normalizeTerminal } from '../model.js'
import { localToIso } from '../time.js'

export const PEARSON_AIRPORT = 'YYZ'
export const PEARSON_ZONE = 'America/Toronto'
export const PEARSON_SOURCE = 'gtaa-fl-prod.azureedge.net'
export const PEARSON_LIST = 'https://gtaa-fl-prod.azureedge.net/api/flights/list'

const STATUS_WORDS = [
  [/cancel/i, 'cancelled'],
  [/divert/i, 'diverted'],
  [/final/i, 'boarding', 'final-call'],
  [/boarding/i, 'boarding', 'boarding'],
  [/go to gate|gate open|proceed/i, 'scheduled', 'go-to-gate'],
  [/gate closed|closed/i, 'gate-closed', 'closed'],
  [/departed|airborne|in air|en route/i, 'departed'],
  [/landed/i, 'landed'],
  [/arrived|at gate|bags|baggage/i, 'arrived'],
  [/delay|late/i, 'delayed'],
  [/on time|scheduled|expected|estimated|early/i, 'scheduled'],
]

export function readPearsonStatus(text) {
  const words = blankToNull(text)
  if (!words) return { status: 'unknown', boardingStatus: null }
  for (const [pattern, status, boardingStatus = null] of STATUS_WORDS) {
    if (pattern.test(words)) return { status, boardingStatus }
  }
  return { status: 'unknown', boardingStatus: null }
}

/* A time as the list writes it — "2026-09-20T18:35:00" with no zone is
   Toronto wall-clock; with a zone it is what it says. */
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

/**
 * The list's rows as FlightInfo. Field names as the front end reads them:
 * `flt` (number), `al` (airline code), `alName`, `routes[].code`/`.name`
 * (the far airport), `schedTm`/`latestTm` (scheduled and latest times),
 * `status`, `terminal`, `gate`, `carousel`, `codeshares[]`. Anything absent
 * is null; nothing is guessed.
 */
export function parsePearsonBoard(body, direction, { fetchedAt = new Date().toISOString() } = {}) {
  const records = Array.isArray(body?.list) ? body.list : Array.isArray(body) ? body : []
  const out = []
  for (const record of records) {
    const number = normalizeFlightNumber(
      record?.flt || record?.flightNumber || `${record?.al || ''}${record?.fltNum || ''}`,
    )
    if (!number) continue
    const row = emptyFlight(PEARSON_AIRPORT, direction, PEARSON_SOURCE, fetchedAt)
    row.flightNumber = number
    row.carrierCode = blankToNull(record.al) || number.slice(0, 2)
    row.carrierName = blankToNull(record.alName) || blankToNull(record.airline)
    const far = Array.isArray(record.routes) ? record.routes[0] : null
    const farCode = blankToNull(far?.code) || blankToNull(record.city)
    const farName = blankToNull(far?.name) || blankToNull(record.cityName)
    const scheduled = iso(record.schedTm || record.scheduledTime)
    const latest = iso(record.latestTm || record.estimatedTime)
    const { status, boardingStatus } = readPearsonStatus(record.status)
    const happened = ['departed', 'landed', 'arrived'].includes(status)
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
    row.terminal = normalizeTerminal(record.terminal)
    row.gate = blankToNull(record.gate)
    row.baggageBelt = blankToNull(record.carousel)
    row.aircraft = blankToNull(record.aircraft) || blankToNull(record.equipment)
    row.codeshares = (Array.isArray(record.codeshares) ? record.codeshares : [])
      .map(one => normalizeFlightNumber(typeof one === 'string' ? one : one?.flt))
      .filter(one => one && one !== number)
    out.push(row)
  }
  return out
}

/**
 * The provider. `header`/`key` are the credential the list wants; without
 * them it does not ask, and says why.
 */
export function createPearsonProvider({
  fetch = globalThis.fetch,
  now = () => Date.now(),
  header = process.env.PEARSON_FLIGHTS_HEADER || '',
  key = process.env.PEARSON_FLIGHTS_KEY || '',
} = {}) {
  const configured = !!(header && key)
  const read = async direction => {
    if (!configured) {
      const error = new Error(`${PEARSON_SOURCE} needs a credential the site has not given up`)
      error.code = 'unavailable'
      throw error
    }
    const type = direction === 'arrival' ? 'ARR' : 'DEP'
    const response = await fetch(
      `${PEARSON_LIST}?type=${type}&day=today&useScheduleTimeOnly=false`,
      {
        headers: {
          accept: 'application/json',
          origin: 'https://www.torontopearson.com',
          referer: 'https://www.torontopearson.com/',
          [header]: key,
        },
      },
    )
    if (!response.ok) throw new Error(`${PEARSON_SOURCE} answered ${response.status}`)
    const rows = parsePearsonBoard(await response.json(), direction, {
      fetchedAt: new Date(now()).toISOString(),
    })
    if (!rows.length) throw new Error(`${PEARSON_SOURCE} ${type} list parsed to nothing`)
    return rows
  }
  return {
    airportCode: PEARSON_AIRPORT,
    source: PEARSON_SOURCE,
    zone: PEARSON_ZONE,
    configured,
    departures: () => read('departure'),
    arrivals: () => read('arrival'),
  }
}
