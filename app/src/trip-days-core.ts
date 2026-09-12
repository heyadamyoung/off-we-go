/* Which day a thing belongs to, decided once.

   A stop's day is an ISO date — '2026-09-04' — and nothing else. It is the
   identity, the sort key, and what the calendar picker writes; the label a
   traveller reads is worked out when it is drawn.

   It was not always. For most of this app's life a day was whatever somebody
   typed into a box: 'Fri 4 Sep', '4', 'Sep 4', 'tbc'. This module used to know
   how to read all of it, and a trip's own date range had to be threaded
   through every function that touched a day so a label with no year could be
   given one. Migration 025 converted what was in the database; migration 029
   clears what has been written since, and the API now refuses anything else,
   so nothing has to be decoded here any more.

   That leaves one rule, in one place: an ISO date or no day at all.

   Do not add a reading back. A value that has to be guessed at is a value two
   screens will guess differently, which is how '4' and 'Fri 4 Sep' became two
   chips for one day. */

import { dayLabelOf } from './day-label-core'

const ISO = /^(\d{4})-(\d{2})-(\d{2})/
/**
 * The ISO date a stored day is, or null when it is not one.
 *
 * An instant is accepted and cut back to its date, because a photograph's
 * capture time arrives that way. Anything else — a label, a number, a word —
 * is not a day and is not guessed at.
 */
export function dayIsoOf(raw?: string | null): string | null {
  const text = String(raw ?? '').trim()
  const shaped = ISO.exec(text)
  if (!shaped) return null
  const iso = text.slice(0, 10)
  /* The shape is not enough. '2026-02-30' has it, and a Date rolls that over
     into March rather than refusing — which would put a stop on a day the trip
     does not have. Comparing the parts back is what catches it.

     The same rule is `isTripDay` in server/src/trip-day.js, which is the door
     this value comes through. Two copies on purpose: one refuses it on the way
     in, one refuses to draw it if a row predates the door. Keep them in step. */
  const at = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(at.getTime())) return null
  const [, year, month, day] = shaped
  const same =
    at.getFullYear() === Number(year) &&
    at.getMonth() + 1 === Number(month) &&
    at.getDate() === Number(day)
  return same ? iso : null
}

/**
 * The day a photograph belongs to.
 *
 * Its stop's day first, because a photograph taken at a place belongs with
 * that place's day even when the camera's clock disagrees. Failing that, the
 * moment it was taken — which is the only thing a photograph with no stop has,
 * and without this it could never appear under any day at all.
 */
export function photoDayIso(
  photo: { takenAt?: string | null; when?: string | null },
  stopDay?: string | null,
): string | null {
  const fromStop = dayIsoOf(stopDay)
  if (fromStop) return fromStop
  /* Either spelling. The server sends `when`; an upload on its way up carries
     `takenAt`. This read only the second of those, which is the field a
     photograph loaded from the server has never had — so every picture
     without a stop came back with no day at all, and fell out of the
     timeline, out of the by-date grouping, and off the map. */
  const taken = photo?.takenAt || photo?.when
  if (!taken) return null
  const at = new Date(taken)
  if (!Number.isFinite(at.getTime())) return null
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
    at.getDate(),
  ).padStart(2, '0')}`
}

export interface TripDay {
  /** The identity and the sort key. */
  iso: string
  /** What is drawn: 'Fri 4 Sep'. */
  label: string
}

/**
 * The days a trip actually has something on, oldest first.
 *
 * Built from what is there rather than from the declared range, so a trip
 * whose dates were never filled in still gets its days — and a range with
 * nothing on half of it does not draw a row of empty chips.
 */
export function tripDays(
  things: { day?: string | null }[],
  extraIsos: (string | null)[] = [],
): TripDay[] {
  /* Only the days something is actually on: a chip for a day with nothing
     under it selects an empty trip. The undated bucket is not a chip either —
     'All days' already shows those. */
  return bucket(things, extraIsos)
    .filter(group => group.day)
    .map(group => group.day!)
}

export interface DayGroup<T> {
  /** null for the things nothing can date — they still have to be drawn. */
  day: TripDay | null
  things: T[]
}

/**
 * The same days, with the things on each of them.
 *
 * The timeline used to do this itself, by de-duplicating the raw day text and
 * then matching stops against it with `===`. That made two headings out of '4'
 * and 'Fri 4 Sep', ordered Friday above Thursday, and — the reported bug —
 * dropped every stop with no day at all, because a stop in no group is drawn
 * nowhere. Sharing the bucketing with the chips is what keeps the two from
 * disagreeing again.
 */
export function groupByDay<T extends { day?: string | null }>(things: T[]): DayGroup<T>[] {
  return bucket(things)
}

/* One pass, so the chips and the timeline cannot come to different answers.
   Dated days first in date order, then whatever has no day at all. */
function bucket<T extends { day?: string | null }>(
  things: T[],
  extraIsos: (string | null)[] = [],
): DayGroup<T>[] {
  const dated = new Map<string, DayGroup<T>>()
  const undated: DayGroup<T> = { day: null, things: [] }

  /* Days something else knows about — a photograph's own date — so a day with
     only pictures on it is still a day of the trip. */
  for (const iso of extraIsos) {
    if (iso && !dated.has(iso))
      dated.set(iso, { day: { iso, label: dayLabelOf(iso) || iso }, things: [] })
  }

  for (const thing of things) {
    /* Anything that is not a date is no day at all. It used to be kept as
       written, in a bucket of its own, because the text was somebody's typing
       and losing it would lose their day. Nothing can type one any more — the
       picker writes a date and the API refuses the rest — so a value that is
       not one is a leftover, and drawing it as though it were a day of the
       trip is how two chips for one day happened. It still gets drawn: with
       the undated, which is where a stop nobody has given a day belongs. */
    const iso = dayIsoOf(thing.day)
    if (!iso) {
      undated.things.push(thing)
      continue
    }
    let group = dated.get(iso)
    if (!group) {
      group = { day: { iso, label: dayLabelOf(iso) || iso }, things: [] }
      dated.set(iso, group)
    }
    group.things.push(thing)
  }

  const inOrder = [...dated.values()].sort((a, b) => (a.day!.iso < b.day!.iso ? -1 : 1))
  return [...inOrder, ...(undated.things.length ? [undated] : [])]
}

/** Whether a thing belongs to the chosen day. Two dates, compared as dates. */
export function onDay(thingDay: string | null | undefined, chosen: string): boolean {
  const mine = dayIsoOf(thingDay)
  return !!mine && mine === dayIsoOf(chosen)
}
