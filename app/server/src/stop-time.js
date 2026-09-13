/* What a stop's time is allowed to be.
 *
 * A time of day, '09:30', and nothing else — with the words that used to
 * share the box with it moved into a note of their own.
 *
 * For most of this app's life it was whatever somebody typed: '11:20-11:50',
 * '2:30 PM', 'Check-in 14:00', 'Evening'. Migration 031 converted what was in
 * the database; this is the door that stops the mess coming back. It is the
 * same door trip-day.js is, for the same reason: the parser that had to guess
 * what the text meant is how a stop ended up finishing at three in the
 * morning, and there must not be a second one.
 */

const SHAPE = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/

/** True for the one shape this is stored in. */
export function isClock(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value)
}

/**
 * The time to store, three ways.
 *
 * A clock comes back padded to 'HH:MM'. Nothing at all comes back as `null`,
 * which is a stop with no time and a perfectly ordinary thing to be. Anything
 * else comes back `undefined`, meaning refuse it — because '2:30 PM' is a
 * caller saying something this column cannot hold, and reading half of it is
 * exactly how a stop lands at half past two in the morning.
 *
 * Padding a single-digit hour and dropping the seconds Postgres hands back
 * are not guesses: neither changes which moment is meant.
 */
export function clockOrNull(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return null
  const found = SHAPE.exec(text)
  if (!found) return undefined
  return `${found[1].padStart(2, '0')}:${found[2]}`
}

/**
 * The words beside the numbers — 'Check-in', 'Doors', 'Evening'.
 *
 * Trimmed, emptied to null, and never parsed. Whatever a time could be read
 * out of this belongs in the clocks; what is left is a label, and labels are
 * nobody's business but the reader's.
 */
export function timeNoteOrNull(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const text = value.trim().slice(0, 80)
  return text || null
}
