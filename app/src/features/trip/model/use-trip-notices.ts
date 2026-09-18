import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { noticesSince, seenNow, type Notice, type Seen } from '../../../trip-notices-core'
import { tellTheFollower } from '../../../follower-notify'
import type { Segment } from '../../../segments-core'
import type { Stop, TripPhoto } from '../../../shared/model/types'

/* What this person has missed, kept between visits.
 *
 * The watermark lives on the device rather than on the server, and that is the
 * whole reason this works at all: a follower is somebody who opened a link, on
 * whatever they happened to be holding. Asking the server to remember what
 * each of them had seen would mean a row per watcher per trip and a signed-in
 * identity to hang it on, and it would still not tell anybody anything the
 * difference cannot.
 *
 * One key per trip, so following two of them at once does not have them
 * overwrite each other's marks.
 */

const keyFor = (tripId: string) => `wf-seen-${tripId}`

const readSeen = (tripId: string, store?: Pick<Storage, 'getItem'> | null): Seen | null => {
  try {
    const raw = (store ?? globalThis.localStorage)?.getItem(keyFor(tripId))
    if (!raw) return null
    const held = JSON.parse(raw) as Partial<Seen>
    /* A half-written mark is worse than none: it would announce whatever it
       failed to record. Anything that does not read back as a snapshot is
       treated as a first visit. */
    if (!Array.isArray(held.done) || typeof held.photosTo !== 'number') return null
    /* Landings are carried through only when the mark actually recorded them.
       A mark written before they were counted makes no claim either way, and
       filling in an empty list here would turn the update itself into news —
       every follower told about every flight of the whole trip, once. */
    const words =
      held.words && typeof held.words === 'object' && !Array.isArray(held.words)
        ? Object.fromEntries(
            Object.entries(held.words).filter(([, note]) => typeof note === 'string'),
          )
        : null
    return {
      done: held.done.map(String),
      photosTo: held.photosTo,
      ...(Array.isArray(held.landed) ? { landed: held.landed.map(String) } : {}),
      /* The airports' words likewise: a mark that never recorded them makes
         no claim, or every follower would be told every note on the trip. */
      ...(words ? { words: words as Record<string, string> } : {}),
    }
  } catch {
    return null
  }
}

const writeSeen = (tripId: string, mark: Seen, store?: Pick<Storage, 'setItem'> | null) => {
  try {
    ;(store ?? globalThis.localStorage)?.setItem(keyFor(tripId), JSON.stringify(mark))
  } catch {
    /* A browser with storage turned off simply never marks anything read; the
       map still works, and that is the part that matters. */
  }
}

export default function useTripNotices({
  tripId,
  stops,
  photos,
  doneStopIds,
  segments,
  landedSegmentIds,
  travelling,
}: {
  tripId: string
  stops: Stop[]
  photos: TripPhoto[]
  doneStopIds: readonly string[]
  /** the getting-there legs, so a landing can name where it landed */
  segments: readonly Segment[]
  /** which of them the trail can account for having ended */
  landedSegmentIds: readonly string[]
  /** Somebody on the trip rather than following it: they were there for the
      arrivals, so those are not news to them. The photographs still are. */
  travelling: boolean
}) {
  const [seen, setSeen] = useState<Seen | null>(() => readSeen(tripId))

  /* The first visit records where things stood and announces nothing. Nobody
     has missed what they have never been shown. */
  const started = useRef(false)
  useEffect(() => {
    if (started.current || seen) return
    started.current = true
    const mark = seenNow({ photos, doneStopIds, segments, landedSegmentIds })
    writeSeen(tripId, mark)
    setSeen(mark)
  }, [seen, tripId, photos, doneStopIds, segments, landedSegmentIds])

  const notices = useMemo(
    () =>
      noticesSince({ stops, photos, doneStopIds, segments, landedSegmentIds }, seen, {
        arrivals: !travelling,
      }),
    [travelling, stops, photos, doneStopIds, segments, landedSegmentIds, seen],
  )

  /* A notice the phone has already woken somebody for is not woken for again.
     The ids are stable for the same happening, which is what makes that a set
     rather than a guess. */
  const told = useRef(new Set<string>())
  useEffect(() => {
    const fresh = notices.filter(notice => !told.current.has(notice.id))
    if (!fresh.length) return
    for (const notice of fresh) told.current.add(notice.id)
    void tellTheFollower(fresh)
  }, [notices])

  /** Read: the mark moves to where things stand, and the list empties. */
  const markSeen = useCallback(() => {
    const mark = seenNow({ photos, doneStopIds, segments, landedSegmentIds })
    writeSeen(tripId, mark)
    setSeen(mark)
  }, [tripId, photos, doneStopIds, segments, landedSegmentIds])

  return { notices, markSeen }
}

export type { Notice }
