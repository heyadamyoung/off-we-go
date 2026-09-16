import { useMemo, useState } from 'react'
import NowCard from './now-card'
import { NowCapsule } from './trip-chrome'
import { tripNow } from '../../../trip-now-core'
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
  clock,
  travelling,
  liveStop,
  onSelect,
  onFollow,
  onPhotos,
}: {
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
        onClick={() => setOpen(value => !value)}
      />
      {/* The capsule opened out. The map keeps the screen; this is a card on
          it, and every row in it is a way back to a place on that map. */}
      {open && (
        <NowCard
          now={now}
          headline={progressCopy.text}
          meta={progressCopy.meta}
          travelling={travelling}
          onFollow={() => shut(onFollow)(liveStop)}
          onStop={shut(onSelect)}
          onPhotos={shut(onPhotos)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
