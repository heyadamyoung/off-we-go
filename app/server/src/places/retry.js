/**
 * When a cell that failed may be asked for again.
 *
 * Its own module because both halves of the queue need it and neither may
 * import the other: the drain in worker.js decides which failed cells are due,
 * and the ingest writes when each one is due as it marks the failure.
 *
 * There is no last attempt. A cap on tries was the rule here once — five, and
 * then the cell was left alone "with its error on the row for somebody to
 * read". Nobody reads rows. Paris was found in production `failed`, a whole
 * capital with nothing behind it and no mechanism that would ever try again,
 * and the traveller's side of that is a map that says "still loading places
 * here" for ever.
 *
 * The cap existed for a real reason — a permanently broken cell sorts to the
 * front of the queue on its old requested_at and starves everything behind
 * it — and the answer to that is to make it wait, not to make it stop. Waiting
 * six hours costs a cell that will fail again six hours of nothing; stopping
 * costs a city permanently.
 */

/** The wait after the nth consecutive failure. The last entry repeats. */
export const RETRY_AFTER_MS = Object.freeze([
  60_000,
  4 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
])

/**
 * How long to wait before trying a cell that has failed `attempts` times.
 * @param {number} attempts consecutive failures, this one included
 * @returns {number} milliseconds
 */
export function retryAfterMs(attempts) {
  const at = Math.min(Math.max(1, Math.floor(Number(attempts) || 1)), RETRY_AFTER_MS.length)
  return RETRY_AFTER_MS[at - 1]
}
