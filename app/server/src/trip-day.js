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
