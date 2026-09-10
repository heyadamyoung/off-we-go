import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import {
  carryDistance,
  dragMeans,
  followed,
  isDoubleTap,
  pageBy,
  type Tap,
} from '../../../swipe-core'

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
  /* Where the finger went down, and the tap before this one. Refs rather than
     state: a gesture in progress is not something the screen should redraw
     for, and re-rendering mid-drag is how a drag loses its own start. */
  const from = useRef<{ x: number; y: number; at: number } | null>(null)
  const lastTap = useRef<Tap | null>(null)
  const opening = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => clearTimeout(opening.current ?? undefined), [])

  /* How far the photograph has followed the finger, and whether a finger is
     still on it. A swipe that moves nothing is a swipe you cannot tell is
     working; letting the picture move says "yes, this is a page turn" while
     there is still time to change your mind. State rather than a ref, because
     this one is drawn — it is the only part of a gesture that is. */
  const [dx, setDx] = useState(0)
  const [sliding, setSliding] = useState(false)

  /* How far this particular picture has to be carried. Measured off the stage
     the finger is actually on, at the moment it goes down, so a phone turned
     on its side asks for the width it now has. */
  const carry = useRef(64)

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    /* The arrows and the film's own controls live on this stage too, and a
       click on one of them is a tap as far as a pointer is concerned — so
       turning the page with the arrow ALSO opened the picture full screen.
       A control is answering for itself; the stage stays out of it. */
    if (fromChrome(event.target)) {
      from.current = null
      return
    }
    carry.current = carryDistance(event.currentTarget.getBoundingClientRect().width)
    from.current = { x: event.clientX, y: event.clientY, at: event.timeStamp }
    setSliding(true)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const start = from.current
    if (!start) return
    setDx(followed({ dx: event.clientX - start.x, dy: event.clientY - start.y }))
  }, [])

  /* Let go of the drag and let the picture ease home. Cancelling counts: a
     pointer the browser takes away mid-swipe must not leave the photograph
     parked half off the screen. */
  const forget = useCallback(() => {
    from.current = null
    setSliding(false)
    setDx(0)
  }, [])

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const start = from.current
      from.current = null
      if (!start) {
        setSliding(false)
        setDx(0)
        return
      }

      const means = dragMeans(
        {
          dx: event.clientX - start.x,
          dy: event.clientY - start.y,
          ms: event.timeStamp - start.at,
        },
        { travel: carry.current },
      )

      if (means === 'next' || means === 'previous') {
        lastTap.current = null
        clearTimeout(opening.current ?? undefined)
        opening.current = null
        /* Home with no easing, because the page is turning: easing here walks
           the OUTGOING photograph back to the middle in front of you and only
           then swaps it, which reads as the swipe being refused a moment
           before it is obeyed. `sliding` is left on, so this frame has no
           transition; the next photograph simply arrives where it belongs. */
        setDx(0)
        setIndex(pageBy(means, index, length))
        return
      }

      // Not paging: let it ease back to the middle, which is the whole point.
      setSliding(false)
      setDx(0)
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
    [index, length, setIndex, onLike, onOpen],
  )

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: forget,
    },
    /* What the stage draws: how far across, and whether to ease. Under the
       finger it tracks exactly; let go and it eases — to the next photograph
       if the swipe carried, back to the middle if it did not. */
    dx,
    sliding,
  }
}
