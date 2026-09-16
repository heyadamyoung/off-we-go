import { ARRIVAL_RADIUS_METRES } from './live-stop-progress-core'
import { metres, validLngLat } from './shared/lib/geo'
import type { Segment } from './segments-core'
import type { LiveFix } from './shared/model/types'

/* Did they land?
 *
 * The one question a family at home actually asks on a travel day, and this
 * app has been able to answer it all along without a word from any airline.
 * The phones are on the plane. When one of them is at the far airport and not
 * moving at five hundred miles an hour, the plane is on the ground.
 *
 * The rule is the arrival rule from the itinerary, pointed at the other end of
 * a journey, and it borrows that module's radius so the two can never come to
 * different answers about what "there" means. What it adds is the only thing a
 * journey has that a stop does not: a departure, and therefore a before and an
 * after. Standing at Schiphol on the morning of a flight FROM Schiphol is not
 * landing at Schiphol, and a rule without that would announce a landing to
 * everybody at home while the family were still in the departures queue.
 */

/* Above this it is flying, not landed — two hundred and sixteen kilometres an
   hour, so a taxiing aeroplane and an airport bus both count and an approach
   does not. The same shape of rule the itinerary uses to tell a tram through a
   square from an afternoon at the museum, at the speeds a journey happens at. */
export const LANDED_MAX_SPEED_METRES_PER_SECOND = 60

const at = (value: unknown): number | null => {
  const when = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''))
  return Number.isFinite(when) ? when : null
}

/**
 * The ids of the journeys the trail can account for having ended.
 *
 * In the order the journeys are given, which is the order they were flown —
 * so a list of them reads as the day ran.
 */
export function landedSegments(
  segments: readonly Segment[] | null | undefined,
  fixes: readonly LiveFix[] | null | undefined,
): string[] {
  if (!segments?.length) return []
  const trail = (fixes || [])
    .map(fix => ({ fix, when: at(fix?.at) }))
    .filter(row => row.when !== null && validLngLat(row.fix.lng, row.fix.lat))

  const landed: string[] = []
  for (const segment of segments) {
    // Somebody saying so outranks anything a sensor has to offer.
    if (segment?.status === 'done') {
      landed.push(segment.id)
      continue
    }
    const toLng = segment?.toLng
    const toLat = segment?.toLat
    if (toLng == null || toLat == null || !validLngLat(toLng, toLat)) continue
    const left = at(segment.departsAt)
    if (left === null) continue

    const there = trail.some(row => {
      if ((row.when as number) <= left) return false
      const speed = row.fix.speed
      if (Number.isFinite(speed) && (speed as number) > LANDED_MAX_SPEED_METRES_PER_SECOND)
        return false
      /* Could the phone be at the airport? Distance minus accuracy, as the
         itinerary asks it — a terminal is a kilometre of building and the
         fixes taken inside one are the least certain there are. */
      const away = metres([row.fix.lng, row.fix.lat], [toLng, toLat])
      const vague = Number.isFinite(row.fix.accuracy) ? (row.fix.accuracy as number) : 0
      return away - vague <= ARRIVAL_RADIUS_METRES
    })
    if (there) landed.push(segment.id)
  }
  return landed
}
