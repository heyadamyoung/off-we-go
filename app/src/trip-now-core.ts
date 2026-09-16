import { dayNumber } from './live-schedule-core'
import { startMinutes } from './stop-time-core'

/* What is happening on this trip, right now.
 *
 * The map screen has always been reactive: it answers what you tap and says
 * nothing on its own. The bar over it is day chips and a list of rows, which
 * is a filter rather than an answer — so the map shows where everything is and
 * nothing tells you what is going on.
 *
 * Nothing here computes anything the app did not already know. Where the
 * phones are is worked out in live-stop-progress-core, what the calendar has
 * gone past in live-schedule-core, and this only gathers the answer into the
 * shape a sentence needs. That is deliberate: a second opinion about where
 * somebody is would eventually disagree with the first one, and the two would
 * be on the same screen.
 *
 * Two people read that sentence. Somebody following along at home wants to
 * know where the party is, what they have done today and what they have
 * photographed; somebody standing in the rain wants to know what is next and
 * whether they are late for it. Same facts, different emphasis — which is why
 * there is one of these and two renderings of it.
 */

export interface NowStop {
  id: string
  name: string
  day?: string | null
  startsAt?: string | null
  endsAt?: string | null
}

export interface NowPhoto {
  id: string
  day?: string | null
  when?: string | null
}

/** How many of today's pictures the sheet holds. A row, not a gallery. */
export const FRESH_SHOWN = 6

export interface TripNow<S extends NowStop, P extends NowPhoto> {
  /** The day this answer is about, as the traveller's own calendar has it. */
  today: string
  /** What has happened today already, in the order the day ran. */
  done: S[]
  /** What is next, and how long until it was due to begin. */
  next: { stop: S; inMinutes: number | null } | null
  /** Today's photographs, newest first, a handful of them. */
  fresh: P[]
  /** How many of today's photographs there are altogether. */
  todayCount: number
}

export interface TripNowInput<S extends NowStop, P extends NowPhoto> {
  /** The itinerary, in schedule order. */
  stops?: readonly S[]
  photos?: readonly P[]
  /** Stops a phone reported standing at. */
  visitedStopIds?: readonly string[]
  /** Stops the clock has gone past. */
  behindStopIds?: readonly string[]
  /** What the live layer says is being headed for. */
  destination?: S | null
}

/** An ISO date from a moment, in the traveller's own calendar rather than UTC. */
const isoDay = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

/* When a photograph was taken, as a number to sort by. Its own `when` first —
   that is the camera's word — and the day it was filed under as a fallback, so
   a picture with no timestamp still lands on the right day rather than at the
   beginning of time. */
const takenAt = (photo: NowPhoto): number => {
  const own = Date.parse(String(photo.when ?? ''))
  if (Number.isFinite(own)) return own
  const day = Date.parse(`${String(photo.day ?? '')}T00:00:00`)
  return Number.isFinite(day) ? day : 0
}

export function tripNow<S extends NowStop, P extends NowPhoto>(
  {
    stops = [],
    photos = [],
    visitedStopIds = [],
    behindStopIds = [],
    destination = null,
  }: TripNowInput<S, P>,
  now: Date,
): TripNow<S, P> {
  const today = isoDay(now)
  const todayNumber = dayNumber(now)

  /* Done is what the phone saw and what the clock went past, together: on a
     trip nobody is sharing from, the calendar is the only evidence there is,
     and on one where somebody is, a stop visited early is done before its hour
     is up. Read off the itinerary rather than off either list, so the order is
     the order the day ran and not the order the evidence arrived. */
  const behindUs = new Set([...visitedStopIds, ...behindStopIds])
  const done = stops.filter(stop => behindUs.has(stop.id) && dayNumber(stop.day) === todayNumber)

  /* Minutes until the next thing was due — negative once it is overdue, which
     is the most useful thing this line ever says. Only for something today:
     minutes until tomorrow morning is a number nobody reads, and a stop with
     no hour of its own has nothing to count towards. */
  const minutesNow = now.getHours() * 60 + now.getMinutes()
  const due =
    destination && dayNumber(destination.day) === todayNumber ? startMinutes(destination) : null
  const next = destination
    ? { stop: destination, inMinutes: due === null ? null : due - minutesNow }
    : null

  const todays = photos.filter(photo => dayNumber(photo.day) === todayNumber)
  const fresh = [...todays].sort((a, b) => takenAt(b) - takenAt(a)).slice(0, FRESH_SHOWN)

  return { today, done, next, fresh, todayCount: todays.length }
}
