import { useCallback, useRef, useState, type PointerEvent } from 'react'

/* A handle that follows the finger.
 *
 * The bar at the bottom of a phone opened and closed on a tap of its grabber
 * and on nothing else, which is not what a grabber says it does. This is
 * the gesture: press, and the bar comes along for the first few dozen
 * pixels; let go past the threshold — or flick — and it opens or closes;
 * let go short of it and it settles back. A tap still toggles, because a
 * press that never moved is a tap. Pointer events, so a mouse can do it
 * too, and capture, so a finger that wanders off the handle keeps it. */

/** How far a drag has to go before letting go counts as a decision. */
export const DRAG_DECIDES_PX = 28
/** How far the bar itself follows, so a long pull does not tear it off the screen. */
const FOLLOWS_PX = 40
/** A fast short flick decides too. */
const FLICK_PX_PER_MS = 0.45

export interface SheetDrag {
  /** the bar's own offset while a finger is on it, for a transform */
  offset: number
  dragging: boolean
  handle: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onPointerMove: (event: PointerEvent<HTMLElement>) => void
    onPointerUp: (event: PointerEvent<HTMLElement>) => void
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void
  }
}

/**
 * @param collapsed whether the sheet is currently down
 * @param onCollapse asked with true to collapse, false to open
 */
export default function useSheetDrag(
  collapsed: boolean,
  onCollapse: (collapsed: boolean) => void,
): SheetDrag {
  const start = useRef<{ y: number; at: number; id: number } | null>(null)
  const moved = useRef(0)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    start.current = { y: event.clientY, at: event.timeStamp, id: event.pointerId }
    moved.current = 0
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }, [])

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!start.current || start.current.id !== event.pointerId) return
    const dy = event.clientY - start.current.y
    moved.current = dy
    setOffset(Math.max(-FOLLOWS_PX, Math.min(FOLLOWS_PX, dy)))
  }, [])

  const settle = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const begun = start.current
      if (!begun || begun.id !== event.pointerId) return
      start.current = null
      setDragging(false)
      setOffset(0)
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      const dy = moved.current
      const speed = Math.abs(dy) / Math.max(1, event.timeStamp - begun.at)
      const decided = Math.abs(dy) >= DRAG_DECIDES_PX || speed >= FLICK_PX_PER_MS
      if (Math.abs(dy) < 6) {
        onCollapse(!collapsed) // a press that never moved is a tap
      } else if (decided) {
        onCollapse(dy > 0) // down collapses, up opens
      }
    },
    [collapsed, onCollapse],
  )

  const onPointerCancel = useCallback(() => {
    start.current = null
    setDragging(false)
    setOffset(0)
  }, [])

  return {
    offset,
    dragging,
    handle: { onPointerDown, onPointerMove, onPointerUp: settle, onPointerCancel },
  }
}
