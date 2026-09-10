/* Which day a thing belongs to, decided once.

   A stop's day is stored as a label — 'Fri 4 Sep' — because that is what a
   traveller says and what every chip and card shows. That was fine while a
   label was the only thing anybody could type. It is not fine now, for three
   reasons the day chips were showing all at once:

   Labels are not sort keys. 'Fri 4 Sep' comes before 'Thu 3 Sep' in a string
   comparison, so the itinerary was ordering Friday ahead of Thursday and the
   chips came out in whatever order the rows happened to arrive.

   Labels are not identities. The row that says '4' and the row that says
   'Fri 4 Sep' are the same day of the same trip, and de-duplicating the raw
   text made two chips out of them. Before the date picker existed people
   typed whatever they liked, and all of it is still in the database.

   And a label is only meaningful against a trip. It carries no year on
   purpose, so 'Fri 4 Sep' names a date only once you know when the trip was.

   So the ISO date is the identity and the sort key, and the label is what is
   drawn. Everything that groups, orders or filters by day goes through here,
   and this is the one place that has to know what people used to type. */

import { dayLabelOf, isoOfDayLabel, tripDayIsos } from './day-label-core'

export interface DayRange {
  startsOn?: string | null
  endsOn?: string | null
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})/
const realDate = (iso: string) => {
  const at = new Date(`${iso}T12:00:00`)
  return Number.isFinite(at.getTime()) && iso.slice(0, 10) === iso ? iso : null
}

/**
 * The ISO date a stored day means, or null when nothing can be made of it.
 *
 * The trip's own range does the disambiguating: a label carries no year, and
 * a bare number carries nothing at all, but inside a fortnight in September
 * each of them names exactly one date.
 */
export function dayIsoOf(raw?: string | null, range: DayRange = {}): string | null {
  const text = String(raw ?? '').trim()
  if (!text) return null

  // Already a date, from a picker or an import. The commonest case now.
  const asIso = ISO.exec(text)
  if (asIso) return realDate(text.slice(0, 10))

  // The label the app writes, read back against the trip that gives it a year.
  const fromLabel = isoOfDayLabel(text, range.startsOn, range.endsOn)
  if (fromLabel) return fromLabel

  const days = tripDayIsos(range.startsOn, range.endsOn)
  if (!days.length) return null

  /* A bare number, which is most of the mess: people typed '4' for the fourth
     before there was anywhere to pick it. Read as a day of the month rather
     than as the trip's fourth day — the same number in a label means the day
     of the month, so this is the reading that makes '4' and 'Fri 4 Sep' the
     one day they plainly are. Only when the trip covers exactly one such
     date; a fortnight spanning two months is not a place to guess. */
  const number = /^\d{1,2}$/.test(text) ? Number(text) : null
  if (number !== null && number >= 1 && number <= 31) {
    const matches = days.filter(iso => Number(iso.slice(8, 10)) === number)
    return matches.length === 1 ? matches[0] : null
  }

  /* Anything else a browser can read — 'Sep 4', '4 September', '2026/09/04' —
     but only if it lands inside the trip. Left unplaced otherwise rather than
     inventing a day from a stray word. */
  const loose = new Date(`${text} ${days[0].slice(0, 4)}`)
  if (Number.isFinite(loose.getTime())) {
    const iso = `${loose.getFullYear()}-${String(loose.getMonth() + 1).padStart(2, '0')}-${String(
      loose.getDate(),
    ).padStart(2, '0')}`
    if (days.includes(iso)) return iso
  }
  return null
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
  range: DayRange = {},
): string | null {
  const fromStop = dayIsoOf(stopDay, range)
  if (fromStop) return fromStop
  const taken = photo?.takenAt
  if (!taken) return null
  const at = new Date(taken)
  if (!Number.isFinite(at.getTime())) return null
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
    at.getDate(),
  ).padStart(2, '0')}`
}

/**
 * A range guessed from dates we already know, for a trip that never declared
 * one. Labels carry no year and bare numbers carry nothing, so without some
 * range neither can be placed — and a trip whose dates were never filled in is
 * exactly the sort that has hand-typed days on it. The photographs know when
 * they were taken, which is enough to give the labels a year.
 */
export function impliedRange(isos: (string | null | undefined)[]): DayRange {
  const known = isos.filter((iso): iso is string => !!iso && !!ISO.exec(iso)).sort()
  if (!known.length) return {}
  /* Widened by a week either side: a label is only findable if its date is
     inside the range, and the first photograph of a trip is rarely its first
     morning. */
  const shift = (iso: string, days: number) => {
    const at = new Date(`${iso.slice(0, 10)}T12:00:00`)
    at.setDate(at.getDate() + days)
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
      at.getDate(),
    ).padStart(2, '0')}`
  }
  return { startsOn: shift(known[0], -7), endsOn: shift(known[known.length - 1], 7) }
}

export interface TripDay {
  /** The identity and the sort key. */
  iso: string
  /** What is drawn: 'Fri 4 Sep', or the stored text when it is all there is. */
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
  range: DayRange = {},
  extraIsos: (string | null)[] = [],
): TripDay[] {
  /* Only the days something is actually on: a chip for a day with nothing
     under it selects an empty trip. The undated bucket is not a chip either —
     'All days' already shows those. */
  return bucket(things, range, extraIsos)
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
export function groupByDay<T extends { day?: string | null }>(
  things: T[],
  range: DayRange = {},
): DayGroup<T>[] {
  return bucket(things, range)
}

/* One pass, so the chips and the timeline cannot come to different answers.
   Dated days first in date order, then the days nothing could date in the
   order they turned up, then whatever has no day at all. */
function bucket<T extends { day?: string | null }>(
  things: T[],
  range: DayRange,
  extraIsos: (string | null)[] = [],
): DayGroup<T>[] {
  const known = usableRange(range, things, extraIsos)
  const dated = new Map<string, DayGroup<T>>()
  const unplaced = new Map<string, DayGroup<T>>()
  const undated: DayGroup<T> = { day: null, things: [] }

  /* Days something else knows about — a photograph's own date — so a day with
     only pictures on it is still a day of the trip. */
  for (const iso of extraIsos) {
    if (iso && !dated.has(iso))
      dated.set(iso, { day: { iso, label: dayLabelOf(iso) || iso }, things: [] })
  }

  for (const thing of things) {
    const text = String(thing.day ?? '').trim()
    if (!text) {
      undated.things.push(thing)
      continue
    }
    /* A day nothing can place is kept as written rather than swept away —
       losing a day is worse than showing an odd one, and somebody who typed
       'tbc' still wants to find what is on it. With a range these resolve
       instead, which is what turns '4' and 'Fri 4 Sep' back into the one day
       they plainly are. */
    const iso = dayIsoOf(text, known)
    const into = iso ? dated : unplaced
    const key = iso ?? text
    let group = into.get(key)
    if (!group) {
      group = { day: { iso: key, label: (iso && dayLabelOf(iso)) || key }, things: [] }
      into.set(key, group)
    }
    group.things.push(thing)
  }

  const inOrder = [...dated.values()].sort((a, b) => (a.day!.iso < b.day!.iso ? -1 : 1))
  return [...inOrder, ...unplaced.values(), ...(undated.things.length ? [undated] : [])]
}

/** Whether a thing belongs to the chosen day, by date rather than by spelling. */
export function onDay(
  thingDay: string | null | undefined,
  chosen: string,
  range: DayRange = {},
): boolean {
  const mine = dayIsoOf(thingDay, range)
  const wanted = dayIsoOf(chosen, range)
  /* Both placed: compare dates, which is the point — '4', 'Fri 4 Sep' and
     '2026-09-04' all select the same stops. */
  if (mine && wanted) return mine === wanted
  /* Either one unplaceable: compare as written. A day nothing can date is
     still a day somebody chose off the bar, and it should still select its
     own rows rather than none. */
  return String(thingDay ?? '').trim() === String(chosen ?? '').trim()
}

/* The declared range, or one guessed from the dates that are already certain. */
function usableRange(
  range: DayRange,
  things: { day?: string | null }[],
  extraIsos: (string | null)[],
): DayRange {
  if (range.startsOn && range.endsOn) return range
  const certain = [...extraIsos, ...things.map(thing => String(thing.day ?? '').trim())]
  return { ...impliedRange(certain), ...range }
}
