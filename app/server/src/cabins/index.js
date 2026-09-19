import { CABINS } from './library.js'

/* Finding a cabin for a leg.
 *
 * A leg names its airline by the two letters at the front of its number
 * and its aircraft by a type code, and the library is keyed by both. Two
 * forgivenesses: an airline flies more than one code — "AC 8123" to Regina
 * is Jazz's aircraft with Air Canada's number, and a KLM number under 2000
 * on an Embraer is Cityhopper's — so a miss under the airline's own code
 * is tried under the codes that fly for it; and a family drawn the same
 * way as a sibling the airline does fly is drawn as the sibling, said so. */

const FLIES_FOR = {
  AC: ['QK', 'RV'],
  KL: ['WA'],
  WS: ['WR'],
  EI: [],
}

/* Types an airline files under one code that the boards may name by
   another: a 737-8 MAX on a board that only knows 737s, a 787 without its
   dash number. Tried after the exact code, in this order. */
const SIBLINGS = {
  B738: ['B38M'],
  B38M: ['B738'],
  B39M: ['B739', 'B38M'],
  B739: ['B738', 'B39M'],
  B789: ['B788', 'B78X'],
  B788: ['B789'],
  B78X: ['B789'],
  B77W: ['B773', 'B77L', 'B772'],
  B772: ['B77L', 'B77W'],
  B773: ['B77W'],
  A21N: ['A321'],
  A321: ['A21N'],
  A20N: ['A320'],
  A320: ['A20N'],
  A19N: ['A319'],
  A319: ['A19N'],
  A339: ['A333'],
  A338: ['A332'],
  A333: ['A332'],
  A332: ['A333'],
  E75S: ['E75L'],
  E170: ['E75L'],
  E195: ['E295'],
  E290: ['E190'],
  CRJ7: ['CRJ9'],
  CRJX: ['CRJ9'],
  DH8C: ['DH8D'],
  AT75: ['AT76'],
  AT72: ['AT76'],
}

export const AIRLINE_NAMES = {
  AC: 'Air Canada',
  QK: 'Air Canada Express (Jazz)',
  RV: 'Air Canada Rouge',
  KL: 'KLM',
  WA: 'KLM Cityhopper',
  TS: 'Air Transat',
  WS: 'WestJet',
  WR: 'WestJet Encore',
  EI: 'Aer Lingus',
  PD: 'Porter',
}

const clean = value =>
  String(value ?? '')
    .trim()
    .toUpperCase()

export const isAirlineCode = value => /^[A-Z0-9]{2}$/.test(clean(value))
export const isFamilyCode = value => /^[A-Z0-9]{3,4}$/.test(clean(value))

const exact = (airline, family) =>
  CABINS.find(entry => entry.airline === airline && entry.family === family) || null

/**
 * The cabin an airline flies on a type, or null. `airline` is the IATA
 * code, `family` the ICAO type. The answer says which airline and which
 * type it is drawn from, which is not always the pair asked for.
 */
export function findCabin(airline, family) {
  const code = clean(airline)
  const type = clean(family)
  if (!isAirlineCode(code) || !isFamilyCode(type)) return null
  const airlines = [code, ...(FLIES_FOR[code] || [])]
  const families = [type, ...(SIBLINGS[type] || [])]
  for (const candidate of families) {
    for (const carrier of airlines) {
      const found = exact(carrier, candidate)
      if (found) return found
    }
  }
  return null
}

/** Everything the library covers, airline by airline, for anybody asking. */
export function listCabins() {
  const byAirline = new Map()
  for (const entry of CABINS) {
    if (!byAirline.has(entry.airline)) {
      byAirline.set(entry.airline, {
        code: entry.airline,
        name: AIRLINE_NAMES[entry.airline] || entry.airline,
        families: [],
      })
    }
    byAirline.get(entry.airline).families.push({ family: entry.family, name: entry.name })
  }
  return [...byAirline.values()]
}

/** Every entry is drawable: cabins in order without overlap, letters once
    per cabin, doors and wing inside the rows. Run by the tests, and cheap
    enough to run at start-up so a typo never reaches a phone. */
export function libraryProblems(entries = CABINS) {
  const problems = []
  const seen = new Set()
  for (const entry of entries) {
    const where = `${entry.airline} ${entry.family}`
    const key = `${entry.airline}/${entry.family}`
    if (seen.has(key)) problems.push(`${where}: listed twice`)
    seen.add(key)
    if (!isAirlineCode(entry.airline)) problems.push(`${where}: airline code`)
    if (!isFamilyCode(entry.family)) problems.push(`${where}: family code`)
    if (!entry.name) problems.push(`${where}: no name`)
    if (!Array.isArray(entry.cabins) || !entry.cabins.length) {
      problems.push(`${where}: no cabins`)
      continue
    }
    let last = 0
    for (const cabin of entry.cabins) {
      const [first, end] = cabin.rows || []
      if (!(first > last && end >= first)) problems.push(`${where}: ${cabin.name} rows`)
      last = end
      const letters = (cabin.sections || []).flat()
      if (!letters.length) problems.push(`${where}: ${cabin.name} has no seats`)
      if (new Set(letters).size !== letters.length)
        problems.push(`${where}: ${cabin.name} repeats a letter`)
      if (letters.includes('I')) problems.push(`${where}: ${cabin.name} books an I`)
    }
    const first = entry.cabins[0].rows[0]
    for (const exit of entry.exits || [])
      if (exit < first || exit > last) problems.push(`${where}: exit ${exit} outside the rows`)
    if (!(entry.exits || []).length) problems.push(`${where}: no doors`)
    const [wingFrom, wingTo] = entry.wing || []
    if (!(wingFrom >= first && wingTo <= last && wingFrom < wingTo))
      problems.push(`${where}: wing outside the rows`)
    const seats = entry.cabins.reduce(
      (sum, cabin) => sum + (cabin.rows[1] - cabin.rows[0] + 1) * cabin.sections.flat().length,
      0,
    )
    /* The seat count is what the airline says, and a last row that is
       short or a row given up to a galley puts the drawing a few over. */
    if (Math.abs(seats - entry.seats) > Math.max(9, entry.seats * 0.06))
      problems.push(`${where}: draws ${seats} seats against ${entry.seats} sold`)
  }
  return problems
}

/* One route: the cabin an airline flies on a type. Behind a login like the
   rest of /api, small, and cached hard — the library changes with a deploy,
   not with the day. */
export function registerCabinRoutes(app, { authenticated }) {
  app.get('/api/cabins', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    return { airlines: listCabins() }
  })
  app.get('/api/cabins/:airline/:family', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    const { airline, family } = request.params
    if (!isAirlineCode(airline) || !isFamilyCode(family))
      return reply.code(400).send({ error: 'An airline code and an aircraft type are required' })
    const found = findCabin(airline, family)
    if (!found) return reply.code(404).send({ error: 'No cabin on file for that aircraft' })
    reply.header('cache-control', 'private, max-age=86400')
    return { cabin: found }
  })
}
