/* What the itinerary's own dates and times mean.

   Its own file because it is its own half of the answer. Next door is about
   what a GPS fix means — how near counts as being somewhere, how fast is
   passing rather than arriving. This is the other side: a trip is a schedule,
   and a schedule knows things no phone can tell you. Neither half needs the
   other to be read. */

/* How long after its own hour a stop is still the thing you are going to.

   Twenty minutes over is a queue at the door, not a change of plan. The two
   mistakes do not cost the same: holding on slightly too long is a stale chip,
   and letting go too early is the app telling somebody standing outside a
   place that they have moved on from it. */
export const LATE_GRACE_MINUTES = 90

/* When a stop is over, as minutes counted from the start of its own day.

   This used to read the hour out of display text — '11:20 – 11:50',
   'Check-in 14:00' — taking the last clock it could find and ignoring any AM
   or PM sitting beside it. So '1:30 pm – 3:00 pm' came back as three in the
   morning: past, all day, every day, and stepped over by whatever came next.
   A stop now holds its hours as hours, and this is arithmetic rather than a
   guess at somebody's typing. */
export { windowEndMinutes as endOfWindow } from './stop-time-core'

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
