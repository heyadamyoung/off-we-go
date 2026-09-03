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

export const APPROACHING_RADIUS_METRES = 1_000
export const ARRIVAL_RADIUS_METRES = 125
export const ARRIVAL_MAX_SPEED_METRES_PER_SECOND = 5
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
    const canArrive = (fix: LiveFix, distance: number, index: number) => {
      const accuracy = accuracyOf(fix)
      const speed = speedAt(fix, index)
      return (
        accuracy != null &&
        speed != null &&
        speed <= ARRIVAL_MAX_SPEED_METRES_PER_SECOND &&
        distance + accuracy <= ARRIVAL_RADIUS_METRES
      )
    }
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
    const visitEvents: Array<{ stop: Stop; at: Date }> = []
    let targetIndex = 0
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
      targetIndex += 1
      const next = orderedStops[targetIndex]
      targetArmed = !!next && confidentlyOutside(fix, next)
    }
    const visitedStopIds = visitEvents.map(event => event.stop.id)
    const destination = orderedStops[targetIndex] || null
    const lastVisit = visitEvents[visitEvents.length - 1] || null
    const latestIndex = sameDevice.indexOf(latestFix)
    const atLastVisitedStop =
      !!lastVisit &&
      canArrive(
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

export function describeLiveStopProgress(
  progress: ReturnType<typeof deriveLiveStopProgress>,
  now = new Date(),
) {
  const distance =
    progress.distanceMetres == null
      ? null
      : progress.distanceMetres < 1_000
        ? `${Math.max(10, Math.round(progress.distanceMetres / 10) * 10)} m`
        : `${(progress.distanceMetres / 1_000).toFixed(1)} km`
  if (progress.state === 'approaching' && progress.destination && progress.distanceMetres != null) {
    return {
      text: `Approaching ${progress.destination.name}`,
      meta: `${distance} away`,
      tone: 'approaching' as const,
    }
  }
  if (progress.state === 'heading' && progress.destination && distance) {
    return {
      text: `Heading to ${progress.destination.name}`,
      meta: `${distance} away`,
      tone: 'heading' as const,
    }
  }
  if (progress.state === 'arrived' && progress.currentStop) {
    return {
      text: `At ${progress.currentStop.name}`,
      meta:
        progress.destination && distance
          ? `next: ${progress.destination.name} · ${distance} away`
          : 'Final stop',
      tone: 'arrived' as const,
    }
  }
  if (progress.state === 'complete') {
    const count = progress.visitedStopIds.length
    return {
      text: 'Route complete',
      meta: `${count} stop${count === 1 ? '' : 's'} visited`,
      tone: 'complete' as const,
    }
  }
  if (progress.reason === 'paused') {
    const minutes = progress.lastFix
      ? Math.max(1, Math.round((now.getTime() - progress.lastFix.at.getTime()) / 60_000))
      : null
    const age =
      minutes == null ? null : minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
    return {
      text: 'Sharing paused',
      meta: age ? `Last update ${age} ago` : 'Paused on the phone',
      tone: 'waiting' as const,
    }
  }
  /* Honesty over reassurance: with no reported pause, an old fix means we do
     not know why the phone is quiet — a tunnel, a dead battery, airplane mode.
     Never claim "paused" here; that word asserts a decision nobody reported. */
  if (progress.reason === 'stale-fix' && progress.lastFix) {
    const minutes = Math.max(
      1,
      Math.round((now.getTime() - progress.lastFix.at.getTime()) / 60_000),
    )
    const age = minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
    return {
      text: `No update for ${age}`,
      meta: 'Showing the last known position',
      tone: 'waiting' as const,
    }
  }
  if (progress.reason === 'loading') {
    return {
      text: 'Finding live location…',
      meta: 'Checking connected phones',
      tone: 'waiting' as const,
    }
  }
  if (progress.reason === 'service-error') {
    return {
      text: 'Live location unavailable',
      meta: 'Could not reach the location service',
      tone: 'waiting' as const,
    }
  }
  if (
    progress.reason === 'poor-accuracy' &&
    progress.lastFix &&
    typeof progress.lastFix.accuracy === 'number'
  ) {
    return {
      text: 'Improving GPS signal',
      meta: `Last fix had ${Math.round(progress.lastFix.accuracy)} m accuracy`,
      tone: 'waiting' as const,
    }
  }
  if (progress.reason === 'poor-accuracy') {
    return {
      text: 'Improving GPS signal',
      meta: 'Waiting for an accuracy estimate',
      tone: 'waiting' as const,
    }
  }
  if (progress.reason === 'no-stops') {
    return {
      text: 'Live location',
      meta: 'Add a stop to see trip progress',
      tone: 'waiting' as const,
    }
  }
  return {
    text: 'Waiting for GPS',
    meta: 'Enable location sharing on a phone',
    tone: 'waiting' as const,
  }
}

export function applyLiveStopStatuses(
  stops: Stop[],
  progress: ReturnType<typeof deriveLiveStopProgress>,
) {
  const visited = new Set(progress.visitedStopIds)
  return stops.map(stop => ({
    ...stop,
    status:
      progress.currentStop?.id === stop.id
        ? 'now'
        : progress.destination?.id === stop.id
          ? 'next'
          : visited.has(stop.id)
            ? 'done'
            : 'planned',
  }))
}
