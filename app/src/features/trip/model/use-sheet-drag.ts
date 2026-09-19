import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'

/* A sheet that follows the finger.
 *
 * The bar at the bottom of a phone opens and closes on its grabber. This is
 * the gesture: press anywhere on the handle strip, and the bar comes along
 * — down the whole way to where it will sit collapsed, or up the whole way
 * to its open height, growing from the bottom of the screen; let go past
 * the threshold, or flick, and it opens or closes; let go short of it and it
 * settles back. A tap still toggles, because a press that never moved is a
 * tap. Pointer events with capture, so a mouse can do it and a finger that
 * wanders off the handle keeps it.
 *
 * Down is a slide: the bar's top comes down with the finger and its bottom
 * goes under the edge of the screen, which nobody sees. Up is a stretch:
 * the bar's bottom stays on the edge of the screen and its top rises, so
 * it is never a floating strip with a gap of map under it — which is what
 * sliding it up did, before snapping back to where its feet were.
 *
 * The bar is moved by hand — a transform or a height written straight onto
 * the element on every move, never through React — because a re-render of
 * the day's cards per pointer event was the jank, and the browser must never
 * see the gesture as its own: the handle refuses every touch action, and a
 * touchmove on it is stopped before Android can read it as pull-to-refresh
 * or a scroll that hides the address bar. */

/** How far a drag has to go before letting go counts as a decision. */
export const DRAG_DECIDES_PX = 28
/** The collapsed bar's height before the safe area, as .barpeek declares it. */
export const PEEK_PX = 80
/** The open bar's height on a phone before the safe area, as :root declares it under 640px. */
export const OPEN_PX = 208
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

/** Where the bar's top goes for a finger `dy` down from where it started:
    negative is up. Collapsed, it rises with the finger the whole way to
    its open height and resists past it, and barely sinks under a pull down.
    Open, it comes down with the finger to its collapsed place and no
    further, and does not move under a pull up — there is nothing above to
    show, and a bar lifted off the bottom of the screen is a bar with a gap
    under it. */
export function followBy(dy: number, collapsed: boolean, travel: number): number {
  if (collapsed) {
    if (dy >= 0) return resist(dy) / 2
    const up = -dy
    return -(Math.min(travel, up) + (up > travel ? resist(up - travel) / 2 : 0))
  }
  return dy < 0 ? 0 : Math.min(travel, dy)
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
  const start = useRef<{
    y: number
    at: number
    id: number
    travel: number
    height: number
  } | null>(null)
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

  /* A move down is a transform; a move up is a taller bar. Zero is home:
     both come off, and with `eased` the stylesheet's own height glides the
     bar to wherever its class now says it belongs. */
  const place = useCallback((dy: number, eased: boolean) => {
    const element = sheet.current
    if (!element) return
    element.style.transition = eased ? 'transform .18s ease, height .18s ease' : 'none'
    if (dy < 0) {
      element.style.transform = ''
      element.style.height = `${(start.current?.height ?? 0) - dy}px`
    } else {
      element.style.height = ''
      element.style.transform = dy ? `translate3d(0, ${dy}px, 0)` : ''
    }
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
        height,
        travel: collapsed ? OPEN_PX - PEEK_PX : Math.max(0, height - PEEK_PX - padding),
      }
      moved.current = 0
      event.currentTarget.setPointerCapture?.(event.pointerId)
      if (element) element.style.willChange = 'transform, height'
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
      setDragging(false)
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      const dy = moved.current
      const speed = Math.abs(dy) / Math.max(1, event.timeStamp - begun.at)
      const decided = Math.abs(dy) >= DRAG_DECIDES_PX || speed >= FLICK_PX_PER_MS
      const opening = collapsed && dy < 0 && decided
      if (opening) {
        /* The bar is already most of the way up by hand. Let the class
           change first, then take the hand-set height off on the next
           frame, so the stylesheet glides it the last of the way rather
           than dropping it to its collapsed height and growing it again. */
        onCollapse(false)
        requestAnimationFrame(() => {
          place(0, true)
          start.current = null
          if (sheet.current) sheet.current.style.willChange = ''
        })
        return
      }
      start.current = null
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
    place(0, true)
    start.current = null
    setDragging(false)
  }, [place])

  return {
    sheet,
    dragging,
    handle: { ref: grip, onPointerDown, onPointerMove, onPointerUp: settle, onPointerCancel },
  }
}
