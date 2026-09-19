/* Where the aircraft actually is, from the community ADS-B network.
 *
 * A board can say "ON SCHEDULE" about a flight whose aircraft is still
 * parked at the far end of the country; a transponder cannot. adsb.lol
 * answers by callsign and by airframe without a key (its notes say one may
 * be asked for later, to be earned by feeding it), with `cache-control:
 * no-store`, and its rate limit is "dynamic" — so this is asked about the
 * legs whose boards are silent, not about every leg every minute.
 *
 * What it gives: whether the aircraft is on the ground or in the air, where,
 * how fast, and how long ago it was heard. What it does not: gates, belts,
 * schedules, and anything about an aircraft nobody near it is receiving —
 * an empty answer means "not heard", never "not flying".
 *
 * The callsign an airline files is its ICAO code and the flight's number,
 * which is not the IATA code on the ticket: AC872 flies as ACA872. The table
 * covers the airlines that fly the three airports this starts with. */

export const ADSB_SOURCE = 'api.adsb.lol'
export const ADSB_BASE = 'https://api.adsb.lol/v2'

/* IATA → ICAO, for the callsign. */
export const ICAO_CODES = Object.freeze({
  AC: 'ACA',
  RV: 'ROU',
  WS: 'WJA',
  WR: 'WEN',
  EI: 'EIN',
  FR: 'RYR',
  KL: 'KLM',
  BA: 'BAW',
  LH: 'DLH',
  UA: 'UAL',
  DL: 'DAL',
  AA: 'AAL',
  AF: 'AFR',
  TS: 'TSC',
  PD: 'POE',
  F8: 'FLE',
  EK: 'UAE',
  EY: 'ETD',
  QR: 'QTR',
  TK: 'THY',
  LX: 'SWR',
  IB: 'IBE',
  VY: 'VLG',
  U2: 'EZY',
  LS: 'EXS',
  BY: 'TOM',
  AI: 'AIC',
  WG: 'SWG',
  '5T': 'MPE',
})

/* The numbers an airline gives to the carriers that fly for it, which file
   their own callsigns: an Air Canada 8123 to Regina is Jazz's aircraft on
   the transponder as JZA8123, and asked for as ACA8123 it is never heard.
   By the block of numbers, as each airline publishes it. */
const FLOWN_BY = [
  { airline: 'AC', from: 7000, to: 8999, icao: 'JZA' },
  { airline: 'AC', from: 1900, to: 1999, icao: 'ROU' },
  { airline: 'WS', from: 3000, to: 3999, icao: 'WEN' },
  { airline: 'KL', from: 1000, to: 1999, icao: 'KLC' },
  { airline: 'EI', from: 3000, to: 3999, icao: 'EAI' },
]

/** "AC872" → "ACA872", "AC8123" → "JZA8123"; null when the airline's ICAO
    code is not known. */
export function callsignFor(flightNumber) {
  const match = /^([A-Z0-9]{2})(\d{1,4})([A-Z]?)$/.exec(String(flightNumber || '').toUpperCase())
  if (!match) return null
  const [, airline, digits, suffix] = match
  const number = Number(digits)
  const regional = FLOWN_BY.find(
    block => block.airline === airline && number >= block.from && number <= block.to,
  )
  const icao = regional?.icao || ICAO_CODES[airline]
  return icao ? `${icao}${digits}${suffix}` : null
}

const EARTH_METRES = 6_371_000
const rad = value => (value * Math.PI) / 180
export function metresBetween(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_METRES * Math.asin(Math.sqrt(h))
}

/**
 * One aircraft's answer, read. `alt_baro` is the word "ground" when the
 * wheels are down, a number of feet when they are not.
 */
export function readAircraft(record, { now = Date.now() } = {}) {
  if (!record) return null
  const onGround = record.alt_baro === 'ground'
  const altitudeFeet = Number.isFinite(record.alt_baro) ? record.alt_baro : null
  const seenSeconds = Number.isFinite(record.seen) ? record.seen : null
  return {
    hex: record.hex || null,
    callsign: String(record.flight || '').trim() || null,
    registration: record.r || null,
    type: record.t || null,
    onGround,
    airborne: !onGround && (altitudeFeet ?? 0) > 500,
    altitudeFeet,
    groundSpeedKnots: Number.isFinite(record.gs) ? record.gs : null,
    /** degrees clockwise from north, the way the aircraft is going */
    trackDegrees: Number.isFinite(record.track) ? record.track : null,
    lat: Number.isFinite(record.lat) ? record.lat : null,
    lon: Number.isFinite(record.lon) ? record.lon : null,
    heardAt: seenSeconds === null ? null : new Date(now - seenSeconds * 1000).toISOString(),
  }
}

/**
 * Where a flight is, or null when nobody is hearing it. Near `airport`
 * ({lat, lon}) on the ground within 8 km is "at the airport".
 */
export function createAdsbProvider({ fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  const ask = async pathname => {
    const response = await fetch(`${ADSB_BASE}/${pathname}`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`${ADSB_SOURCE} answered ${response.status}`)
    const body = await response.json()
    return Array.isArray(body?.ac) ? body.ac : []
  }
  return {
    source: ADSB_SOURCE,
    async byCallsign(callsign) {
      const wanted = String(callsign || '').toUpperCase()
      if (!wanted) return null
      const found = (await ask(`callsign/${encodeURIComponent(wanted)}`)).find(
        one =>
          String(one.flight || '')
            .trim()
            .toUpperCase() === wanted,
      )
      return found ? readAircraft(found, { now: now() }) : null
    },
    async byHex(hex) {
      const found = (await ask(`hex/${encodeURIComponent(String(hex || '').toLowerCase())}`))[0]
      return found ? readAircraft(found, { now: now() }) : null
    },
  }
}

/** What the transponder says about a leg between two airports, in words the
    change detector understands: 'departed', 'landed', or null for no opinion. */
export function verdictFromPosition(aircraft, { from, to }) {
  if (!aircraft || aircraft.lat === null || aircraft.lon === null) return null
  const here = { lat: aircraft.lat, lon: aircraft.lon }
  const nearTo = to?.lat != null && metresBetween(here, to) < 8_000
  const nearFrom = from?.lat != null && metresBetween(here, from) < 8_000
  if (aircraft.onGround && nearTo && !nearFrom) return 'landed'
  if (aircraft.airborne) return 'departed'
  return null
}
