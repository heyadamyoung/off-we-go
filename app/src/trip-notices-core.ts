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

export type NoticeKind = 'arrived' | 'landed' | 'photos' | 'flight'

/* A journey, for what a notice needs to know about one: where it was going,
   and what the airport's board last said about it. The far end is the news
   — nobody at home is waiting to hear that a plane left — unless the airport
   said so itself, with the time and the belt, which is better news. */
export interface NoticeSegment {
  id: string
  toName?: string | null
  /** the board's last sentence, written by the server's flight watch */
  statusNote?: string | null
  flight?: { status?: string | null } | null
}

export interface Notice {
  /** Stable for the same happening, so a list can be keyed by it. */
  id: string
  kind: NoticeKind
  title: string
  /** Where on the map it happened, when it happened anywhere in particular. */
  stopId?: string
  /** Which journey ended, so a landing can open the leg it belongs to. */
  segmentId?: string
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
  /* Journeys already known to have ended. Absent, not empty, on a mark
     written before landings were counted — and the difference matters: empty
     means none had, absent means nobody was keeping track, and treating the
     second as the first turns the update itself into the news. */
  landed?: string[]
  /** What each leg's board had said, by leg, the last time this person looked.
      Absent on a mark written before the airports were listened to, for the
      same reason landings can be. */
  words?: Record<string, string>
}

export interface NoticeInput<S extends NoticeStop, P extends NoticePhoto> {
  /** The itinerary, in schedule order. */
  stops?: readonly S[]
  photos?: readonly P[]
  /** Stops a phone stood at, or the clock has gone past. */
  doneStopIds?: readonly string[]
  /** The getting-there legs, in the order they are travelled. */
  segments?: readonly NoticeSegment[]
  /** Journeys the trail can account for having ended — see landedSegments. */
  landedSegmentIds?: readonly string[]
}

/* When a picture was taken. A photograph with no time of its own cannot be
   compared against a watermark at all, so it counts as seen: announcing it on
   every single open would be a worse failure than missing it once. */
const takenAt = (photo: NoticePhoto): number => {
  const own = Date.parse(String(photo.when ?? ''))
  return Number.isFinite(own) ? own : 0
}

const wordsOf = (segments: readonly NoticeSegment[]): Record<string, string> =>
  Object.fromEntries(
    segments
      .filter(leg => typeof leg.statusNote === 'string' && leg.statusNote.trim())
      .map(leg => [leg.id, (leg.statusNote as string).trim()]),
  )

export function seenNow<S extends NoticeStop, P extends NoticePhoto>({
  photos = [],
  doneStopIds = [],
  segments = [],
  landedSegmentIds = [],
}: NoticeInput<S, P>): Seen {
  return {
    done: [...doneStopIds],
    photosTo: photos.reduce((newest, photo) => Math.max(newest, takenAt(photo)), 0),
    landed: [...landedSegmentIds],
    words: wordsOf(segments),
  }
}

/* Stable for the same sentence, so a list can be keyed by it and a phone
   that has buzzed for it once does not buzz again. */
const hashOf = (text: string): string => {
  let hash = 0
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return (hash >>> 0).toString(36)
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
  {
    stops = [],
    photos = [],
    doneStopIds = [],
    segments = [],
    landedSegmentIds = [],
  }: NoticeInput<S, P>,
  seen: Seen | null,
  { arrivals: wantArrivals = true }: NoticeLimits = {},
): Notice[] {
  /* Nobody has missed anything they have never been shown. Without this, a
     follower's first open announces the entire trip as news, which is the
     opposite of the point. */
  if (!seen) return []

  const known = new Set(seen.done)
  const nowDone = new Set(doneStopIds)
  const nowLanded = new Set(landedSegmentIds)
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

  /* Did they land — the one question a family at home actually asks on a
     travel day, and one this app can answer from its own trail without a word
     from any airline. News to everybody except whoever was on the plane, which
     is the same rule an arrival follows.

     A mark with no record of landings makes no claim about them, so nothing is
     announced this once: otherwise the update itself becomes the news, and
     every follower is told about every flight of the whole trip the first time
     they open it. */
  /* What the airport said since, in its own sentence: "KL 677 has landed at
     06:10. Dublin Airport, 06:12." News to everybody, the traveller included
     — a gate that moved is not their own life reported back to them. A mark
     with no record of words makes no claim, and announces nothing this once. */
  const words: Notice[] = (seen.words ? segments : [])
    .filter(leg => {
      const note = leg.statusNote?.trim()
      return !!note && seen.words?.[leg.id] !== note
    })
    .map(leg => ({
      id: `flight:${leg.id}:${hashOf(leg.statusNote as string)}`,
      kind: 'flight' as const,
      title: (leg.statusNote as string).trim(),
      segmentId: leg.id,
    }))
  /* The board's landing outranks the trail's: it has the time and the belt.
     One landing, said once, when both notice it at the same look. */
  const landedByBoard = new Set(
    words
      .map(word => segments.find(leg => leg.id === word.segmentId))
      .filter(leg => leg?.flight?.status && ['landed', 'arrived'].includes(leg.flight.status))
      .map(leg => (leg as NoticeSegment).id),
  )

  const landings: Notice[] = (wantArrivals && seen.landed ? segments : [])
    .filter(
      leg => nowLanded.has(leg.id) && !seen.landed?.includes(leg.id) && !landedByBoard.has(leg.id),
    )
    .map(leg => ({
      id: `landed:${leg.id}`,
      kind: 'landed' as const,
      title: leg.toName ? `Landed at ${leg.toName}` : 'Landed',
      segmentId: leg.id,
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

  /* The airport first of all — a cancellation, a gate, a landing with its
     belt — then a landing the trail noticed: a family who have been watching
     a plane cross an ocean are not reading past it. Then a place, because
     somebody reaching the lighthouse is bigger news than the pictures they
     took when they got there — and the pictures are usually of the place
     anyway. */
  return [...words, ...landings, ...arrivals, ...pictures]
}
