/* A trip's photographs, arranged the way somebody would actually look at them.

   A flat grid of everything, newest first, is the right answer for ten
   photographs and the wrong one for two thousand: it is a wall, and finding
   the afternoon at the Rijksmuseum means scrolling past three days of other
   things to reach it. The trip already knows where its stops are and the
   server already files each photograph at the nearest one, so the grid can be
   the itinerary instead of a wall — one collapsible card per place, in the
   order the trip visits them, and everything taken nowhere near any of them
   gathered at the end rather than dropped.

   And an escape hatch, because grouping is only better when the grouping is
   right: a plain chronological list, which is what a camera roll is and what
   somebody wants when the itinerary is half-written or the pictures are of
   the journey rather than the destinations.

   Windowing has to survive both. The existing grid window is arithmetic on a
   uniform row height, which stops being true the moment there are headers
   between the rows and groups that collapse. So this measures instead: every
   row — header or three photographs — knows its own height and where it
   starts, and the visible slice is a search through those offsets. Same
   guarantee as before, that a trip can hold as many photographs as it likes
   without the grid being the reason it cannot, and now without the grid
   having to pretend everything in it is the same shape.

   No DOM here, and nothing about React. Heights come in as numbers because
   the thing that measures them is the thing that renders them. */

export type GroupMode = 'stop' | 'date'

export interface GroupablePhoto {
  id: string
  stopId?: string | null
  takenAt?: string | null
  seq?: number
}

export interface GroupableStop {
  id: string
  name: string
  seq?: number
}

export interface PhotoGroup<P = GroupablePhoto> {
  /** Stable across renders, so collapsing one card cannot move another. */
  key: string
  title: string
  /** The stop this card is, or null for the one that collects the rest. */
  stopId: string | null
  photos: P[]
}

/* Newest first, matching the flat grid this replaces: the last thing you did
   is the thing you are most likely looking for. A photograph with no time of
   its own falls back to the order it arrived in, which is the only other
   thing known about when it happened. */
const newestFirst = <P extends GroupablePhoto>(photos: P[]): P[] =>
  [...photos].sort((a, b) => {
    const left = a.takenAt ? Date.parse(a.takenAt) : Number.NaN
    const right = b.takenAt ? Date.parse(b.takenAt) : Number.NaN
    const bothTimed = !Number.isNaN(left) && !Number.isNaN(right)
    if (bothTimed && left !== right) return right - left
    /* One timed and one not is not a comparison worth inventing an answer to,
       so both fall through to arrival order and neither jumps the queue. */
    return (b.seq ?? 0) - (a.seq ?? 0)
  })

/** What the card for unfiled photographs is called. */
export const ELSEWHERE = 'Everywhere else'

/**
 * One group per itinerary item that has photographs, in the trip's own order,
 * and one at the end for everything that belongs to none of them.
 *
 * A stop with nothing at it is left out rather than shown empty: a column of
 * empty cards is a worse way to read an itinerary than the itinerary is.
 */
export function groupByStop<P extends GroupablePhoto>(
  photos: P[],
  stops: GroupableStop[],
): PhotoGroup<P>[] {
  const held = new Map<string, P[]>()
  const loose: P[] = []
  for (const photo of photos) {
    const key = photo.stopId
    if (!key) {
      loose.push(photo)
      continue
    }
    const found = held.get(key)
    if (found) found.push(photo)
    else held.set(key, [photo])
  }

  const ordered = [...stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const groups: PhotoGroup<P>[] = []
  for (const stop of ordered) {
    const mine = held.get(stop.id)
    if (mine?.length) {
      groups.push({ key: stop.id, title: stop.name, stopId: stop.id, photos: newestFirst(mine) })
      held.delete(stop.id)
    }
  }

  /* Filed at a stop the itinerary no longer has. It should not happen — the
     server re-files a trip whenever its stops change — but a photograph is
     not worth losing to a race, so anything left over joins the last card. */
  const orphaned = [...held.values()].flat()
  const rest = [...loose, ...orphaned]
  if (rest.length) {
    groups.push({ key: '~elsewhere', title: ELSEWHERE, stopId: null, photos: newestFirst(rest) })
  }
  return groups
}

/** Everything in one card, in the order it was taken. */
export function ungrouped<P extends GroupablePhoto>(photos: P[]): PhotoGroup<P>[] {
  if (!photos.length) return []
  return [{ key: '~all', title: '', stopId: null, photos: newestFirst(photos) }]
}

export function groupPhotos<P extends GroupablePhoto>(
  photos: P[],
  stops: GroupableStop[],
  mode: GroupMode,
): PhotoGroup<P>[] {
  return mode === 'stop' ? groupByStop(photos, stops) : ungrouped(photos)
}

/* How many photographs fit across, given the room there is.

   Three was right when this lived in a 440px column and wrong the moment the
   grid could have the whole screen: the same three tiles stretched to 500px
   each is not a gallery, it is a slideshow with extra steps. So the count
   comes from the width, aiming at a tile somebody can actually recognise a
   face in, and is bounded at both ends — never so few that a wide screen
   wastes itself, never so many that a phone shows a mosaic. */
export function columnsForWidth(width: number, { target = 150, min = 3, max = 10 } = {}): number {
  if (!(width > 0)) return min
  return Math.max(min, Math.min(max, Math.floor(width / target)))
}

export type LayoutRow<P = GroupablePhoto> =
  | { kind: 'header'; key: string; group: PhotoGroup<P>; top: number; height: number }
  | {
      kind: 'photos'
      key: string
      group: PhotoGroup<P>
      items: P[]
      top: number
      height: number
    }

export interface LayoutInput {
  columns: number
  /** One row of square cells, including the gap beneath it. */
  rowHeight: number
  /** A card's title bar, including whatever sits between it and the last one. */
  headerHeight: number
  /** Keys of the groups currently rolled up. */
  collapsed?: ReadonlySet<string>
  /** A single untitled group draws no header. */
  showHeaders?: boolean
}

/**
 * Every row the grid would draw, flattened, each knowing where it sits.
 *
 * Flattened on purpose: a window over one list is a search, and a window over
 * a list of lists is bookkeeping.
 */
export function layoutGroups<P extends GroupablePhoto>(
  groups: PhotoGroup<P>[],
  { columns, rowHeight, headerHeight, collapsed, showHeaders = true }: LayoutInput,
): { rows: LayoutRow<P>[]; height: number } {
  const cols = Math.max(1, Math.floor(columns) || 1)
  const rows: LayoutRow<P>[] = []
  let top = 0
  for (const group of groups) {
    if (showHeaders) {
      rows.push({ kind: 'header', key: `h:${group.key}`, group, top, height: headerHeight })
      top += headerHeight
    }
    if (collapsed?.has(group.key)) continue
    for (let index = 0; index < group.photos.length; index += cols) {
      const items = group.photos.slice(index, index + cols)
      rows.push({
        kind: 'photos',
        key: `${group.key}:${index}`,
        group,
        items,
        top,
        height: rowHeight,
      })
      top += rowHeight
    }
  }
  return { rows, height: top }
}

export interface RowWindow {
  start: number
  end: number
  topPad: number
  bottomPad: number
}

/**
 * Which of those rows are worth putting in the document.
 *
 * @param scrolled how far the scroller has moved past the top of the grid
 */
export function windowRows<P extends GroupablePhoto>(
  rows: LayoutRow<P>[],
  height: number,
  {
    scrolled,
    viewportHeight,
    overscanRows = 3,
  }: {
    scrolled: number
    viewportHeight: number
    overscanRows?: number
  },
): RowWindow {
  if (!rows.length) return { start: 0, end: 0, topPad: 0, bottomPad: 0 }
  /* Nothing measured yet: render everything rather than nothing. A grid that
     is briefly heavy beats a grid that is briefly empty, and the first
     measurement is one frame away. */
  if (!(viewportHeight > 0)) return { start: 0, end: rows.length, topPad: 0, bottomPad: 0 }

  const from = Math.max(0, scrolled)
  /* Never past the last row there is. The panel shares one scroller across
     its views, so arriving here from a longer one arrives already scrolled
     past the whole grid — and a slice from beyond the end to the end renders
     nothing at all, with the scrollbar still claiming everything is there. */
  let first = lowerBound(rows, from)
  first = Math.min(first, rows.length - 1)
  const start = Math.max(0, first - overscanRows)

  let end = start
  const until = from + viewportHeight
  while (end < rows.length && rows[end].top < until) end += 1
  end = Math.min(rows.length, end + overscanRows)

  const topPad = rows[start].top
  const lastEdge = rows[end - 1].top + rows[end - 1].height
  return { start, end, topPad, bottomPad: Math.max(0, height - lastEdge) }
}

/** The first row whose bottom edge is past `offset`. */
function lowerBound<P extends GroupablePhoto>(rows: LayoutRow<P>[], offset: number): number {
  let low = 0
  let high = rows.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (rows[middle].top + rows[middle].height <= offset) low = middle + 1
    else high = middle
  }
  return low
}
