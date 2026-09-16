/* What has happened since somebody last looked.
 *
 * A trip app where the interesting moment happens and nobody is told is a trip
 * app people open twice. Family had to remember to check, and the map — which
 * is the whole reason they came — never said anything had changed.
 *
 * This is a difference, not a clock, and that is the load-bearing decision.
 * Arrivals carry no timestamp anywhere in the app: a stop is behind you
 * because a phone stood at it or because its hour went past, and neither of
 * those records a moment. Timing an arrival at the stop's own scheduled hour
 * would be reporting the plan as if it were the event, and would say the wrong
 * thing about anybody early or late. So what is new is what was not in the
 * snapshot taken the last time this person looked, which cannot be wrong about
 * anything — and needs nothing from the server, which is why it works for
 * every follower on every platform rather than the ones we have certificates
 * for.
 */

export interface NoticeStop {
  id: string
  name: string
}

export interface NoticePhoto {
  id: string
  stopId?: string | null
  when?: string | null
}

export type NoticeKind = 'arrived' | 'photos'

export interface Notice {
  /** Stable for the same happening, so a list can be keyed by it. */
  id: string
  kind: NoticeKind
  title: string
  /** Where on the map it happened, when it happened anywhere in particular. */
  stopId?: string
  /** Which picture to open the gallery at. */
  photoId?: string
  count?: number
}

/** The snapshot to compare the next look against. */
export interface Seen {
  /** Stops already known to be behind them. */
  done: string[]
  /** The newest photograph already seen, as an instant. */
  photosTo: number
}

export interface NoticeInput<S extends NoticeStop, P extends NoticePhoto> {
  /** The itinerary, in schedule order. */
  stops?: readonly S[]
  photos?: readonly P[]
  /** Stops a phone stood at, or the clock has gone past. */
  doneStopIds?: readonly string[]
}

/* When a picture was taken. A photograph with no time of its own cannot be
   compared against a watermark at all, so it counts as seen: announcing it on
   every single open would be a worse failure than missing it once. */
const takenAt = (photo: NoticePhoto): number => {
  const own = Date.parse(String(photo.when ?? ''))
  return Number.isFinite(own) ? own : 0
}

export function seenNow<S extends NoticeStop, P extends NoticePhoto>({
  photos = [],
  doneStopIds = [],
}: NoticeInput<S, P>): Seen {
  return {
    done: [...doneStopIds],
    photosTo: photos.reduce((newest, photo) => Math.max(newest, takenAt(photo)), 0),
  }
}

export interface NoticeLimits {
  /* Whether reaching a place counts as news. It is not, to the person who
     reached it: telling somebody they arrived somewhere they are standing is
     the app reporting their own life back to them, and one line of that is
     enough to stop anybody reading the rest. New photographs are news to
     everybody — a traveller who spent three hours driving missed the forty
     pictures from the back seat exactly as much as anybody at home did. */
  arrivals?: boolean
}

export function noticesSince<S extends NoticeStop, P extends NoticePhoto>(
  { stops = [], photos = [], doneStopIds = [] }: NoticeInput<S, P>,
  seen: Seen | null,
  { arrivals: wantArrivals = true }: NoticeLimits = {},
): Notice[] {
  /* Nobody has missed anything they have never been shown. Without this, a
     follower's first open announces the entire trip as news, which is the
     opposite of the point. */
  if (!seen) return []

  const known = new Set(seen.done)
  const nowDone = new Set(doneStopIds)
  /* Read off the itinerary rather than off the list of ids, so arrivals come
     in the order the day ran rather than the order the evidence arrived. */
  const arrivals: Notice[] = (wantArrivals ? stops : [])
    .filter(stop => nowDone.has(stop.id) && !known.has(stop.id))
    .map(stop => ({
      id: `arrived:${stop.id}`,
      kind: 'arrived' as const,
      title: `Arrived at ${stop.name}`,
      stopId: stop.id,
    }))

  /* One notice a place, counted. Fourteen pictures from one afternoon is one
     thing that happened; fourteen notifications is a reason to turn
     notifications off. */
  const fresh = photos.filter(photo => takenAt(photo) > seen.photosTo)
  const byPlace = new Map<string, { at: string | null; newest: P; count: number }>()
  for (const photo of fresh) {
    const where = photo.stopId ? String(photo.stopId) : ''
    const group = byPlace.get(where)
    if (!group) {
      byPlace.set(where, {
        at: photo.stopId ? String(photo.stopId) : null,
        newest: photo,
        count: 1,
      })
      continue
    }
    group.count += 1
    if (takenAt(photo) >= takenAt(group.newest)) group.newest = photo
  }

  const named = new Map(stops.map(stop => [stop.id, stop.name] as const))
  const pictures: Notice[] = [...byPlace.values()].map(group => {
    const place = group.at ? named.get(group.at) : null
    const many = group.count === 1 ? '1 new photograph' : `${group.count} new photographs`
    return {
      id: `photos:${group.at ?? 'anywhere'}:${group.newest.id}`,
      kind: 'photos' as const,
      title: place ? `${many} at ${place}` : many,
      ...(group.at ? { stopId: group.at } : {}),
      photoId: group.newest.id,
      count: group.count,
    }
  })

  /* A place first. Somebody reaching the lighthouse is bigger news than the
     pictures they took when they got there, and the pictures are usually of
     the place anyway. */
  return [...arrivals, ...pictures]
}
