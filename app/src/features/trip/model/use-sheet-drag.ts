import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { flushSync } from 'react-dom'

/* A sheet that follows the finger, through three stages.
 *
 * The bar at the bottom of a phone has a peek (the handle and the day chips),
 * an open height (the cards in a row), and a tall one that fills the screen
 * to the top chrome, where the cards wrap into a grid with room to look at.
 * This is the gesture: press anywhere on the handle strip and the bar's top
 * edge comes with the finger, one for one, from the peek to the top of the
 * screen; let go and it settles on the next stage the way it was going — a
 * pull past the threshold never snaps back — or, short of it, where it was.
 * A flick decides too. A tap still toggles.
 *
 * The bar is always as tall as it can be, hung from the bottom of the screen
 * with the part past its stage below the edge. So every stage, and every
 * frame of a drag, is one transform on the bar — which the compositor does
 * without a layout — and there is never a gap under it. The chrome standing
 * on the bar rides its top edge by a translate of its own, the same way.
 * Nothing goes through React until the finger has gone: a re-render of the
 * day's cards per pointer event was the jank.
 *
 * The browser must never see the gesture as its own: the handle refuses every
 * touch action, and a touchmove on it is stopped before Android can read it
 * as pull-to-refresh or a scroll that hides the address bar. */

export type BarStage = 'peek' | 'open' | 'tall'
export const STAGES: readonly BarStage[] = ['peek', 'open', 'tall']

/** How far a drag has to go before letting go counts as a decision. */
export const DRAG_DECIDES_PX = 28
/** The collapsed bar's height before the safe area, as .barpeek declares it. */
export const PEEK_PX = 80
/** The open bar's height on a phone before the safe area, as :root declares it under 640px. */
export const OPEN_PX = 208
/** A fast short flick decides too. */
const FLICK_PX_PER_MS = 0.45
/** How long the bar takes to settle on a stage once the finger has gone. */
const SETTLE_MS = 220
/** Everything that stands on the bar. */
const CHROME = '.mapchrome, .nowpill, .wctl, .edithint, .nowcard'

const resist = (px: number) => Math.sqrt(Math.max(0, px)) * 4

/** The chrome standing on this bar, on the screen the bar is on. */
const chrome = (element: HTMLElement): Iterable<HTMLElement> =>
  element.closest<HTMLElement>('.tripscreen')?.querySelectorAll<HTMLElement>(CHROME) ?? []

export interface StageHeights {
  peek: number
  open: number
  tall: number
}

/** The bar's visible height under a finger `dy` down from where it started at
    `from`: one for one between the peek and the top, resisted past either. */
export function visibleUnder(dy: number, from: BarStage, heights: StageHeights): number {
  const wanted = heights[from] - dy
  if (wanted < heights.peek) return heights.peek - resist(heights.peek - wanted) / 2
  if (wanted > heights.tall) return heights.tall + resist(wanted - heights.tall) / 2
  return wanted
}

/** Where the bar settles when the finger lifts. A pull past the threshold, or
    a flick, goes on to the next stage the way it was going — and further,
    when it went far enough to be nearer a later one — never back the way it
    came; a shorter pull settles where it was. */
export function stageAfter(dy: number, from: BarStage, heights: StageHeights, speed = 0): BarStage {
  if (dy === 0) return from
  const decided = Math.abs(dy) >= DRAG_DECIDES_PX || speed >= FLICK_PX_PER_MS
  if (!decided) return from
  const index = STAGES.indexOf(from)
  const ahead = STAGES.filter((_, at) => (dy < 0 ? at > index : at < index))
  if (!ahead.length) return from
  const visible = heights[from] - dy
  let best = ahead[0]
  for (const stage of ahead)
    if (Math.abs(heights[stage] - visible) < Math.abs(heights[best] - visible)) best = stage
  return best
}

/** A press that never moved: the next stage over. */
export const stageOnTap = (from: BarStage): BarStage => (from === 'peek' ? 'open' : 'peek')

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

interface Press {
  y: number
  at: number
  id: number
  stage: BarStage
  heights: StageHeights
}

export default function useSheetDrag(
  stage: BarStage,
  onStage: (stage: BarStage) => void,
): SheetDrag {
  const sheet = useRef<HTMLDivElement>(null)
  const grip = useRef<HTMLButtonElement>(null)
  const press = useRef<Press | null>(null)
  const moved = useRef(0)
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragging, setDragging] = useState(false)

  /* Non-passive on purpose: React's own touch handlers are passive, and a
     passive listener cannot stop the browser's pull-to-refresh. */
  useEffect(() => {
    const element = grip.current
    if (!element) return
    const swallow = (event: TouchEvent) => {
      if (press.current) event.preventDefault()
    }
    element.addEventListener('touchmove', swallow, { passive: false })
    return () => element.removeEventListener('touchmove', swallow)
  }, [])
  useEffect(
    () => () => {
      if (settling.current) clearTimeout(settling.current)
    },
    [],
  )

  /* The bar and the chrome at a visible height, by hand: a transform on the
     bar, a translate on each of the chrome, and — eased — the settle. */
  const place = useCallback((visible: number, from: Press, eased: boolean) => {
    const element = sheet.current
    if (!element) return
    const ease = eased ? `${SETTLE_MS}ms ease` : 'none'
    element.closest('.tripscreen')?.setAttribute('data-bardrag', '')
    element.style.transition = eased ? `transform ${ease}` : 'none'
    element.style.transform = `translate3d(0, ${from.heights.tall - visible}px, 0)`
    const shift = from.heights[from.stage] - visible
    for (const standing of chrome(element)) {
      standing.style.transition = eased ? `translate ${ease}` : 'none'
      standing.style.translate = `0 ${shift}px`
    }
  }, [])

  /* Hands back to the stylesheet: the class now says where everything is,
     and it is exactly where the hand left it, so nothing jumps. The drag
     mark comes off a frame later, so the bottom the chrome stands on does
     not ease from the old stage to the new one under it. */
  const release = useCallback(() => {
    const element = sheet.current
    if (!element) return
    element.style.transition = ''
    element.style.transform = ''
    element.style.willChange = ''
    for (const standing of chrome(element)) {
      standing.style.transition = ''
      standing.style.translate = ''
      standing.style.willChange = ''
    }
    const screen = element.closest('.tripscreen')
    requestAnimationFrame(() => screen?.removeAttribute('data-bardrag'))
  }, [])

  const settle = useCallback(
    (from: Press, target: BarStage) => {
      place(from.heights[target], from, true)
      if (settling.current) clearTimeout(settling.current)
      settling.current = setTimeout(() => {
        settling.current = null
        if (target !== from.stage) flushSync(() => onStage(target))
        release()
      }, SETTLE_MS + 30)
    },
    [place, release, onStage],
  )

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const element = sheet.current
      if (!element) return
      if (settling.current) {
        clearTimeout(settling.current)
        settling.current = null
        release()
      }
      const padding = Number.parseFloat(getComputedStyle(element).paddingBottom) || 0
      const heights: StageHeights = {
        peek: PEEK_PX + padding,
        open: OPEN_PX + padding,
        tall: element.getBoundingClientRect().height,
      }
      press.current = { y: event.clientY, at: event.timeStamp, id: event.pointerId, stage, heights }
      moved.current = 0
      event.currentTarget.setPointerCapture?.(event.pointerId)
      element.style.willChange = 'transform'
      for (const standing of chrome(element)) standing.style.willChange = 'translate'
      setDragging(true)
    },
    [stage, release],
  )

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const begun = press.current
      if (!begun || begun.id !== event.pointerId) return
      const dy = event.clientY - begun.y
      moved.current = dy
      place(visibleUnder(dy, begun.stage, begun.heights), begun, false)
    },
    [place],
  )

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const begun = press.current
      if (!begun || begun.id !== event.pointerId) return
      press.current = null
      setDragging(false)
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      const dy = moved.current
      const speed = Math.abs(dy) / Math.max(1, event.timeStamp - begun.at)
      const target =
        Math.abs(dy) < 6
          ? stageOnTap(begun.stage)
          : stageAfter(dy, begun.stage, begun.heights, speed)
      settle(begun, target)
    },
    [settle],
  )

  const onPointerCancel = useCallback(() => {
    const begun = press.current
    press.current = null
    setDragging(false)
    if (begun) settle(begun, begun.stage)
  }, [settle])

  return {
    sheet,
    dragging,
    handle: { ref: grip, onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  }
}
