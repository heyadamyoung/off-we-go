/* What a stop's day is allowed to be.
 *
 * A calendar date, '2026-09-04', and nothing else. It is the identity, the
 * sort key and what the picker writes, and every screen reads it as one.
 *
 * For most of this app's life it was whatever somebody typed into a box —
 * 'Fri 4 Sep', '4', 'Sep 4', 'tbc' — and the client carried a small parser
 * whose job was to work out which day each of those meant. Migration 025
 * converted what was in the database and that parser is gone; this is the door
 * that stops another one being needed. An assistant tool that still declared
 * the field an integer put a stop on "day 10" within the week, which is
 * exactly how the first mess started.
 */

const SHAPE = /^\d{4}-\d{2}-\d{2}$/

/** True only for a real calendar date in the one format we store. */
export function isTripDay(value) {
  if (typeof value !== 'string' || !SHAPE.test(value)) return false
  const at = new Date(`${value}T12:00:00`)
  /* The shape is not enough: '2026-02-30' has it and is not a date. Comparing
     back guards the months a Date would roll over instead of refusing. */
  if (Number.isNaN(at.getTime())) return false
  const [year, month, day] = value.split('-').map(Number)
  return at.getFullYear() === year && at.getMonth() + 1 === month && at.getDate() === day
}

/**
 * The day to store, three ways.
 *
 * A date comes back as itself, trimmed. Nothing at all comes back as `null`,
 * which is a stop with no day and a perfectly ordinary thing to be. Anything
 * else comes back `undefined`, meaning refuse it — because a caller sending
 * 'Fri 4 Sep' has made a mistake, and quietly storing null instead would throw
 * away a day somebody meant to set.
 */
export function tripDayOrNull(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return null
  return isTripDay(text) ? text : undefined
}

/* When a trip is over, and why that is a question about instants rather than
 * about dates.
 *
 * A phone paired to a trip reports its position until somebody stops it, and
 * until now nothing ever did: `POST /api/ingest/track` asked only whether the
 * token was known. The app has promised the opposite in six places for as long
 * as it has had the feature — "only while a trip is running" — and a promise
 * the server does not keep is not a privacy setting, it is a sentence.
 *
 * So the server keeps it, and `ends_on` is the whole input. The difficulty is
 * that `ends_on` is a bare calendar date with no zone on it: '2026-09-06' is
 * not an instant, and the instant it names depends on where the traveller is
 * standing. The two ways to get this wrong are not equally bad.
 *
 *   * Stop too early and somebody's family loses the map while they are still
 *     out — at four in the afternoon of their last day in Honolulu, because
 *     it is already the seventh in London. That is the bug this is written to
 *     avoid.
 *   * Stop too late and a phone reports for a few hours more than it needed
 *     to, on a day its owner had already written down as the last one.
 *
 * `devices.timezone` looks like the answer and is not: it is nullable, it is
 * whatever the phone said when it was first paired, and that is usually the
 * sofa at home rather than anywhere the trip goes. A rule that reads it would
 * be precise about the wrong place.
 *
 * So the date is read the only way an unzoned date honestly can be — the trip
 * is over once its last day has finished everywhere on Earth. The last clock
 * to let a date go is the one furthest behind UTC, so '2026-09-06' ends at
 * 2026-09-07T12:00:00Z. No traveller is ever cut off while it is still their
 * last day, anywhere, and the cost is at most twelve hours of a phone
 * reporting into a trip that has ended.
 *
 * A trip with no `ends_on` is not over. Most trips are planned before they
 * have dates, and treating "we have not decided yet" as "it has finished"
 * would turn location sharing off for everyone who had not filled in a box.
 */

const DAY_MS = 24 * 60 * 60_000

/* UTC-12. Baker and Howland hold the last clock of any date; nobody lives
   there, and the two inhabited places on UTC-11 are an hour ahead of it. An
   hour of slack on a rule this coarse is not worth the argument. */
const FURTHEST_BEHIND_UTC_MS = 12 * 60 * 60_000

/**
 * The instant a trip's last day has finished everywhere on Earth, in
 * milliseconds — or `null` for a trip with no last day, which has not
 * finished and may never.
 */
export function tripEndedAt(endsOn) {
  if (!isTripDay(endsOn)) return null
  return Date.parse(`${endsOn}T00:00:00Z`) + DAY_MS + FURTHEST_BEHIND_UTC_MS
}

/** Whether that instant has passed. `now` is milliseconds. */
export function tripIsOver(endsOn, now) {
  const ended = tripEndedAt(endsOn)
  return ended !== null && now >= ended
}
