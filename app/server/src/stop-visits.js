/* When somebody actually got to a place, and when they actually left it.
 *
 * The itinerary says a quarter to ten. The phone knows it was twenty past.
 * The app has held both facts for as long as it has had a map on it and has
 * never once put them in the same sentence — the live layer works out an
 * arrival every few seconds to decide which pin is lit, and throws the time
 * away the moment it has used it.
 *
 * Here it is kept, because it is the one thing an itinerary app that also
 * carries a phone can say and an itinerary app on its own cannot: what was
 * planned and what happened, in the same row.
 *
 * Derived here and written down, rather than worked out again whenever it is
 * wanted, because the fixes it is derived from are deleted after thirty days
 * to keep a privacy promise. The trail is the evidence; this is the finding.
 * The finding outlives the evidence, and that is the point — nobody wants
 * their trip to start forgetting itself a month after they get home.
 *
 * Nothing here talks to a database. It takes a stop and a pile of fixes and
 * returns two times or nothing.
 */

import { distanceMetres } from './home-zone.js'
import { pointOf } from './stop-placement.js'

/* The same numbers the live layer uses, deliberately. Two answers to "were
   they there" that disagree would be worse than either on its own: the pin
   would light on the map and the timeline would say nothing happened. When
   these change, they change in both places.

   Five hundred metres because an itinerary item is a point and the thing it
   names is a building, a park, an airport, a square. Ten metres a second —
   thirty-six kilometres an hour — because a bus pulling in counts and a
   motorway does not. */
export const ARRIVAL_RADIUS_METRES = 500
export const ARRIVAL_MAX_SPEED_METRES_PER_SECOND = 10

/* How long away is away. Under this, somebody has wandered round the corner
   for a coffee and come back, and it is one visit. Over it, they went and did
   something else and returned, and calling that a six-hour afternoon at the
   museum would be a lie told with real data.

   Ninety minutes rather than something tighter because the gaps in a trail
   are mostly not the traveller — a phone indoors, a phone in a pocket, a
   phone saving its battery. */
export const AWAY_MS = 90 * 60_000

const timeOf = fix => {
  const at = fix?.at ?? fix?.recordedAt ?? fix?.recorded_at
  const when = at instanceof Date ? at : at == null ? null : new Date(at)
  return when && Number.isFinite(when.getTime()) ? when : null
}

/* The day a moment falls on, in UTC, spelled the way a stop spells its own —
   which is also how the day repair reads a photograph's capture time. A trip
   has no timezone stored anywhere, so this is the only consistent answer
   available; it costs an arrival credited to the wrong side of midnight and
   saves crediting one to the wrong week. */
const dayOf = when => when.toISOString().slice(0, 10)

/**
 * The first visit to a stop that the trail can account for.
 *
 * @param {{lng: number, lat: number, day?: string|null}|null} stop
 * @param {Array<{lng: number, lat: number, accuracy?: number|null, speed?: number|null, zone?: string|null, at?: *, recorded_at?: *}>|null} fixes
 * @param {{radiusMetres?: number, awayMs?: number}} [options]
 * @returns {{arrivedAt: Date, leftAt: Date|null, zone: string|null}|null}
 */
export function visitOf(
  stop,
  fixes,
  { radiusMetres = ARRIVAL_RADIUS_METRES, awayMs = AWAY_MS } = {},
) {
  const here = pointOf(stop)
  if (!here || !fixes?.length) return null

  /* A phone offline for an hour flushes its queue in whatever order it likes,
     and every rule below is about what came first. */
  const trail = fixes
    .map(fix => ({ fix, when: timeOf(fix), point: pointOf(fix) }))
    .filter(row => row.when && row.point)
    .sort((a, b) => a.when - b.when)

  /* Walking past the restaurant on Monday is not dinner on Thursday. A stop
     with no day of its own makes no such claim and takes what it can get. */
  const opens = stop.day || null
  const eligible = opens ? trail.filter(row => dayOf(row.when) >= opens) : trail

  /* Could the phone be inside? Not must it be: distance MINUS accuracy, so a
     vague fix counts towards being somewhere rather than against it. */
  const near = row =>
    distanceMetres(here, row.point) - (Number.isFinite(row.fix.accuracy) ? row.fix.accuracy : 0) <=
    radiusMetres

  const arrival = eligible.find(row => {
    if (!near(row)) return false
    const speed = row.fix.speed
    return !(Number.isFinite(speed) && speed > ARRIVAL_MAX_SPEED_METRES_PER_SECOND)
  })
  if (!arrival) return null

  /* The stay is every fix there from the arrival on, until a gap long enough
     to mean they went and did something else. Measured between one fix there
     and the next, never from the arrival — an afternoon of steady fixes is one
     visit however long it runs. A single reading across the canal between two
     in the hall is a reading, not an exit, so what is not near is simply not
     counted rather than treated as leaving. */
  let last = arrival
  for (const row of eligible) {
    if (row.when <= last.when || !near(row)) continue
    if (row.when - last.when > awayMs) break
    last = row
  }

  /* A departure is only ever reported when a later fix proves they went
     somewhere else. A phone that goes quiet has not left anywhere, and
     somebody inside a building with no signal is still inside the building. */
  const gone = eligible.some(row => row.when > last.when && !near(row))
  /* Which clock this happened on. The plan is a wall clock — "09:45", the way
     the ticket prints it — and an arrival is an absolute instant, so saying the
     two in one sentence needs the timezone of the place. The only thing that
     was definitely there is the phone that took the fix, so its zone is the
     answer, and a grandmother in Sydney reading "arrived 10:20" is read the
     Amsterdam morning rather than her own. Unknown stays unknown. */
  return {
    arrivedAt: arrival.when,
    leftAt: gone ? last.when : null,
    zone: arrival.fix.zone || null,
  }
}
