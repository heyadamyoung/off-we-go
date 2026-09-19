import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'

/* A sheet that follows the finger.
 *
 * The bar at the bottom of a phone opens and closes on its grabber. This is
 * the gesture: press anywhere on the handle strip, and the bar comes along
 * — the whole way down to where it will sit collapsed, or up with a little
 * resistance when there is nothing more to show yet; let go past the
 * threshold, or flick, and it opens or closes; let go short of it and it
 * settles back. A tap still toggles, because a press that never moved is a
 * tap. Pointer events with capture, so a mouse can do it and a finger that
 * wanders off the handle keeps it.
 *
 * The bar is moved by hand — a transform written straight onto the element
 * on every move, never through React — because a re-render of the day's
 * cards per pointer event was the jank, and the browser must never see the
 * gesture as its own: the handle refuses every touch action, and a touchmove
 * on it is stopped before Android can read it as pull-to-refresh or a
 * scroll that hides the address bar. */

/** How far a drag has to go before letting go counts as a decision. */
export const DRAG_DECIDES_PX = 28
/** The collapsed bar's height before the safe area, as .barpeek declares it. */
export const PEEK_PX = 80
/** How far a collapsed bar lifts under a finger, since it cannot show more until it opens. */
const LIFT_PX = 48
/** A fast short flick decides too. */
const FLICK_PX_PER_MS = 0.45

const resist = (px: number) => Math.sqrt(Math.max(0, px)) * 4

export interface SheetDrag {
  /** the element that moves: the bar */
  sheet: RefObject<HTMLDivElement | null>
  dragging: boolean
  handle: {
    ref: RefObject<HTMLButtonElement | null>
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onPointerMove: (event: PointerEvent<HTMLElement>) => void
    onPointerUp: (event: PointerEvent<HTMLElement>) => void
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void
  }
}

/** Where the bar goes for a finger `dy` down from where it started. */
export function followBy(dy: number, collapsed: boolean, travel: number): number {
  if (collapsed) return dy < 0 ? -Math.min(LIFT_PX, resist(-dy)) : resist(dy) / 2
  return dy < 0 ? -resist(-dy) / 2 : Math.min(travel, dy)
}

/**
 * @param collapsed whether the sheet is currently down
 * @param onCollapse asked with true to collapse, false to open
 */
export default function useSheetDrag(
  collapsed: boolean,
  onCollapse: (collapsed: boolean) => void,
): SheetDrag {
  const sheet = useRef<HTMLDivElement>(null)
  const grip = useRef<HTMLButtonElement>(null)
  const start = useRef<{ y: number; at: number; id: number; travel: number } | null>(null)
  const moved = useRef(0)
  const [dragging, setDragging] = useState(false)

  /* Non-passive on purpose: React's own touch handlers are passive, and a
     passive listener cannot stop the browser's pull-to-refresh. */
  useEffect(() => {
    const element = grip.current
    if (!element) return
    const swallow = (event: TouchEvent) => {
      if (start.current) event.preventDefault()
    }
    element.addEventListener('touchmove', swallow, { passive: false })
    return () => element.removeEventListener('touchmove', swallow)
  }, [])

  const place = useCallback((dy: number, eased: boolean) => {
    const element = sheet.current
    if (!element) return
    element.style.transition = eased ? 'transform .18s ease, height .18s ease' : 'none'
    element.style.transform = dy ? `translate3d(0, ${dy}px, 0)` : ''
  }, [])

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const element = sheet.current
      const padding = element ? Number.parseFloat(getComputedStyle(element).paddingBottom) || 0 : 0
      const height = element?.getBoundingClientRect().height ?? 0
      start.current = {
        y: event.clientY,
        at: event.timeStamp,
        id: event.pointerId,
        travel: collapsed ? LIFT_PX : Math.max(0, height - PEEK_PX - padding),
      }
      moved.current = 0
      event.currentTarget.setPointerCapture?.(event.pointerId)
      if (element) element.style.willChange = 'transform'
      setDragging(true)
    },
    [collapsed],
  )

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const begun = start.current
      if (!begun || begun.id !== event.pointerId) return
      const dy = event.clientY - begun.y
      moved.current = dy
      place(followBy(dy, collapsed, begun.travel), false)
    },
    [collapsed, place],
  )

  const settle = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const begun = start.current
      if (!begun || begun.id !== event.pointerId) return
      start.current = null
      setDragging(false)
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      const dy = moved.current
      const speed = Math.abs(dy) / Math.max(1, event.timeStamp - begun.at)
      const decided = Math.abs(dy) >= DRAG_DECIDES_PX || speed >= FLICK_PX_PER_MS
      /* The transform comes off as the height changes, so a bar dragged all
         the way down to its collapsed place stays exactly there. */
      place(0, true)
      if (sheet.current) sheet.current.style.willChange = ''
      if (Math.abs(dy) < 6) {
        onCollapse(!collapsed) // a press that never moved is a tap
      } else if (decided) {
        onCollapse(dy > 0) // down collapses, up opens
      }
    },
    [collapsed, onCollapse, place],
  )

  const onPointerCancel = useCallback(() => {
    start.current = null
    setDragging(false)
    place(0, true)
  }, [place])

  return {
    sheet,
    dragging,
    handle: { ref: grip, onPointerDown, onPointerMove, onPointerUp: settle, onPointerCancel },
  }
}
