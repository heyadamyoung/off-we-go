import { useMemo, useState } from 'react'
import NowCard from './now-card'
import { NowCapsule } from './trip-chrome'
import { tripNow } from '../../../trip-now-core'
import useTripNotices from '../model/use-trip-notices'
import type { deriveLiveStopProgress } from '../../../live-stop-progress-core'
import type { Stop, TripPhoto } from '../../../shared/model/types'

/* The one thing on the map screen that talks.
 *
 * Everything else there is reactive — it answers what you tap and says nothing
 * on its own — so this owns the whole of the other half: the pill with the
 * live line on it, and the card it opens into with the rest of the answer.
 *
 * Its own file because it is its own surface, the same way the floating stop
 * cards are. The page decides what exists on the map; this decides what the
 * map says about it.
 */
export default function TripNow({
  progressCopy,
  progress,
  stops,
  photos,
  tripId,
  clock,
  travelling,
  liveStop,
  onSelect,
  onFollow,
  onPhotos,
}: {
  tripId: string
  progressCopy: {
    text: string
    meta?: string
    tone: 'waiting' | 'heading' | 'approaching' | 'arrived' | 'complete'
  }
  progress: ReturnType<typeof deriveLiveStopProgress>
  stops: Stop[]
  photos: TripPhoto[]
  /** The page's own minute clock, so a countdown is not a number that sticks. */
  clock: number
  /** Whether this person is on the trip or following it. */
  travelling: boolean
  liveStop: Stop | null
  onSelect: (stop: Stop) => void
  onFollow: (stop: Stop | null) => void
  onPhotos: (photo: TripPhoto) => void
}) {
  const [open, setOpen] = useState(false)

  /* What this person has missed while they were not looking. Everybody gets
     the pictures; only somebody following gets told about arriving somewhere,
     because the person who arrived was there. */
  /* Held rather than rebuilt: a fresh array every render is a fresh answer
     every render, which recomputes the notices, re-fires the effect that wakes
     the phone, and replaces the very row somebody is reaching for. */
  const doneStopIds = useMemo(
    () => [...progress.behindStopIds, ...progress.visitedStopIds],
    [progress],
  )
  const { notices, markSeen } = useTripNotices({
    tripId,
    stops,
    photos,
    doneStopIds,
    travelling,
  })

  /* Gathered once from what the live layer and the calendar already worked
     out. A second opinion about where somebody is would eventually disagree
     with the first one, and the two would be on the same screen. */
  const now = useMemo(
    () =>
      tripNow(
        {
          stops,
          photos,
          visitedStopIds: progress.visitedStopIds,
          behindStopIds: progress.behindStopIds,
          destination: progress.destination,
        },
        new Date(clock),
      ),
    [stops, photos, progress, clock],
  )

  const shut =
    <T,>(act: (value: T) => void) =>
    (value: T) => {
      act(value)
      setOpen(false)
    }

  return (
    <>
      <NowCapsule
        text={progressCopy.text}
        meta={progressCopy.meta}
        tone={progressCopy.tone}
        open={open}
        unread={notices.length}
        onClick={() => setOpen(value => !value)}
      />
      {/* The capsule opened out. The map keeps the screen; this is a card on
          it, and every row in it is a way back to a place on that map. */}
      {open && (
        <NowCard
          now={now}
          notices={notices}
          headline={progressCopy.text}
          meta={progressCopy.meta}
          travelling={travelling}
          onFollow={() => shut(onFollow)(liveStop)}
          onNotice={notice => {
            /* Reading one is reading the lot: somebody who has opened the card
               has seen everything in it, and leaving the rest marked unread
               would have the pill lie about what is waiting. */
            markSeen()
            const stop = notice.stopId ? stops.find(one => one.id === notice.stopId) : null
            const photo = notice.photoId ? photos.find(one => one.id === notice.photoId) : null
            if (notice.kind === 'photos' && photo) shut(onPhotos)(photo)
            else if (stop) shut(onSelect)(stop)
            else setOpen(false)
          }}
          onStop={shut(onSelect)}
          onPhotos={shut(onPhotos)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
