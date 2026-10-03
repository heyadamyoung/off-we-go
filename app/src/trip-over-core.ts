/* Whether a trip has finished — the client's copy of the server's rule.
 *
 * The authority is `server/src/trip-day.js`, which refuses a position once
 * the trip is over and carries the full reasoning: a trip's `endsOn` is a bare
 * calendar date with no zone on it, so it is read the only way an unzoned date
 * honestly can be — the trip is over once its last day has finished
 * everywhere on Earth, which is twelve hours after UTC midnight, because the
 * last clock to let a date go is the one furthest behind UTC. A trip with no
 * `endsOn` has not finished and may never.
 *
 * This file exists because the screens need the same answer the server will
 * give, to the same instant. The Phones tab offers to start location sharing,
 * and on a trip that is over the server will refuse the first fix: offering a
 * button that cannot work is worse than not offering it. Computing "over" any
 * other way here — the browser's own midnight, say — would open a window
 * where the tab offers sharing the server has already ended, or withholds
 * sharing the server would still take.
 *
 * Mirrored rather than shared for the same reason `pair-code-core.ts` mirrors
 * `server/src/pair-code.js`: the server is plain JS modules under `server/`
 * and nothing under `src/` may import from there. The pair is held together by
 * `tests/trip-over.test.js` and `server/test/trip-day.test.js` asserting the
 * same instants.
 *
 * Not to be confused with `tripProgress`/`isPast` in the home slice, which
 * answer a different question — which calendar day of the trip a viewer is
 * looking at, in the viewer's own zone, to draw a globe. This one is about the
 * single instant that sharing stops.
 */

const SHAPE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60_000
const FURTHEST_BEHIND_UTC_MS = 12 * 60 * 60_000

/** True only for a real calendar date in the one format a trip stores. */
function isTripDay(value: unknown): value is string {
  if (typeof value !== 'string' || !SHAPE.test(value)) return false
  const at = new Date(`${value}T12:00:00`)
  if (Number.isNaN(at.getTime())) return false
  const [year, month, day] = value.split('-').map(Number)
  return at.getFullYear() === year && at.getMonth() + 1 === month && at.getDate() === day
}

/**
 * The instant a trip's last day has finished everywhere on Earth, in
 * milliseconds — or `null` for a trip with no last day.
 */
export function tripEndedAt(endsOn?: string | null): number | null {
  if (!isTripDay(endsOn)) return null
  return Date.parse(`${endsOn}T00:00:00Z`) + DAY_MS + FURTHEST_BEHIND_UTC_MS
}

/** Whether that instant has passed. */
export function tripIsOver(endsOn?: string | null, now: number = Date.now()): boolean {
  const ended = tripEndedAt(endsOn)
  return ended !== null && now >= ended
}
