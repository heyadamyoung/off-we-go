import type { Id, LiveFix, Stop } from './shared/model/types'
import { metres, validLngLat } from './shared/lib/geo'
import {
  deliberatePause,
  LIVE_FIX_MAX_ACCURACY_METRES,
  LIVE_FIX_MAX_AGE_MS,
  LIVE_HISTORY_MAX_AGE_MS,
  type PausableDevice,
} from './live-freshness-core'

export {
  deliberatePause,
  LIVE_FIX_MAX_ACCURACY_METRES,
  LIVE_FIX_MAX_AGE_MS,
  LIVE_HISTORY_MAX_AGE_MS,
  liveHistoryHours,
  type PausableDevice,
} from './live-freshness-core'

/* How near counts as being somewhere.

   An itinerary item is one point and the thing it names is a building, a
   park, an airport, a square. A hundred and twenty-five metres was a radius
   sized for GPS error rather than for anywhere anybody goes — narrower than
   the Rijksmuseum is wide — and because the cursor only moves on when the
   phone arrives at the stop it is waiting for, one arrival that failed to
   register froze every stop after it for the rest of the trip.

   The cost of the two mistakes is not symmetrical. Too generous and a stop is
   marked reached slightly early, which the next fix makes true anyway. Too
   mean and the whole itinerary stops, silently, for a fortnight. */
export const APPROACHING_RADIUS_METRES = 1_000
export const ARRIVAL_RADIUS_METRES = 500
/* Being somewhere now is a stronger claim than having been there, and they
   were one number. "Has this stop happened" wants to be generous, because
   getting it wrong freezes the itinerary; "are they there at this moment"
   wants to be tight, because it is the words under the live dot and a person
   five minutes' walk down the road has left. */
export const AT_STOP_RADIUS_METRES = 250
/* Above this it is passing rather than arriving — thirty-six kilometres an
   hour, so a bus pulling in counts and a motorway does not. It was eighteen,
   which refused a taxi crawling up to the door. */
export const ARRIVAL_MAX_SPEED_METRES_PER_SECOND = 10
const ARRIVAL_DERIVED_SPEED_MAX_INTERVAL_MS = 2 * 60_000

/* A calendar day as a comparable number, from either an ISO date or a moment.
   Local rather than UTC on purpose: the traveller's own midnight is the one
   that decides whether their day is over. */
function dayNumber(value?: string | Date | null): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.getFullYear() * 10_000 + (value.getMonth() + 1) * 100 + value.getDate()
  }
  const shaped = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!shaped) return null
  return Number(shaped[1]) * 10_000 + Number(shaped[2]) * 100 + Number(shaped[3])
}

interface LiveStopProgressInput {
  stops: Stop[]
  fixes: LiveFix[]
  now?: Date
  sourceState?: 'ready' | 'loading' | 'error'
  /** the trip's registered phones, when known — a pause the phone reported
      beats any guess made from fix age */
  devices?: PausableDevice[]
}

export function deriveLiveStopProgress({
  stops,
  fixes,
  now = new Date(),
  sourceState = 'ready',
  devices = [],
}: LiveStopProgressInput) {
  /* The itinerary in the order the trip happens, which is the order a
     traveller reads it in — the timeline, the day bar and the strip along the
     bottom all order by day, and the numbering only settles ties within one.

     This used to go by the numbering alone, and the numbering is the order
     stops were typed. Nobody plans a trip in order: the flight out gets
     remembered halfway through writing up the museums and the flight home
     gets typed last of all. So the cursor walked a different trip from the one
     on the screen — parked on something three days out while the stop in front
     of them was never considered, moving between them in an order that looks
     like nothing at all. Anything undated goes last, as it does everywhere
     else: it is not a point in the trip, so it cannot hold a place in it. */
  const orderedStops = [...stops].sort((a, b) => {
    const dayA = dayNumber(a.day)
    const dayB = dayNumber(b.day)
    if (dayA !== dayB) {
      if (dayA === null) return 1
      if (dayB === null) return -1
      return dayA - dayB
    }
    const seqA = a.seq ?? Number.MAX_SAFE_INTEGER
    const seqB = b.seq ?? Number.MAX_SAFE_INTEGER
    if (seqA !== seqB) return seqA - seqB
    const timeA = a.time || ''
    const timeB = b.time || ''
    return timeA < timeB ? -1 : timeA > timeB ? 1 : 0
  })
  const coordinateFixes = fixes.filter(
    fix => validLngLat(fix.lng, fix.lat) && Number.isFinite(fix.at.getTime()),
  )
  const lastFix = coordinateFixes.slice().sort((a, b) => b.at.getTime() - a.at.getTime())[0] || null
  const reliableHistory = coordinateFixes.filter(fix => {
    const accuracy =
      typeof fix.accuracy === 'number' && Number.isFinite(fix.accuracy) && fix.accuracy >= 0
        ? fix.accuracy
        : null
    const age = now.getTime() - fix.at.getTime()
    return (
      validLngLat(fix.lng, fix.lat) &&
      age >= -60_000 &&
      age <= LIVE_HISTORY_MAX_AGE_MS &&
      accuracy != null &&
      accuracy <= LIVE_FIX_MAX_ACCURACY_METRES
    )
  })
  const freshReliable = reliableHistory
    .filter(fix => now.getTime() - fix.at.getTime() <= LIVE_FIX_MAX_AGE_MS)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
  const latestByDevice = new Map<string, LiveFix>()
  for (const fix of freshReliable) {
    const key = fix.deviceId || '__anonymous__'
    if (!latestByDevice.has(key)) latestByDevice.set(key, fix)
  }
  const freshFixes = [...latestByDevice.values()]
  const latestFix = freshFixes[0] || null
  if (latestFix && !orderedStops.length) {
    return {
      state: 'waiting' as const,
      reason: 'no-stops' as const,
      latestFix,
      lastFix,
      freshFixes,
      currentStop: null,
      destination: null,
      distanceMetres: null,
      visitedStopIds: [],
    }
  }
  /* ---- where the trip is ------------------------------------------------

     Time is the backbone and the phone is evidence. That is the opposite way
     round from what was here: a cursor that walked the itinerary and moved on
     only when the phone arrived at the stop it was waiting for, with the
     calendar bolted on afterwards as a way of shoving it along.

     A cursor has one shape of failure and it has it permanently. Any condition
     that fails to fire leaves it where it is — for the rest of the trip, with
     every stop behind it stuck as planned and nothing anybody does in the app
     able to move it. Widening a radius changes the odds of that, never the
     fact of it.

     So: three questions, none of which can block another.

       VISITED  per stop, on its own evidence — a fix near it, dated on or
                after that stop's own day, or a person saying so. Nothing about
                one stop is ever inferred from another.
       HERE     the stop the latest fix is standing at, if any.
       NEXT     the first stop in trip order that is neither visited nor on a
                day that is over.

     It cannot wedge, and the reason is worth writing down: NEXT is a function
     of what has been visited and of the calendar, and the calendar advances
     every midnight whether or not a single phone is switched on. The worst a
     stop nobody ever saw can do is be next until its day passes. Bounded by a
     day, rather than by the length of the trip.

     The day is also what tells two stops at one address apart, which is the
     job the in-order walk was really doing and did badly. A trip that starts
     and ends at the same hotel has two stops on one pin; a fix can only visit
     the one whose day has come, so the last night cannot be ticked off on the
     first morning. Undated stops have no such signal and are open to any fix:
     with no date and the same coordinates there is nothing to tell them apart,
     and over-claiming on a trip that named no days is a smaller harm than an
     ordering rule that can block. */
  const accuracyOf = (fix: LiveFix) =>
    typeof fix.accuracy === 'number' && Number.isFinite(fix.accuracy) && fix.accuracy >= 0
      ? fix.accuracy
      : null
  /* One phone's history, so two travellers do not pool their movements. The
     stale one still counts: a phone that reported all day and went flat at six
     has not un-been anywhere, and reading only fresh fixes would make the trip
     forget its own day every evening. */
  const device = latestFix?.deviceId ?? lastFix?.deviceId ?? null
  const sameDevice =
    device === null
      ? []
      : reliableHistory
          .filter(fix => fix.deviceId === device)
          .sort((a, b) => a.at.getTime() - b.at.getTime())
  const speedAt = (fix: LiveFix, index: number) => {
    if (typeof fix.speed === 'number' && Number.isFinite(fix.speed) && fix.speed >= 0) {
      return fix.speed
    }
    const previous = sameDevice[index - 1]
    const elapsed = previous ? fix.at.getTime() - previous.at.getTime() : 0
    if (!previous || elapsed <= 0 || elapsed > ARRIVAL_DERIVED_SPEED_MAX_INTERVAL_MS) return null
    return metres([previous.lng, previous.lat], [fix.lng, fix.lat]) / (elapsed / 1_000)
  }
  const nearEnough = (fix: LiveFix, distance: number, index: number, radius: number) => {
    const speed = speedAt(fix, index)
    /* A speed nobody could work out is not a speed that disqualifies. It was
       treated as one, and the commonest phone on a trip — backgrounded,
       reporting every few minutes, standing still so reporting no speed at
       all — could therefore never arrive anywhere. Only a speed we actually
       know, and know to be too fast, rules an arrival out. */
    if (speed != null && speed > ARRIVAL_MAX_SPEED_METRES_PER_SECOND) return false
    /* Could the phone be inside? It used to ask whether it must be — distance
       PLUS accuracy within the radius — which demands that a fix prove where
       it is, and a vague fix can prove nothing. Indoors, in a station, among
       tall buildings, where a phone is least sure is precisely where somebody
       is most likely to be at the thing. */
    return distance - (accuracyOf(fix) ?? 0) <= radius
  }
  const canArrive = (fix: LiveFix, distance: number, index: number) =>
    nearEnough(fix, distance, index, ARRIVAL_RADIUS_METRES)
  /** Still there, rather than having been there — see AT_STOP_RADIUS_METRES. */
  const stillAt = (fix: LiveFix, distance: number, index: number) =>
    nearEnough(fix, distance, index, AT_STOP_RADIUS_METRES)

  // VISITED: each stop answered on its own, in itinerary order for the reader.
  const visitedStopIds: Id[] = []
  for (const stop of orderedStops) {
    if (stop.status === 'done') {
      // Somebody said so, which outranks anything a sensor has to offer.
      visitedStopIds.push(stop.id)
      continue
    }
    const opens = dayNumber(stop.day)
    for (let index = 0; index < sameDevice.length; index += 1) {
      const fix = sameDevice[index]
      // Walking past the restaurant on Monday is not dinner on Thursday.
      if (opens !== null) {
        const on = dayNumber(fix.at)
        if (on !== null && on < opens) continue
      }
      const distance = metres([fix.lng, fix.lat], [stop.lng, stop.lat])
      if (!canArrive(fix, distance, index)) continue
      visitedStopIds.push(stop.id)
      break
    }
  }
  const visited = new Set(visitedStopIds)

  // NEXT: the calendar and what has happened, and nothing else.
  const today = dayNumber(now)
  const dayIsOver = (stop: Stop) => {
    const day = dayNumber(stop.day)
    return day !== null && today !== null && day < today
  }
  const destination = orderedStops.find(stop => !visited.has(stop.id) && !dayIsOver(stop)) || null

  // HERE: the nearest stop the latest fix is actually standing at.
  let currentStop: Stop | null = null
  if (latestFix) {
    const latestIndex = sameDevice.indexOf(latestFix)
    let nearest = Number.POSITIVE_INFINITY
    for (const stop of orderedStops) {
      const distance = metres([latestFix.lng, latestFix.lat], [stop.lng, stop.lat])
      // Strictly nearer, so two stops on one pin leave the earlier one standing.
      if (distance >= nearest) continue
      if (!stillAt(latestFix, distance, latestIndex)) continue
      nearest = distance
      currentStop = stop
    }
  }

  const away = (stop: Stop) =>
    latestFix ? metres([latestFix.lng, latestFix.lat], [stop.lng, stop.lat]) : null

  /* Standing somewhere beats everything, including the trip being over: at the
     last stop on the last day, "At the airport" is the true and useful thing
     to say and "Route complete" is neither. */
  if (latestFix && currentStop) {
    return {
      state: 'arrived' as const,
      reason: null,
      latestFix,
      lastFix,
      freshFixes,
      currentStop,
      destination,
      distanceMetres: destination ? away(destination) : 0,
      visitedStopIds,
    }
  }

  /* Nothing left ahead is a fact about the calendar, and the calendar does not
     need a phone. A trip whose last day is behind it is over, and saying
     "waiting for GPS" about it would be waiting for news that cannot change
     the answer. */
  if (orderedStops.length && !destination) {
    return {
      state: 'complete' as const,
      reason: null,
      latestFix,
      lastFix,
      freshFixes,
      currentStop: null,
      destination: null,
      distanceMetres: 0,
      visitedStopIds,
    }
  }

  if (latestFix && destination) {
    const distanceMetres = away(destination) as number
    return {
      state:
        distanceMetres <= APPROACHING_RADIUS_METRES
          ? ('approaching' as const)
          : ('heading' as const),
      reason: null,
      latestFix,
      lastFix,
      freshFixes,
      currentStop: null,
      destination,
      distanceMetres,
      visitedStopIds,
    }
  }
  /* No live fix. The dot is honestly waiting — but the itinerary is not, and
     it never needed a phone to know that yesterday is over. */
  const lastAge = lastFix ? now.getTime() - lastFix.at.getTime() : null
  const lastAccuracy =
    lastFix &&
    typeof lastFix.accuracy === 'number' &&
    Number.isFinite(lastFix.accuracy) &&
    lastFix.accuracy >= 0
      ? lastFix.accuracy
      : null
  const reason =
    sourceState === 'loading'
      ? ('loading' as const)
      : sourceState === 'error'
        ? ('service-error' as const)
        : deliberatePause(devices, now)
          ? ('paused' as const)
          : !lastFix
            ? ('no-fix' as const)
            : lastAge != null && lastAge > LIVE_FIX_MAX_AGE_MS
              ? ('stale-fix' as const)
              : lastAccuracy == null || lastAccuracy > LIVE_FIX_MAX_ACCURACY_METRES
                ? ('poor-accuracy' as const)
                : ('stale-fix' as const)
  return {
    state: 'waiting' as const,
    reason,
    latestFix: null,
    lastFix,
    freshFixes,
    currentStop: null,
    destination,
    distanceMetres: null,
    visitedStopIds,
  }
}

/* The words for the banner live next door — see live-progress-copy-core.
   Re-exported here because this is the module the whole app asks about the
   journey, and where a caller gets an answer from is not its business. */
export { describeLiveStopProgress } from './live-progress-copy-core'

/* The itinerary with what the phones know written over it lives next door —
   see live-stop-statuses-core. Re-exported here because this is the module
   the whole app asks about the journey, and where a caller gets an answer
   from is not its business. */
export { applyLiveStopStatuses } from './live-stop-statuses-core'
