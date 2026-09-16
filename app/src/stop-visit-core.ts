import { startMinutes, type StopTime } from './stop-time-core'

/* The plan and what happened, said in one breath.
 *
 * "Planned 09:45 · arrived 10:20, left 11:40" is the one sentence an itinerary
 * app that also carries a phone can write and an itinerary app on its own
 * cannot. A planner owns the plan and has no idea what happened; a location
 * history owns what happened and has no plan to hold it against. This app has
 * had both facts since it first drew a map and has never put them in the same
 * row — the arrival was worked out to light a pin and thrown away.
 *
 * All of the care here goes on one trap. A plan is a wall clock — 09:45, the
 * way a ticket prints it — and an arrival is an absolute instant. Read the
 * instant on the wrong wall and this is worse than nothing: a follower in
 * Sydney is told the family reached the museum at twenty past seven in the
 * evening, and never trusts a number in this app again. So every reading goes
 * through the zone the visit was recorded in, which is the zone of the phone
 * that was standing there.
 */

export interface StopVisit extends StopTime {
  /** the day the plan is written against, as an ISO date */
  day?: string | null
  arrivedAt?: string | null
  leftAt?: string | null
  /** the zone the two above were recorded in — see server/src/stop-visits.js */
  visitZone?: string | null
}

const instant = (value: unknown): Date | null => {
  if (!value) return null
  const when = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(when.getTime()) ? when : null
}

/* An unknown zone reads in the viewer's own clock rather than not at all: a
   phone that registered before it knew where it was still took the fix, and a
   row that says nothing is worse than a row that is an hour out. */
function parts(when: Date, zone?: string | null): Intl.DateTimeFormatPart[] {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }
  try {
    return new Intl.DateTimeFormat('en-GB', {
      ...options,
      timeZone: zone || undefined,
    }).formatToParts(when)
  } catch {
    return new Intl.DateTimeFormat('en-GB', options).formatToParts(when)
  }
}

const piece = (found: Intl.DateTimeFormatPart[], type: string) =>
  found.find(part => part.type === type)?.value ?? ''

/** An instant on the wall clock of the place it happened: `10:20`. */
export function zoneClock(at: unknown, zone?: string | null): string {
  const when = instant(at)
  if (!when) return ''
  const found = parts(when, zone)
  /* Midnight comes back as 24 from some engines, and "24:10" is not a time
     anybody has ever read on a clock. */
  const hour = piece(found, 'hour').replace(/^24$/, '00')
  return `${hour}:${piece(found, 'minute')}`
}

/** The calendar day an instant fell on, where it fell: `2026-09-16`. */
function zoneDay(at: Date, zone?: string | null): string {
  const found = parts(at, zone)
  return `${piece(found, 'year')}-${piece(found, 'month')}-${piece(found, 'day')}`
}

/**
 * What happened, in the words a person would use.
 *
 * Only ever what is known. A departure appears once a later fix proved they
 * went somewhere else, and until then the row must not imply that they have —
 * a phone that goes quiet has not left anywhere.
 */
export function visitLabel(stop?: StopVisit | null): string {
  const came = zoneClock(stop?.arrivedAt, stop?.visitZone)
  if (!came) return ''
  const went = zoneClock(stop?.leftAt, stop?.visitZone)
  return went ? `arrived ${came}, left ${went}` : `arrived ${came}`
}

/* Days, not milliseconds, because the two sides are a calendar day apart at
   most in every case worth drawing and the arithmetic is exact. */
const DAY_MS = 86_400_000
const dayGap = (from: string, to: string) => {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY_MS) : 0
}

/**
 * Minutes late, or minutes early as a negative number, or null when there is
 * nothing to compare.
 *
 * The sum is the one a person does: the plan said a quarter to ten, the clock
 * on the wall said twenty past, so thirty-five minutes. Which means the day
 * has to be counted too — planned for ten to midnight and there at ten past is
 * twenty minutes late, and read as clock times alone it would be twenty-three
 * hours and forty minutes EARLY. That is the kind of wrong that makes somebody
 * stop reading the column.
 */
export function driftMinutes(stop?: StopVisit | null): number | null {
  const planned = startMinutes(stop)
  const when = instant(stop?.arrivedAt)
  if (planned === null || !when) return null
  const zone = stop?.visitZone
  const clock = zoneClock(when, zone)
  const [hours, minutes] = clock.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  /* A stop with no day of its own makes no claim about which one, so the
     arrival is taken to be on it. */
  const slid = stop?.day ? dayGap(stop.day, zoneDay(when, zone)) : 0
  return hours * 60 + minutes + slid * 1440 - planned
}

/* Under this nobody is late. A plan written to the minute is still a plan
   written by somebody who meant "about a quarter to ten", and an app that
   reports three minutes as a failure is an app that nags. */
const ON_TIME_MINUTES = 5

const spell = (total: number): string => {
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  if (hours < 24) return `${hours} h ${String(total % 60).padStart(2, '0')}`
  const days = Math.round(hours / 24)
  return days === 1 ? 'a day' : `${days} days`
}

/** `35 min late`, `20 min early`, `on time`, or nothing to say. */
export function driftLabel(stop?: StopVisit | null): string {
  const drift = driftMinutes(stop)
  if (drift === null) return ''
  if (Math.abs(drift) < ON_TIME_MINUTES) return 'on time'
  return `${spell(Math.abs(drift))} ${drift > 0 ? 'late' : 'early'}`
}

/** How long they were there, once both ends are known. */
export function stayMinutes(stop?: StopVisit | null): number | null {
  const came = instant(stop?.arrivedAt)
  const went = instant(stop?.leftAt)
  if (!came || !went) return null
  return Math.round((went.getTime() - came.getTime()) / 60_000)
}

/** `1 h 20 there`, `35 min there`, or nothing while they are still there. */
export function stayLabel(stop?: StopVisit | null): string {
  const stayed = stayMinutes(stop)
  return stayed === null || stayed <= 0 ? '' : `${spell(stayed)} there`
}
