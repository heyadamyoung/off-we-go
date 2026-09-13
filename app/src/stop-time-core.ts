/* What time a stop happens at, and how it reads.

   For most of this app's life this was a text box. Whatever was typed went
   into the column and came back out onto the screen untouched, so one
   itinerary item read `11:20-11:50` and the next one read `2:30 PM` — the
   same trip, two clocks, because two different hands filled the boxes in.

   It was worse than untidy. The rule that decides whether a stop is behind
   you took the last `HH:MM` it could find in that text and ignored any AM or
   PM beside it, so `1:30 pm – 3:00 pm` was read as ending at three in the
   morning: past, all day, every day, and skipped by whatever came next.

   So a stop now holds two clocks and a note. `startsAt` and `endsAt` are
   times of day, stored as `HH:MM` and nothing else — the same argument the
   day went through, where the stored value IS the fact and the label is
   worked out when it is drawn. The note is for the words that were sharing
   the box with them: `Check-in`, `Doors`, `Evening`.

   Local time on purpose, not an instant. A stop's time is what the ticket
   says, and a ticket printed in Amsterdam says the Amsterdam time even when
   the phone reading it is still in Regina. Pairing it with the stop's own
   day is what makes a moment, and that pairing belongs to whatever is asking.

   Twenty-four hour when drawn, for everybody. Not the reader's locale: every
   boarding pass, platform board and hotel confirmation on this trip is
   written that way; it cannot lose an AM or a PM; it is the same width on
   every row, which is what lets the strip's time column be forty pixels; and
   it is already what is stored, so nothing is converted to be believed.
   Typing one is the device's business — the picker is a native one and shows
   whatever the phone shows. */

/** A time of day as it is stored and drawn: `HH:MM`, zero-padded, 24-hour. */
export type Clock = string

const SHAPE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** True only for the one shape this is ever stored in. */
export const isClock = (value: unknown): value is Clock =>
  typeof value === 'string' && SHAPE.test(value)

/** Minutes from midnight, for arithmetic rather than for reading. */
export function minutesOf(value: unknown): number | null {
  if (!isClock(value)) return null
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export interface StopTime {
  startsAt?: string | null
  endsAt?: string | null
  /** The words that used to share the box with the numbers. */
  timeNote?: string | null
}

/** Minutes from midnight for when a stop begins, or null if nobody said. */
export function startMinutes(stop?: StopTime | null): number | null {
  /* One time given is when the thing happens, whichever box it landed in.
     The editor moves a lone end into the start on the way out, so this is
     only ever reached by a row that predates it or a client that did not. */
  return minutesOf(stop?.startsAt) ?? minutesOf(stop?.endsAt)
}

/** Whether the window runs past midnight into the following day. */
export function endsAfterMidnight(stop?: StopTime | null): boolean {
  const from = minutesOf(stop?.startsAt)
  const to = minutesOf(stop?.endsAt)
  return from !== null && to !== null && to < from
}

/**
 * When a stop is over, in minutes counted from the start of its own day.
 *
 * Its end, or its start when it is a moment rather than a window — a stop
 * with one time on it is not a stop that never finishes.
 *
 * Past midnight the count keeps going rather than wrapping: a stop running
 * 23:00 to 01:00 ends at 1500, not 60. Read as 60 it would be finished
 * twenty-two hours before it began, and everything downstream would need the
 * same special case to avoid believing that.
 */
export function windowEndMinutes(stop?: StopTime | null): number | null {
  const to = minutesOf(stop?.endsAt)
  if (to === null) return minutesOf(stop?.startsAt)
  return endsAfterMidnight(stop) ? to + 1440 : to
}

const clock = (value: unknown): string => (isClock(value) ? value : '')

/**
 * A stop's time, as one string, for anywhere it is read rather than edited.
 *
 * A window is drawn as a range and a moment as itself — and a window whose
 * two ends are the same time is a moment, because `14:00 – 14:00` is nobody's
 * idea of an hour. The note leads, which is where it was in the text people
 * were typing: `Check-in 14:00`, `Doors 19:00 – 23:00`.
 */
export function stopTimeLabel(stop?: StopTime | null): string {
  const from = clock(stop?.startsAt)
  const to = clock(stop?.endsAt)
  const range = from && to && from !== to ? `${from} – ${to}` : from || to
  const note = String(stop?.timeNote ?? '').trim()
  return [note, range].filter(Boolean).join(' ')
}
