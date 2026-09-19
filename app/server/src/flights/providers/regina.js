/* Regina International (YQR): the display vendor's public XML feed.
 *
 * yqr.ca is a WordPress site whose theme script fetches the same two feeds
 * the screens in the terminal show — yqr.simpleway.cloud/data-feed/public/
 * departure-web and arrivals-web — as plain XML, with no key, no cookie and
 * `cache-control: no-store`. Found by reading the page's own script, and
 * exactly what a passenger standing under a screen sees.
 *
 * Times are wall-clock Regina time in attributes (HOUR="16" MIN="26"):
 * SCHEDTIME is the schedule, TIME is what the board expects now — estimated
 * before the event and actual after it, with no flag saying which, so the
 * status word decides. Saskatchewan keeps one clock all year, but the zone is
 * asked anyway rather than hard-coding minus six.
 *
 * It is a display feed, and behaves like the screens: a flight that has
 * arrived or departed stays on it for half an hour or so and then goes, and
 * the next day's flights appear as the day runs down. Two probes five
 * minutes apart saw the same arrival say "Arrived" and then be replaced by
 * tomorrow's. So a leg vanishing from the feed after its time is not news,
 * and the last thing the feed said is kept as the snapshot.
 *
 * The parser is a few regular expressions over a feed of fixed shape rather
 * than an XML library: the shape is the vendor's, small, and known from a
 * recorded copy in the tests, and a feed that stops matching is meant to
 * fail loudly there rather than parse into nonsense here. */

import { blankToNull, emptyFlight, normalizeFlightNumber, normalizeTerminal } from '../model.js'
import { localToIso } from '../time.js'

export const REGINA_AIRPORT = 'YQR'
export const REGINA_ZONE = 'America/Regina'
export const REGINA_SOURCE = 'yqr.simpleway.cloud'
export const REGINA_FEEDS = Object.freeze({
  departure: 'https://yqr.simpleway.cloud/data-feed/public/departure-web',
  arrival: 'https://yqr.simpleway.cloud/data-feed/public/arrivals-web',
})

const decode = text =>
  String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim()

const tag = (block, name) => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return match ? decode(match[1]) : ''
}

const attributes = (block, name) => {
  const match = new RegExp(`<${name}\\b([^>]*)>`, 'i').exec(block)
  const out = {}
  if (!match) return out
  for (const one of match[1].matchAll(/([A-Za-z]+)="([^"]*)"/g)) out[one[1].toUpperCase()] = one[2]
  return out
}

/* The vendor's words, as far as they have been seen; anything else keeps its
   words and is 'unknown' rather than guessed. */
const STATUS_WORDS = [
  [/cancel/i, 'cancelled'],
  [/divert/i, 'diverted'],
  [/final/i, 'boarding', 'final-call'],
  [/boarding/i, 'boarding', 'boarding'],
  [/go to gate|gate open/i, 'scheduled', 'go-to-gate'],
  [/gate closed|closed/i, 'gate-closed', 'closed'],
  [/departed|airborne|in air|en route/i, 'departed'],
  [/landed/i, 'landed'],
  [/arrived/i, 'arrived'],
  [/delay|late/i, 'delayed'],
  [/on time|scheduled|expected|estimated|early/i, 'scheduled'],
]

export function readStatus(text) {
  const words = blankToNull(text)
  if (!words) return { status: 'unknown', boardingStatus: null }
  for (const [pattern, status, boardingStatus = null] of STATUS_WORDS) {
    if (pattern.test(words)) return { status, boardingStatus }
  }
  return { status: 'unknown', boardingStatus: null }
}

const when = (dateAttrs, timeAttrs) =>
  dateAttrs.YEAR && timeAttrs.HOUR !== undefined
    ? localToIso(
        {
          year: dateAttrs.YEAR,
          month: dateAttrs.MONTH,
          day: dateAttrs.DAY,
          hour: timeAttrs.HOUR,
          minute: timeAttrs.MIN,
        },
        REGINA_ZONE,
      )
    : null

/**
 * The feed as FlightInfo rows. `direction` names which feed this is; a row
 * whose MODE disagrees is skipped rather than trusted, because a departures
 * feed carrying an arrival is the vendor changing something.
 */
export function parseReginaBoard(xml, direction, { fetchedAt = new Date().toISOString() } = {}) {
  const wanted = direction === 'arrival' ? 'A' : 'D'
  const out = []
  for (const match of String(xml ?? '').matchAll(/<FLIGHT\b[^>]*>([\s\S]*?)<\/FLIGHT>/gi)) {
    const block = match[1]
    const mode = attributes(block, 'MODE').TYPE
    if (mode && mode.toUpperCase() !== wanted) continue
    const number = normalizeFlightNumber(tag(block, 'DISPLAY'))
    if (!number) continue

    const row = emptyFlight(REGINA_AIRPORT, direction, REGINA_SOURCE, fetchedAt)
    row.flightNumber = number
    row.carrierCode = decode(tag(block, 'ABBREV')) || number.slice(0, 2)
    row.carrierName = blankToNull(tag(block, 'NAME'))
    const city = attributes(block, 'CITYCODE')
    const cityName = blankToNull(tag(block, 'CITYCODE')) || blankToNull(tag(block, 'CITIES'))
    if (direction === 'arrival') {
      row.origin = blankToNull(city.IATA)
      row.originName = cityName
      row.destination = REGINA_AIRPORT
    } else {
      row.destination = blankToNull(city.IATA)
      row.destinationName = cityName
      row.origin = REGINA_AIRPORT
    }

    const scheduled = when(attributes(block, 'SCHEDDATE'), attributes(block, 'SCHEDTIME'))
    const expected = when(attributes(block, 'DATE'), attributes(block, 'TIME'))
    const { status, boardingStatus } = readStatus(tag(block, 'STATUS'))
    row.status = status
    row.boardingStatus = boardingStatus
    row.statusText = blankToNull(tag(block, 'STATUS'))
    const happened = status === 'departed' || status === 'landed' || status === 'arrived'
    if (direction === 'arrival') {
      row.scheduledArrival = scheduled
      if (happened) row.actualArrival = expected
      else row.estimatedArrival = expected
    } else {
      row.scheduledDeparture = scheduled
      if (happened) row.actualDeparture = expected
      else row.estimatedDeparture = expected
    }
    /* "On Time" beside an expected time eleven minutes after the schedule is
       the board's call, and it stays the board's: the status is its word,
       and the moved estimate is data the change detector reads for itself. */

    row.terminal = normalizeTerminal(tag(block, 'TERMINAL'))
    row.gate = blankToNull(tag(block, 'GATE'))
    row.baggageBelt = blankToNull(tag(block, 'CAROUSEL'))
    /* Never seen in the feed yet; read the same way as Dublin's, should the
       vendor's words ever say it. */
    row.bagsInHall =
      direction === 'arrival' && /in hall|baggage|bags on belt|bags out/i.test(tag(block, 'STATUS'))
    row.aircraft = blankToNull(tag(block, 'AIRCRAFT'))
    row.codeshares = [...tag(block, 'CODESHARES').matchAll(/[A-Z0-9]{2}\s?\d{1,4}[A-Z]?/g)]
      .map(one => normalizeFlightNumber(one[0]))
      .filter(one => one && one !== number)
    const comment = blankToNull(tag(block, 'COMMENT'))
    const bridge = blankToNull(tag(block, 'BRIDGE'))
    const operator = blankToNull(tag(block, 'OPERATE'))
    if (comment || bridge || operator) row.extra = { comment, bridge, operator }
    out.push(row)
  }
  return out
}

/**
 * The provider: two feeds, fetched with whatever `fetch` it is given so the
 * tests hand it a recorded copy and production hands it the network.
 */
export function createReginaProvider({ fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  const read = async direction => {
    const response = await fetch(REGINA_FEEDS[direction], {
      headers: { accept: 'application/xml, text/xml', referer: 'https://www.yqr.ca/' },
    })
    if (!response.ok) throw new Error(`${REGINA_SOURCE} answered ${response.status}`)
    const rows = parseReginaBoard(await response.text(), direction, {
      fetchedAt: new Date(now()).toISOString(),
    })
    if (!rows.length) throw new Error(`${REGINA_SOURCE} ${direction} feed parsed to nothing`)
    return rows
  }
  return {
    airportCode: REGINA_AIRPORT,
    source: REGINA_SOURCE,
    zone: REGINA_ZONE,
    /* The feed is today's board whatever date is asked for; the caller
       matches on the scheduled time, which the rows carry. */
    departures: () => read('departure'),
    arrivals: () => read('arrival'),
  }
}
