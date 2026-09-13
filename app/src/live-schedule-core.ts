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

/* The last hour a stop names, as minutes past midnight, or null.

   A stop's time is display text — '11:20 – 11:50', 'Check-in 14:00' — and the
   last clock time in it is when it is over. Strictly parsed, because guessing
   at display text is exactly what made a day mean four different things: an
   hour and a minute or nothing at all, and nothing at all leaves the stop to
   its day, which is where it already was. */
export function endOfWindow(time?: string | null): number | null {
  const found = [...String(time ?? '').matchAll(/(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g)]
  const last = found[found.length - 1]
  return last ? Number(last[1]) * 60 + Number(last[2]) : null
}

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
