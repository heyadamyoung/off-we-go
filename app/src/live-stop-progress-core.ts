import type { LiveFix, Stop } from './shared/model/types'
import { metres, validLngLat } from './shared/lib/geo'

export const LIVE_FIX_MAX_AGE_MS = 5 * 60_000
export const LIVE_HISTORY_MAX_AGE_MS = 24 * 60 * 60_000
export const LIVE_FIX_MAX_ACCURACY_METRES = 100
export const APPROACHING_RADIUS_METRES = 1_000
export const ARRIVAL_RADIUS_METRES = 125
export const ARRIVAL_MAX_SPEED_METRES_PER_SECOND = 5

interface LiveStopProgressInput {
  stops: Stop[]
  fixes: LiveFix[]
  now?: Date
}

export function deriveLiveStopProgress({ stops, fixes, now = new Date() }: LiveStopProgressInput) {
  const orderedStops = [...stops].sort((a, b) =>
    (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER))
  const coordinateFixes = fixes.filter(fix => validLngLat(fix.lng, fix.lat)
    && Number.isFinite(fix.at.getTime()))
  const lastFix = coordinateFixes
    .slice().sort((a, b) => b.at.getTime() - a.at.getTime())[0] || null
  const reliableHistory = coordinateFixes.filter(fix => {
    const accuracy = typeof fix.accuracy === 'number' ? fix.accuracy : null
    const age = now.getTime() - fix.at.getTime()
    return validLngLat(fix.lng, fix.lat)
      && age >= -60_000 && age <= LIVE_HISTORY_MAX_AGE_MS
      && (accuracy == null || accuracy <= LIVE_FIX_MAX_ACCURACY_METRES)
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
      state: 'waiting' as const, reason: 'no-stops' as const, latestFix, lastFix,
      freshFixes, currentStop: null, destination: null, distanceMetres: null, visitedStopIds: [],
    }
  }
  if (latestFix && orderedStops.length) {
    const canArrive = (fix: LiveFix) =>
      typeof fix.speed !== 'number' || fix.speed <= ARRIVAL_MAX_SPEED_METRES_PER_SECOND
    const nearestTo = (fix: LiveFix) => orderedStops.reduce((nearest, stop) =>
      metres([fix.lng, fix.lat], [stop.lng, stop.lat])
        < metres([fix.lng, fix.lat], [nearest.lng, nearest.lat]) ? stop : nearest)
    const sameDevice = reliableHistory
      .filter(fix => fix.deviceId === latestFix.deviceId)
      .sort((a, b) => a.at.getTime() - b.at.getTime())
    const visitEvents = sameDevice.flatMap(fix => {
      const stop = nearestTo(fix)
      const distance = metres([fix.lng, fix.lat], [stop.lng, stop.lat])
      return distance <= ARRIVAL_RADIUS_METRES && canArrive(fix) ? [{ stop, at: fix.at }] : []
    })
    const visitedStopIds = [...new Set(visitEvents.map(event => event.stop.id))]
    const visited = new Set(visitedStopIds)
    const nextUnvisitedAfter = (index: number) => {
      for (let i = index + 1; i < orderedStops.length; i++) {
        if (!visited.has(orderedStops[i].id)) return orderedStops[i]
      }
      return null
    }
    const nearestStop = nearestTo(latestFix)
    const nearestDistance = metres([latestFix.lng, latestFix.lat], [nearestStop.lng, nearestStop.lat])
    if (nearestDistance <= ARRIVAL_RADIUS_METRES && canArrive(latestFix)) {
      const nextStop = nextUnvisitedAfter(orderedStops.indexOf(nearestStop))
      return {
        state: 'arrived' as const,
        reason: null,
        latestFix,
        lastFix,
        freshFixes,
        currentStop: nearestStop,
        destination: nextStop,
        distanceMetres: nextStop
          ? metres([latestFix.lng, latestFix.lat], [nextStop.lng, nextStop.lat]) : 0,
        visitedStopIds,
      }
    }
    const lastVisit = visitEvents[visitEvents.length - 1]
    const destination = lastVisit
      ? nextUnvisitedAfter(orderedStops.indexOf(lastVisit.stop))
      : nearestStop
    if (!destination) {
      return {
        state: 'complete' as const, reason: null, latestFix,
        lastFix, freshFixes, currentStop: null, destination: null, distanceMetres: 0, visitedStopIds,
      }
    }
    const distanceMetres = metres([latestFix.lng, latestFix.lat], [destination.lng, destination.lat])
    return {
      state: distanceMetres <= APPROACHING_RADIUS_METRES ? 'approaching' as const : 'heading' as const,
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
  const lastAccuracy = lastFix && typeof lastFix.accuracy === 'number' ? lastFix.accuracy : null
  const reason = !lastFix ? 'no-fix' as const
    : lastAge != null && lastAge > LIVE_FIX_MAX_AGE_MS ? 'stale-fix' as const
      : lastAccuracy != null && lastAccuracy > LIVE_FIX_MAX_ACCURACY_METRES ? 'poor-accuracy' as const
        : 'stale-fix' as const
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
  progress: ReturnType<typeof deriveLiveStopProgress>, now = new Date(),
) {
  void now
  const distance = progress.distanceMetres == null ? null
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
      meta: progress.destination && distance
        ? `next: ${progress.destination.name} · ${distance} away` : 'Final stop',
      tone: 'arrived' as const,
    }
  }
  if (progress.state === 'complete') {
    const count = progress.visitedStopIds.length
    return {
      text: 'Route complete', meta: `${count} stop${count === 1 ? '' : 's'} visited`,
      tone: 'complete' as const,
    }
  }
  if (progress.reason === 'stale-fix' && progress.lastFix) {
    const minutes = Math.max(1, Math.round((now.getTime() - progress.lastFix.at.getTime()) / 60_000))
    return {
      text: 'Location paused', meta: `Last update ${minutes} min ago`, tone: 'waiting' as const,
    }
  }
  if (progress.reason === 'poor-accuracy' && progress.lastFix
      && typeof progress.lastFix.accuracy === 'number') {
    return {
      text: 'Improving GPS signal',
      meta: `Last fix had ${Math.round(progress.lastFix.accuracy)} m accuracy`,
      tone: 'waiting' as const,
    }
  }
  if (progress.reason === 'no-stops') {
    return {
      text: 'Live location', meta: 'Add a stop to see trip progress', tone: 'waiting' as const,
    }
  }
  return {
    text: 'Waiting for GPS', meta: 'Enable location sharing on a phone', tone: 'waiting' as const,
  }
}
