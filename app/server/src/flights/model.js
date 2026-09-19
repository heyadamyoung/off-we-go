/* One shape for a flight, whichever board it came off.
 *
 * Every airport says the same things in its own words — Dublin says "GO TO
 * GATE" in JSON with a numeric status beside it, Regina says "On Time" in an
 * XML feed from its display vendor — and everything downstream (the change
 * detector, the leg on the trip, the sentence on somebody's phone) wants one
 * vocabulary. This is it. The board's own words are kept beside the
 * normalized ones, because when a mapping is wrong the evidence should be in
 * the row and not in a log somebody has to go and find.
 *
 * Times are ISO strings in UTC or null. A board that gives a local wall-clock
 * time is converted by the provider that read it, which is the only place
 * that knows which clock it was.
 */

/**
 * @typedef {'scheduled'|'delayed'|'boarding'|'gate-closed'|'departed'|'landed'|'arrived'|'cancelled'|'diverted'|'unknown'} FlightStatus
 * @typedef {'go-to-gate'|'boarding'|'final-call'|'closed'} BoardingStatus
 *
 * @typedef {object} FlightInfo
 * @property {string} flightNumber        "AC872": IATA carrier code and number, no space, no leading zeros
 * @property {string} carrierCode         "AC"
 * @property {string|null} carrierName    "Air Canada"
 * @property {string} airportCode         the airport whose board this came off
 * @property {'departure'|'arrival'} direction  which of its boards
 * @property {string|null} origin         IATA
 * @property {string|null} originName
 * @property {string|null} destination    IATA
 * @property {string|null} destinationName
 * @property {string|null} scheduledDeparture
 * @property {string|null} estimatedDeparture
 * @property {string|null} actualDeparture
 * @property {string|null} scheduledArrival
 * @property {string|null} estimatedArrival
 * @property {string|null} actualArrival
 * @property {FlightStatus} status
 * @property {string|null} statusText     the board's own words, verbatim
 * @property {string|null} terminal       "1", "2" — never "T1"
 * @property {string|null} gate
 * @property {string|null} baggageBelt
 * @property {BoardingStatus|null} boardingStatus
 * @property {string|null} aircraft       type or registration, when a board says
 * @property {string[]} codeshares        other numbers the same aircraft flies under
 * @property {string} lastUpdated         when the source said, else when it was read
 * @property {string} source              hostname of the board
 * @property {Record<string, unknown>} [extra]  what the source says that nothing else does
 */

export const FLIGHT_STATUSES = Object.freeze([
  'scheduled',
  'delayed',
  'boarding',
  'gate-closed',
  'departed',
  'landed',
  'arrived',
  'cancelled',
  'diverted',
  'unknown',
])

/* Over, one way or another: nothing after these is news about getting there. */
export const SETTLED_STATUSES = new Set(['departed', 'landed', 'arrived', 'cancelled', 'diverted'])

/**
 * "AC 872", "ac0872", "AC872 " → "AC872". A number with no carrier is not a
 * flight number, and a carrier with no number is not one either; null for both.
 */
export function normalizeFlightNumber(value) {
  const text = String(value ?? '')
    .toUpperCase()
    .replace(/[\s.-]+/g, '')
  const match = /^([A-Z0-9]{2})0*(\d{1,4})([A-Z]?)$/.exec(text)
  if (!match) return null
  /* Two digits are a year, not an airline: "18" is nobody's code. */
  if (/^\d\d$/.test(match[1])) return null
  return `${match[1]}${match[2]}${match[3]}`
}

/* The airlines that fly the three airports this starts with, by the names
   people type. Enough to turn "Air Canada" into "AC" when a leg carries the
   airline's name and a bare number; anything else needs the code typed. */
export const CARRIER_CODES = Object.freeze({
  'air canada': 'AC',
  'air canada express': 'AC',
  'air canada rouge': 'RV',
  westjet: 'WS',
  'westjet encore': 'WR',
  'aer lingus': 'EI',
  ryanair: 'FR',
  klm: 'KL',
  'british airways': 'BA',
  lufthansa: 'LH',
  united: 'UA',
  'united airlines': 'UA',
  delta: 'DL',
  'delta air lines': 'DL',
  'american airlines': 'AA',
  american: 'AA',
  'air france': 'AF',
  'air transat': 'TS',
  porter: 'PD',
  'porter airlines': 'PD',
  flair: 'F8',
  'flair airlines': 'F8',
  emirates: 'EK',
  etihad: 'EY',
  'qatar airways': 'QR',
  'turkish airlines': 'TK',
  swiss: 'LX',
  iberia: 'IB',
  vueling: 'VY',
  easyjet: 'U2',
  jet2: 'LS',
  tui: 'BY',
  'air india': 'AI',
  sunwing: 'WG',
  'canadian north': '5T',
})

/**
 * The flight number a leg is about, from what the traveller typed: the
 * number when it already carries the airline ("KL 677"), else the carrier's
 * code or name joined to it ("KLM" + "677", "Air Canada" + "872").
 */
export function flightNumberOf(segment) {
  const direct = normalizeFlightNumber(segment?.number)
  if (direct) return direct
  const digits = String(segment?.number ?? '').replace(/\D/g, '')
  if (!digits) return null
  const carrier = String(segment?.carrier ?? '').trim()
  const code = /^[A-Z0-9]{2}$/i.test(carrier)
    ? carrier.toUpperCase()
    : CARRIER_CODES[carrier.toLowerCase()]
  return code ? normalizeFlightNumber(`${code}${digits}`) : null
}

/** "T1" → "1", "Terminal 3" → "3", "1" → "1"; empty → null. */
export function normalizeTerminal(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const match = /^(?:terminal|t)\s*([0-9A-Z]+)$/i.exec(text)
  return match ? match[1].toUpperCase() : text
}

/** Empty, dashes and "TBA" are the board saying nothing. */
export function blankToNull(value) {
  const text = String(value ?? '').trim()
  if (!text || /^(?:-+|tba|tbd|n\/a|null|undefined)$/i.test(text)) return null
  return text
}

/**
 * The departure this flight is really at: actual over estimated over
 * scheduled, because that is the order in which a board learns things.
 */
export const bestDeparture = info =>
  info?.actualDeparture || info?.estimatedDeparture || info?.scheduledDeparture || null

export const bestArrival = info =>
  info?.actualArrival || info?.estimatedArrival || info?.scheduledArrival || null

/**
 * Which record on a board is this leg. The number must match (the flight's
 * own or one it is sold under), and the scheduled time must be the nearest
 * within half a day: flight numbers repeat every day, and a board can carry
 * tonight's and tomorrow morning's at once.
 */
export function matchFlight(records, flightNumber, aroundIso) {
  const wanted = normalizeFlightNumber(flightNumber)
  if (!wanted) return null
  const around = aroundIso ? new Date(aroundIso).getTime() : Number.NaN
  let best = null
  let bestGap = Number.POSITIVE_INFINITY
  for (const record of records || []) {
    const numbers = [record.flightNumber, ...(record.codeshares || [])].map(normalizeFlightNumber)
    if (!numbers.includes(wanted)) continue
    const scheduled =
      record.direction === 'arrival' ? record.scheduledArrival : record.scheduledDeparture
    const at = scheduled ? new Date(scheduled).getTime() : Number.NaN
    const gap = Number.isFinite(around) && Number.isFinite(at) ? Math.abs(at - around) : 0
    if (gap > 12 * 60 * 60 * 1000) continue
    if (gap < bestGap) {
      best = record
      bestGap = gap
    }
  }
  return best
}

/** The empty FlightInfo a provider fills in, so no field is ever undefined. */
export function emptyFlight(airportCode, direction, source, lastUpdated) {
  return {
    flightNumber: '',
    carrierCode: '',
    carrierName: null,
    airportCode,
    direction,
    origin: null,
    originName: null,
    destination: null,
    destinationName: null,
    scheduledDeparture: null,
    estimatedDeparture: null,
    actualDeparture: null,
    scheduledArrival: null,
    estimatedArrival: null,
    actualArrival: null,
    status: 'unknown',
    statusText: null,
    terminal: null,
    gate: null,
    baggageBelt: null,
    boardingStatus: null,
    aircraft: null,
    codeshares: [],
    lastUpdated,
    source,
  }
}

/* When the sky is worth asking about a leg: from a little before it is due
   to leave — the crew set the callsign at the gate, and an early pushback is
   still a flight — to a while after it was due to land, for the late one.
   Outside that, nobody is asked. */
export const FLYING_BEFORE_MS = 30 * 60_000
export const FLYING_AFTER_MS = 2 * 60 * 60_000

/** Whether `now` is inside the leg's flying window. */
export function inFlyingWindow(leg, now) {
  const departs = new Date(leg.departsAt).getTime()
  const arrives = leg.arrivesAt ? new Date(leg.arrivesAt).getTime() : departs
  if (!Number.isFinite(departs)) return false
  return now >= departs - FLYING_BEFORE_MS && now <= arrives + FLYING_AFTER_MS
}
