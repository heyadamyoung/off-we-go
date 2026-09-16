import { dayLabelOf } from './day-label-core'
import { orderingMinutes } from './stop-order-core'
import { groupByDay } from './trip-days-core'
import { localTime, type Segment } from './segments-core'
import type { Id, Stop, TripLeg, TripPhoto } from './shared/model/types'

/* The timeline as a flat list of rows, which is the whole trick.
 *
 * It was a nest — days holding stops holding a row per photograph — and a nest
 * cannot be windowed. So a trip with four thousand pictures on it put four
 * thousand buttons in the document and asked a phone to scroll them. The
 * gallery was given a window of its own long ago for exactly this reason; the
 * timeline was left behind and kept rendering the entire trip.
 *
 * Flattened, every row knows its own height and the slice on screen is
 * arithmetic rather than a guess. The heights live here rather than in the
 * stylesheet because the sums below and the boxes the browser lays out have to
 * agree exactly: a window computed from numbers the CSS does not honour slides
 * faster than the rows inside it, and the drift grows the further down a long
 * trip somebody reads.
 */

export const DAY_HEIGHT = 36
export const STOP_HEIGHT = 62
export const SHOTS_HEIGHT = 96
export const LEG_HEIGHT = 26
export const TRAVEL_HEIGHT = 62

/* How many thumbnails fit on the narrowest phone before the row has to
   scroll sideways. The rest are a count — an afternoon is a strip and a
   number, not fourteen rows of text. */
export const SHOTS_SHOWN = 5

/* A screen's worth either side, so a fast thumb meets rows that are already
   there. More would be rendering a trip nobody is looking at; less and the
   bottom of the screen is blank for a frame on a flick. */
const OVERSCAN = 1

export interface DayRow {
  kind: 'day'
  key: string
  iso: string | null
  label: string
  /* Counted apart, because a day with two flights on it saying "4 stops" is
     the heading telling a small lie about the only thing it says. */
  stops: number
  journeys: number
  today: boolean
  height: number
}

export interface StopRow {
  kind: 'stop'
  key: string
  stop: Stop
  height: number
}

export interface ShotsRow {
  kind: 'shots'
  key: string
  stop: Stop
  /** the handful drawn */
  photos: TripPhoto[]
  /** all of them, in order, so the viewer opened from a thumbnail can page
      through the whole afternoon rather than the five that happened to fit */
  ordered: TripPhoto[]
  /** how many there are altogether */
  count: number
  height: number
}

export interface LegRow {
  kind: 'leg'
  key: string
  from: Stop
  leg: TripLeg
  height: number
}

export interface TravelRow {
  kind: 'travel'
  key: string
  segment: Segment
  /** the clock at the airport it leaves from, which is the only one that
      means anything to somebody standing in it */
  at: string
  height: number
}

export type TimelineRow = DayRow | StopRow | ShotsRow | LegRow | TravelRow

/* Where a journey falls, read on the clock of the place it leaves from.
   Departing 23:35 in Los Angeles is a Tuesday night there and a Wednesday
   morning in UTC, and filed on the wrong one it disappears from the day the
   person flying is going to be looking at. */
function departure(segment: Segment): { day: string; minutes: number; at: string } | null {
  const when = segment?.departsAt ? new Date(segment.departsAt) : null
  if (!when || !Number.isFinite(when.getTime())) return null

  /* The clock from the same function the Travel view prints, so the two
     screens can never disagree about when a flight leaves — and the sort key
     read back out of it, so what is shown and what it is ordered by are one
     string rather than two calculations that agree until one changes. */
  const at = localTime(segment.departsAt, segment.departTz).replace(/^24:/, '00:')
  const [hour, minute] = at.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }
  let found: Intl.DateTimeFormatPart[]
  try {
    found = new Intl.DateTimeFormat('en-GB', {
      ...options,
      timeZone: segment.departTz || undefined,
    }).formatToParts(when)
  } catch {
    found = new Intl.DateTimeFormat('en-GB', options).formatToParts(when)
  }
  const piece = (type: string) => found.find(part => part.type === type)?.value ?? ''
  return {
    day: `${piece('year')}-${piece('month')}-${piece('day')}`,
    minutes: hour * 60 + minute,
    at,
  }
}

/**
 * Every row of the timeline, in reading order.
 *
 * @param today the ISO date where the trip is now, so one heading can say so
 */
export function timelineRows({
  stops = [],
  photos = [],
  segments = [],
  legs,
  today = null,
}: {
  stops?: Stop[]
  photos?: TripPhoto[]
  segments?: readonly Segment[]
  legs?: Map<Id, TripLeg> | null
  today?: string | null
}): TimelineRow[] {
  /* Journeys bucketed by the day they leave on, earliest first, so a day with
     two flights reads in the order somebody takes them. A segment with no
     departure is left out rather than guessed at. */
  const flights = new Map<string, Array<{ segment: Segment; minutes: number; at: string }>>()
  for (const segment of segments) {
    const leaves = departure(segment)
    if (!leaves) continue
    const held = flights.get(leaves.day)
    const entry = { segment, minutes: leaves.minutes, at: leaves.at }
    if (held) held.push(entry)
    else flights.set(leaves.day, [entry])
  }
  for (const day of flights.values()) day.sort((a, b) => a.minutes - b.minutes)

  if (!stops.length && !flights.size) return []

  /* One pass for the pictures rather than a filter inside the loop: a scan per
     stop is the trip squared, and the trips this exists for are the long
     ones. */
  const taken = new Map<Id, TripPhoto[]>()
  for (const photo of photos) {
    if (!photo.stopId) continue
    const here = taken.get(photo.stopId)
    if (here) here.push(photo)
    else taken.set(photo.stopId, [photo])
  }

  const rows: TimelineRow[] = []
  /* The hour each stop sits at, carried from a neighbour when it has none of
     its own — the same key the itinerary itself is ordered by, so a flight
     slotted against it lands where the order already says it should. */
  const hourOf = orderingMinutes(stops)

  /* Grouped the same way the day chips are, so a stop with no day at all still
     belongs to a heading and is still drawn. Days that are ONLY travel are
     added to the list: the whole point of a travel day is that nothing is
     planned because the day IS the flight, and a timeline that skips it says
     the trip skipped it. */
  const grouped = groupByDay(stops)
  const planned = new Set(grouped.map(group => group.day?.iso).filter(Boolean) as string[])
  const onlyTravel = [...flights.keys()]
    .filter(day => !planned.has(day))
    .map(iso => ({ day: { iso, label: dayLabelOf(iso) || iso }, things: [] as Stop[] }))
  const days = [...grouped, ...onlyTravel].sort(byDay)

  for (const group of days) {
    const iso = group.day?.iso ?? null
    const leaving = (iso && flights.get(iso)) || []
    rows.push({
      kind: 'day',
      key: `day:${iso ?? 'undated'}`,
      iso,
      label: group.day?.label ?? 'No date yet',
      stops: group.things.length,
      journeys: leaving.length,
      today: Boolean(iso && today && iso === today),
      height: DAY_HEIGHT,
    })

    let flown = 0
    const fly = (before: number | null) => {
      while (flown < leaving.length && (before === null || leaving[flown].minutes <= before)) {
        const { segment, at } = leaving[flown]
        rows.push({
          kind: 'travel',
          key: `travel:${segment.id}`,
          segment,
          at,
          height: TRAVEL_HEIGHT,
        })
        flown += 1
      }
    }

    for (const stop of group.things) {
      fly(hourOf.get(stop.id) ?? null)
      rows.push({ kind: 'stop', key: `stop:${stop.id}`, stop, height: STOP_HEIGHT })
      const here = taken.get(stop.id)
      if (here?.length)
        rows.push({
          kind: 'shots',
          key: `shots:${stop.id}`,
          stop,
          photos: here.slice(0, SHOTS_SHOWN),
          ordered: here,
          count: here.length,
          height: SHOTS_HEIGHT,
        })
      const leg = legs?.get(stop.id)
      if (leg)
        rows.push({ kind: 'leg', key: `leg:${stop.id}`, from: stop, leg, height: LEG_HEIGHT })
    }
    // An evening flight after the last thing planned, and the whole of a
    // travel day, arrive here.
    fly(null)
  }
  return rows
}

/* Dated days in date order, then whatever has no day at all — the order
   groupByDay already returns, kept when a travel-only day is folded in. */
const byDay = (a: { day: { iso: string } | null }, b: { day: { iso: string } | null }): number => {
  if (!a.day) return b.day ? 1 : 0
  if (!b.day) return -1
  return a.day.iso < b.day.iso ? -1 : a.day.iso > b.day.iso ? 1 : 0
}

export interface RowWindow<Row> {
  rows: Row[]
  /** the height of everything above the slice, as a spacer */
  above: number
  /** and below, so the scrollbar tells the truth about the trip's length */
  below: number
}

/**
 * The rows on screen, and the empty space standing in for the rest.
 *
 * Measured rather than counted. A day heading is not a stop is not a strip of
 * photographs, and a window that treats them as one height drifts further from
 * the truth the further down somebody reads.
 */
export function windowRows<Row extends { height: number }>(
  rows: readonly Row[],
  { scrolled = 0, viewportHeight = 0 }: { scrolled?: number; viewportHeight?: number },
  overscan = OVERSCAN,
): RowWindow<Row> {
  if (!rows.length) return { rows: [], above: 0, below: 0 }

  const margin = Math.max(viewportHeight, 0) * overscan
  const wantedFrom = Math.max(0, scrolled - margin)
  const wantedTo = scrolled + Math.max(viewportHeight, 0) + margin

  let above = 0
  let first = 0
  /* Walked rather than searched. It is one addition per row of a list that is
     already in memory, and the alternative is a prefix-sum table rebuilt every
     time a photograph arrives. */
  while (first < rows.length && above + rows[first].height <= wantedFrom) {
    above += rows[first].height
    first += 1
  }

  let last = first
  let drawn = 0
  while (last < rows.length && above + drawn < wantedTo) {
    drawn += rows[last].height
    last += 1
  }
  /* Scrolled past the end — a trip that shrank while somebody was reading it,
     or a measurement taken before the panel settled. Draw the end. */
  if (last === first && first > 0) {
    first -= 1
    above -= rows[first].height
    drawn = rows[first].height
    last = first + 1
  }

  let below = 0
  for (let index = last; index < rows.length; index += 1) below += rows[index].height

  return { rows: rows.slice(first, last), above, below }
}
