import type { DayRow, StopRow, TimelineRow } from './timeline-core'

/* Reading the timeline the way a journal is kept, and finding things in it.
 *
 * The rows come from timeline-core in the order the days were lived. This
 * turns them round when asked — newest first is the default, so on the trip
 * today is the top of the screen and afterwards the last day is — and keeps
 * only the rows that carry the words somebody typed. Pure, like the rows. */

export type TimelineOrder = 'newest' | 'oldest'

/* Days newest first: today, or the last day once the trip is over, at the
   top and the first morning at the bottom. Each day is still read morning
   to evening — a day turned upside down is not a day anybody lived — and
   the things with no date at all stay at the end either way. */
export function orderRows(rows: TimelineRow[], order: TimelineOrder): TimelineRow[] {
  if (order !== 'newest') return rows
  const groups: TimelineRow[][] = []
  for (const row of rows) {
    if (row.kind === 'day' || !groups.length) groups.push([row])
    else groups[groups.length - 1].push(row)
  }
  const dated = groups.filter(group => group[0].kind === 'day' && group[0].iso)
  const undated = groups.filter(group => !(group[0].kind === 'day' && group[0].iso))
  return [...dated.reverse(), ...undated].flat()
}

/** The words a row can be found by. */
export function rowText(row: TimelineRow): string {
  switch (row.kind) {
    case 'day':
      return row.label
    case 'stop': {
      const { stop } = row
      return [stop.name, stop.note, stop.kind, stop.timeNote, stop.startsAt, stop.endsAt]
        .filter(Boolean)
        .join(' ')
    }
    case 'shots':
      return row.ordered.map(photo => photo.caption || '').join(' ')
    case 'travel': {
      const { segment } = row
      return [
        segment.carrier,
        segment.number,
        segment.fromCode,
        segment.fromName,
        segment.toCode,
        segment.toName,
        segment.mode,
        segment.ref,
      ]
        .filter(Boolean)
        .join(' ')
    }
    default:
      return ''
  }
}

/* The rows that carry every word of the query, under the heading of each
   day that still has something on it. A day found by its own name keeps
   its whole day; a stop found keeps its photographs; a photograph found by
   its caption keeps the stop it was taken at; the road between two stops
   is nobody's search. */
export function filterRows(rows: TimelineRow[], query: string): TimelineRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return rows
  const matches = (row: TimelineRow) => {
    const text = rowText(row).toLowerCase()
    return words.every(word => text.includes(word))
  }
  const kept: TimelineRow[] = []
  let heading: DayRow | null = null
  let wholeDay = false
  let headingKept = false
  let lastStop: StopRow | null = null
  let stopKept = false
  for (const row of rows) {
    if (row.kind === 'day') {
      heading = row
      wholeDay = matches(row)
      headingKept = wholeDay
      lastStop = null
      stopKept = false
      if (wholeDay) kept.push(row)
      continue
    }
    if (row.kind === 'leg') continue
    const wanted: boolean = wholeDay || matches(row) || (row.kind === 'shots' && stopKept)
    if (row.kind === 'stop') {
      lastStop = row
      stopKept = wanted
    }
    if (!wanted) continue
    if (heading && !headingKept) {
      kept.push(heading)
      headingKept = true
    }
    if (row.kind === 'shots' && lastStop && !stopKept) {
      kept.push(lastStop)
      stopKept = true
    }
    kept.push(row)
  }
  return kept
}
