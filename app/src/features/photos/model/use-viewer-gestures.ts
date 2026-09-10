import { useCallback, useEffect, useRef } from 'react'
import type React from 'react'
import { dragMeans, isDoubleTap, pageBy, type Tap } from '../../../swipe-core'

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

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    from.current = { x: event.clientX, y: event.clientY, at: event.timeStamp }
  }, [])

  const forget = useCallback(() => {
    from.current = null
  }, [])

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const start = from.current
      from.current = null
      if (!start) return

      const means = dragMeans({
        dx: event.clientX - start.x,
        dy: event.clientY - start.y,
        ms: event.timeStamp - start.at,
      })

      if (means === 'next' || means === 'previous') {
        lastTap.current = null
        clearTimeout(opening.current ?? undefined)
        opening.current = null
        setIndex(pageBy(means, index, length))
        return
      }
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

  return { onPointerDown, onPointerUp, onPointerCancel: forget }
}
