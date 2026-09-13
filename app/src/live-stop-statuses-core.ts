/* The itinerary with what the phones know written over it.

   Its own file because it is its own job, and because the rules next door are
   about what a fix means; this is only about what a list of stops should say
   once those rules have answered. */

import type { Stop } from './shared/model/types'
import type { deriveLiveStopProgress } from './live-stop-progress-core'

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
  const here = progress.currentStop?.id ?? null
  return stops.map(stop => {
    if (here === stop.id) return { ...stop, status: 'now' }
    /* A person saying they are there now outranks the calendar saying it is
       what comes next — they are there, and "Up next" about where somebody is
       standing is simply wrong. Only the phone, placing them somewhere else,
       overrules them. */
    if (stop.status === 'now') return here ? { ...stop, status: 'planned' } : stop
    if (progress.destination?.id === stop.id) return { ...stop, status: 'next' }
    /* Never taken away: a phone that was off, or was not being shared, is not
       evidence that somebody was not somewhere. They were there; they said so. */
    if (visited.has(stop.id)) return { ...stop, status: 'done' }
    // Somewhere else is what comes next, so this is not.
    if (stop.status === 'next' && progress.destination) return { ...stop, status: 'planned' }
    return stop
  })
}
