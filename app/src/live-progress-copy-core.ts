/* The words under the live dot: what the trip is doing right now, in a
   sentence somebody reads at a glance.

   Its own file because it is its own job. What the phones know is worked out
   next door, from fixes and geofences and a cursor over the itinerary; this
   only ever turns that answer into English. Nothing here computes anything —
   if a line in here needs a distance or a stop, it was handed one. */

import type { deriveLiveStopProgress } from './live-stop-progress-core'

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
      /* The commonest cause of a long silence in practice is a phone whose
         token belongs to another trip — it posts faithfully, elsewhere. Point
         at the one screen that shows which trip each phone reports to. */
      meta:
        minutes >= 12 * 60
          ? 'Last known position · check the phone under Trip settings → Phones'
          : 'Showing the last known position',
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
