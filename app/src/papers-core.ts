import { segmentName, type Segment, type SegmentDocument } from './segments-core'
import type { Stop, StopDocument } from './shared/model/types'

/* Everything you are carrying, in one list, with the next thing at the top.
 *
 * A document has always been reachable only through the stop or the leg it
 * hangs off. To find the boarding pass you had to remember you filed it on
 * that flight, go to Travel, find the flight, open its papers, then the file:
 * five taps and a memory test. And if you have to remember where you put it,
 * your email is just as fast — which is why the feature went unused on a real
 * trip. There was no place in this app that meant "your documents".
 *
 * So the order is the feature, not the gathering. At a desk with a queue
 * behind you the paper you want is almost always for the thing about to
 * happen, and everything else is a list you scroll.
 *
 * Its cousin next door in offline-papers-core answers a different question —
 * which files to fetch before anybody asks for them — and needs nothing but an
 * id and somewhere to fetch from. This one is what a person reads.
 */

export interface Paper {
  id: string
  name: string
  kind: string
  mime: string
  src: string
  note?: string | null
  /** what it is for, in the words on its own row: `KL 677 · Amsterdam → Calgary` */
  for: string
  /** the moment that thing happens, for ordering; null when nothing says */
  at: number | null
  segmentId?: string
  stopId?: string
}

const instant = (value: unknown): number | null => {
  const when = value ? Date.parse(String(value)) : Number.NaN
  return Number.isFinite(when) ? when : null
}

/* A stop keeps a day and a wall clock rather than an instant, so this reads
   them in the reader's own zone — the same arithmetic the sample trip and the
   day grouping already use. Good enough to sort by, which is all it is for. */
const stopAt = (stop: Stop): number | null => {
  if (!stop?.day) return null
  const clock = stop.startsAt || stop.endsAt
  return instant(clock ? `${stop.day}T${clock}:00` : `${stop.day}T12:00:00`)
}

const paperFrom = (
  doc: StopDocument | SegmentDocument,
  about: { for: string; at: number | null; segmentId?: string; stopId?: string },
): Paper | null => {
  if (!doc?.src) return null
  const mime = String(doc.mime || '')
  return {
    id: doc.id,
    name: doc.name,
    kind: doc.kind || 'other',
    mime,
    src: doc.src,
    note: doc.note ?? null,
    ...about,
  }
}

/* One home's worth, read as things a person reaches for. A leg and a stop
   differ only in what a row says under the name and in what orders it, so the
   card on a travel leg and the tab that gathers the whole trip draw the same
   Paper rather than two hopefully-similar shapes. */
export function papersOfSegment(segment: Segment): Paper[] {
  const about = {
    for: segmentName(segment),
    at: instant(segment?.departsAt),
    segmentId: segment?.id,
  }
  return (segment?.documents || [])
    .map(doc => paperFrom(doc, about))
    .filter((paper): paper is Paper => !!paper)
}

export function papersOfStop(stop: Stop): Paper[] {
  const about = { for: stop?.name || 'A stop', at: stopAt(stop), stopId: stop?.id }
  return (stop?.documents || [])
    .map(doc => paperFrom(doc, about))
    .filter((paper): paper is Paper => !!paper)
}

/**
 * Every document on a trip, in the order somebody reaches for them.
 *
 * What is about to happen first, soonest first. Then the papers that are
 * always relevant and never due — insurance, a passport scan. Then what is
 * finished, most recent first, because yesterday's pass still beats last
 * week's.
 */
export function papersOnTrip(
  { stops = [], segments = [] }: { stops?: readonly Stop[]; segments?: readonly Segment[] },
  now: number = Date.now(),
): Paper[] {
  const papers: Paper[] = []
  for (const segment of segments) papers.push(...papersOfSegment(segment))
  for (const stop of stops) papers.push(...papersOfStop(stop))

  /* Three piles rather than one comparison, because "soonest first" and "most
     recent first" run in opposite directions and a single sort key that does
     both is a key nobody can read six months later. */
  const ahead = papers.filter(paper => paper.at !== null && (paper.at as number) >= now)
  const undated = papers.filter(paper => paper.at === null)
  const behind = papers.filter(paper => paper.at !== null && (paper.at as number) < now)
  ahead.sort((a, b) => (a.at as number) - (b.at as number))
  behind.sort((a, b) => (b.at as number) - (a.at as number))
  return [...ahead, ...undated, ...behind]
}
