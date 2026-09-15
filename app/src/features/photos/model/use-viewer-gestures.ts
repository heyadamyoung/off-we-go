import { useCallback, useEffect, useRef } from 'react'
import type React from 'react'
import {
  carryDistance,
  dragMeans,
  followed,
  isDoubleTap,
  lastMoments,
  speedFrom,
  type Moment,
  type Tap,
} from '../../../swipe-core'
import useFilmTrack from './use-film-track'

/* What a finger does to the photograph on the viewer's stage.
 *
 * Three gestures share one surface, and the whole trick is that they cannot
 * be told apart until the finger lifts:
 *
 *   swipe across   turn the page
 *   double tap     heart it
 *   single tap     open it full screen, on its own
 *
 * Before this there was only the third of those, and it was a like: the whole
 * photograph was a button, so a swipe ended as a tap and every attempt to page
 * through a trip hearted the picture instead of moving. One reader now decides
 * which of the three happened, so two of them can never happen at once.
 *
 * The single tap waits out the double tap that hearts it. That wait is the
 * same one every phone uses, and without it a like would flash the full-screen
 * view open on its way past.
 *
 * Where the strip goes once the answer is in is use-film-track's, and the
 * full-screen view reads its own gestures onto the same track.
 */

/* Whether a pointer came down on something that answers for itself. The
   photograph is a button too — it is the keyboard's way to like — so it is the
   one control the stage still reads. */
function fromChrome(target: EventTarget | null): boolean {
  const control = (target as Element | null)?.closest?.('button, a[href], input, video')
  return !!control && !control.classList.contains('vmaintap')
}

export default function useViewerGestures({
  index,
  length,
  setIndex,
  onLike,
  onOpen,
}: {
  index: number
  length: number
  setIndex: (index: number) => void
  onLike: () => void
  onOpen: () => void
}) {
  const track = useFilmTrack({ index, length, setIndex })

  /* Where the finger went down, and the tap before this one. Refs rather than
     state: a gesture in progress is not something the screen should redraw
     for, and re-rendering mid-drag is how a drag loses its own start. */
  const from = useRef<{ x: number; y: number; at: number } | null>(null)
  // The last moment of the gesture, for how fast it was going when it left.
  const recent = useRef<Moment[]>([])
  const lastTap = useRef<Tap | null>(null)
  const opening = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => clearTimeout(opening.current ?? undefined), [])

  /* How far this particular picture has to be carried. Measured off the stage
     the finger is actually on, at the moment it goes down, so a phone turned
     on its side asks for the width it now has. */
  const carry = useRef(64)

  const { takeOver, follow, page, home } = track

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      /* The arrows and the film's own controls live on this stage too, and a
         click on one of them is a tap as far as a pointer is concerned — so
         turning the page with the arrow ALSO opened the picture full screen.
         A control is answering for itself; the stage stays out of it. */
      if (fromChrome(event.target)) {
        from.current = null
        return
      }
      takeOver()
      carry.current = carryDistance(event.currentTarget.getBoundingClientRect().width)
      from.current = { x: event.clientX, y: event.clientY, at: event.timeStamp }
      recent.current = [{ x: event.clientX, at: event.timeStamp }]
    },
    [takeOver],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = from.current
      if (!start) return
      recent.current.push({ x: event.clientX, at: event.timeStamp })
      recent.current = lastMoments(recent.current, event.timeStamp)
      follow(followed({ dx: event.clientX - start.x, dy: event.clientY - start.y }))
    },
    [follow],
  )

  /* Let go of the drag and let the picture ease home. Cancelling counts: a
     pointer the browser takes away mid-swipe must not leave the photograph
     parked half off the screen. */
  const forget = useCallback(() => {
    from.current = null
    home()
  }, [home])

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const start = from.current
      from.current = null
      if (!start) return

      const means = dragMeans(
        {
          dx: event.clientX - start.x,
          dy: event.clientY - start.y,
          ms: event.timeStamp - start.at,
          vx: speedFrom(recent.current, event.timeStamp, event.clientX),
        },
        { travel: carry.current },
      )
      recent.current = []

      if (means === 'next' || means === 'previous') {
        lastTap.current = null
        clearTimeout(opening.current ?? undefined)
        opening.current = null
        page(means === 'next' ? 1 : -1)
        return
      }

      home()
      if (means !== 'tap') return

      const tap = { at: event.timeStamp, x: event.clientX, y: event.clientY }
      clearTimeout(opening.current ?? undefined)
      opening.current = null
      if (isDoubleTap(lastTap.current, tap)) {
        lastTap.current = null
        onLike()
        return
      }
      lastTap.current = tap
      opening.current = setTimeout(() => {
        opening.current = null
        onOpen()
      }, 330)
    },
    [home, onLike, onOpen, page],
  )

  return {
    ...track,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: forget,
      /* The browser must not take this gesture for a drag.

         A mouse swipe selects whatever it crosses, and the swipe after that
         drags the selection — at which point the browser sends pointercancel
         and keeps the rest for itself. No pointerup arrives, so this reader,
         which decides what a gesture meant at the moment the finger lifts,
         never hears that it did: the photograph eases back and the page does
         not turn, with nothing on screen to say why. It needs a selection to
         exist first, which is why it bit on the second swipe and read as a
         flake. The stylesheet stops the selection; this stops the drag. */
      onDragStart: (event: React.DragEvent) => event.preventDefault(),
    },
  }
}
