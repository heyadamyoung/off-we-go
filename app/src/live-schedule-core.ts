/* What the itinerary's own dates and times mean.

   Its own file because it is its own half of the answer. Next door is about
   what a GPS fix means — how near counts as being somewhere, how fast is
   passing rather than arriving. This is the other side: a trip is a schedule,
   and a schedule knows things no phone can tell you. Neither half needs the
   other to be read. */

/* How long after its own hour a stop is still the thing you are going to.

   Twenty minutes over is a queue at the door, not a change of plan, and the
   two mistakes do not cost the same: letting go too early tells somebody
   standing outside a place that they have moved on from it. So there is room
   to run late — but ninety minutes of it was too much room. Reported from the
   road at a quarter to twelve: a shore walk booked 09:45 to 10:45 still
   wearing the Up next chip, with the party an hour down the road and two
   stops further on.

   Three quarters of an hour covers real lateness. What makes it safe is the
   clamp beside it: however much grace is left, a stop is behind you the
   moment the next thing on the day was due to start. */
export const LATE_GRACE_MINUTES = 45

/* When a stop is over, as minutes counted from the start of its own day.

   This used to read the hour out of display text — '11:20 – 11:50',
   'Check-in 14:00' — taking the last clock it could find and ignoring any AM
   or PM sitting beside it. So '1:30 pm – 3:00 pm' came back as three in the
   morning: past, all day, every day, and stepped over by whatever came next.
   A stop now holds its hours as hours, and this is arithmetic rather than a
   guess at somebody's typing. */
export { windowEndMinutes as endOfWindow } from './stop-time-core'
import { startMinutes, windowEndMinutes } from './stop-time-core'

/* A calendar day as a comparable number, from either an ISO date or a moment.
   Local rather than UTC on purpose: the traveller's own midnight is the one
   that decides whether their day is over. */
export function dayNumber(value?: string | Date | null): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.getFullYear() * 10_000 + (value.getMonth() + 1) * 100 + value.getDate()
  }
  const shaped = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!shaped) return null
  return Number(shaped[1]) * 10_000 + Number(shaped[2]) * 100 + Number(shaped[3])
}

/** Enough of a stop to place it on the calendar. */
export interface ScheduledStop {
  id: string
  day?: string | null
  startsAt?: string | null
  endsAt?: string | null
}

/* Which stops the day has gone past.

   The clock is evidence about the plan in the way a GPS fix is evidence about
   the person, and for most of a trip it is the only evidence there is —
   background tracking is the app's, not the web's, and it is off more often
   than it is on. Without this, an itinerary is a plan that never becomes a
   history: nothing is ever behind you, so the trip wears Up next about a
   place you left this morning and every stop stays Planned for a fortnight.

   Two signals, and the sooner of them wins. A stop's own hour plus a while
   for running late, and never past the moment the next thing on the day was
   due to begin — you cannot still be heading to the quarter-to-ten when the
   quarter-past-eleven has started. A day that is over takes everything on it
   whether or not anything named an hour.

   Deliberately silent about stops with no date: there is nothing to be past.
   The stops must be in schedule order, which is what decides "the next
   thing". */
export function stopsBehindUs(stops: readonly ScheduledStop[], now: Date): Set<string> {
  const behind = new Set<string>()
  const today = dayNumber(now)
  if (today === null) return behind
  const minutesNow = now.getHours() * 60 + now.getMinutes()
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index]
    const day = dayNumber(stop.day)
    if (day === null || day > today) continue
    if (day < today) {
      behind.add(stop.id)
      continue
    }
    const ends = windowEndMinutes(stop)
    // Today, with no hour of its own: the day has to end before this does.
    if (ends === null) continue
    let nextStarts: number | null = null
    for (let later = index + 1; later < stops.length; later += 1) {
      if (dayNumber(stops[later].day) !== day) continue
      const starts = startMinutes(stops[later])
      /* Only something that begins after this one was meant to finish. Two
         overlapping stops are two things going on at once, not one replacing
         the other. */
      if (starts !== null && starts >= ends) {
        nextStarts = starts
        break
      }
    }
    const over = Math.min(ends + LATE_GRACE_MINUTES, nextStarts ?? Number.POSITIVE_INFINITY)
    if (minutesNow > over) behind.add(stop.id)
  }
  return behind
}
