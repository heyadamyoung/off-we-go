import type { LiveFix, Stop } from './shared/model/types'
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
  const orderedStops = [...stops].sort(
    (a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER),
  )
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
  if (latestFix && orderedStops.length) {
    const accuracyOf = (fix: LiveFix) =>
      typeof fix.accuracy === 'number' && Number.isFinite(fix.accuracy) && fix.accuracy >= 0
        ? fix.accuracy
        : null
    const sameDevice = reliableHistory
      .filter(fix => fix.deviceId === latestFix.deviceId)
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
         all — could therefore never arrive anywhere. A speed is derived from
         the previous fix only when that fix is under two minutes old, which is
         most of the time not the case. Only a speed we actually know, and know
         to be too fast, rules an arrival out. */
      if (speed != null && speed > ARRIVAL_MAX_SPEED_METRES_PER_SECOND) return false
      /* Could the phone be inside? It used to ask whether it must be —
         distance PLUS accuracy within the radius — which demands that a fix
         prove where it is, and a vague fix can prove nothing. So the vaguer
         the reading the less likely it counted, exactly backwards: indoors, in
         a station, among tall buildings, where a phone is least sure is
         precisely where somebody is most likely to be at the thing. */
      return distance - (accuracyOf(fix) ?? 0) <= radius
    }
    const canArrive = (fix: LiveFix, distance: number, index: number) =>
      nearEnough(fix, distance, index, ARRIVAL_RADIUS_METRES)
    /** Still there, rather than having been there — see AT_STOP_RADIUS_METRES. */
    const stillAt = (fix: LiveFix, distance: number, index: number) =>
      nearEnough(fix, distance, index, AT_STOP_RADIUS_METRES)
    const confidentlyOutside = (fix: LiveFix, stop: Stop) => {
      const accuracy = accuracyOf(fix)
      if (accuracy == null) return false
      const distance = metres([fix.lng, fix.lat], [stop.lng, stop.lat])
      return distance - accuracy > ARRIVAL_RADIUS_METRES
    }
    const clearlyCloserTo = (fix: LiveFix, target: Stop, previous: Stop) => {
      const accuracy = accuracyOf(fix)
      if (accuracy == null) return false
      const targetDistance = metres([fix.lng, fix.lat], [target.lng, target.lat])
      const previousDistance = metres([fix.lng, fix.lat], [previous.lng, previous.lat])
      return targetDistance + accuracy < previousDistance - accuracy
    }

    /* GPS advances the itinerary as a cursor, never by globally picking whichever
       stop happens to be closest. A later stop cannot skip earlier stops, and a
       co-located return stop is not visited until the phone has first been
       confidently outside its geofence and then comes back. */
    /* A stop somebody has marked Visited is behind us, whether or not a phone
       was there to see it — they were there before location sharing was on, or
       with the phone away. Without this the cursor waits at a stop nobody is
       going back to: it can never arrive, so it never advances, and every stop
       after it stays "planned" for the rest of the trip. Marking somewhere
       Visited would leave it drawn as Up next, which is the reported bug in
       its live form. The itinerary is still never skipped by GPS — only by
       the person, who is allowed to. */
    const advancePast = (from: number) => {
      let at = from
      while (at < orderedStops.length && orderedStops[at].status === 'done') at += 1
      return at
    }
    const visitEvents: Array<{ stop: Stop; at: Date }> = []
    let targetIndex = advancePast(0)
    let targetArmed = true
    for (let index = 0; index < sameDevice.length && targetIndex < orderedStops.length; index++) {
      const fix = sameDevice[index]
      const target = orderedStops[targetIndex]
      if (!targetArmed) {
        const previous = visitEvents[visitEvents.length - 1]?.stop
        targetArmed =
          confidentlyOutside(fix, target) || (!!previous && clearlyCloserTo(fix, target, previous))
        if (!targetArmed) continue
      }
      const distance = metres([fix.lng, fix.lat], [target.lng, target.lat])
      if (!canArrive(fix, distance, index)) continue
      visitEvents.push({ stop: target, at: fix.at })
      targetIndex = advancePast(targetIndex + 1)
      const next = orderedStops[targetIndex]
      targetArmed = !!next && confidentlyOutside(fix, next)
    }
    const visitedStopIds = visitEvents.map(event => event.stop.id)
    const destination = orderedStops[targetIndex] || null
    const lastVisit = visitEvents[visitEvents.length - 1] || null
    const latestIndex = sameDevice.indexOf(latestFix)
    const atLastVisitedStop =
      !!lastVisit &&
      stillAt(
        latestFix,
        metres([latestFix.lng, latestFix.lat], [lastVisit.stop.lng, lastVisit.stop.lat]),
        latestIndex,
      )
    if (atLastVisitedStop) {
      return {
        state: 'arrived' as const,
        reason: null,
        latestFix,
        lastFix,
        freshFixes,
        currentStop: lastVisit.stop,
        destination,
        distanceMetres: destination
          ? metres([latestFix.lng, latestFix.lat], [destination.lng, destination.lat])
          : 0,
        visitedStopIds,
      }
    }
    if (!destination) {
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
    const distanceMetres = metres(
      [latestFix.lng, latestFix.lat],
      [destination.lng, destination.lat],
    )
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
    destination: null,
    distanceMetres: null,
    visitedStopIds: [],
  }
}

/* The words for the banner live next door — see live-progress-copy-core.
   Re-exported here because this is the module the whole app asks about the
   journey, and where a caller gets an answer from is not its business. */
export { describeLiveStopProgress } from './live-progress-copy-core'

/**
 * The itinerary with what the phones know written over it.
 *
 * It knows three things and no more: which stop somebody is at, which one they
 * are heading to, and which ones a phone has actually been at. Everything else
 * keeps the status a person gave it.
 *
 * It used to say 'planned' about everything else instead — a claim, not an
 * absence. With nobody sharing a location, which is most of a trip, that was
 * every stop: you could open a stop, tap Visited, watch it save, and see it
 * come back Planned. The write was never the problem. This list is what the
 * map, the timeline, the strip and the detail card all draw, so the status
 * went to the server intact and was painted over on the way to the screen.
 */
export function applyLiveStopStatuses(
  stops: Stop[],
  progress: ReturnType<typeof deriveLiveStopProgress>,
) {
  const visited = new Set(progress.visitedStopIds)
  /* Whether the phones have anything to say at all. Without this there is
     nothing to contradict, and a stored status is the only thing there is. */
  const live = !!(progress.currentStop || progress.destination)
  return stops.map(stop => {
    if (progress.currentStop?.id === stop.id) return { ...stop, status: 'now' }
    if (progress.destination?.id === stop.id) return { ...stop, status: 'next' }
    if (visited.has(stop.id)) return { ...stop, status: 'done' }
    /* Somewhere else is where you are, so this is not — two stops both saying
       "Happening now" is worse than one out-of-date chip. 'done' is never
       taken away: a phone that was off, or was not being shared, is not
       evidence that somebody was not somewhere. They were there; they said so. */
    if (live && (stop.status === 'now' || stop.status === 'next')) {
      return { ...stop, status: 'planned' }
    }
    return stop
  })
}
