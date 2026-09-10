/* What a finger meant.
 *
 * The photo viewer had no swipe at all, and the whole photograph was a like
 * button. Those are the same bug seen twice: with nothing reading a drag, a
 * swipe across a phone ended as a tap on that button, so trying to page
 * through a trip hearted every picture in it instead of moving.
 *
 * So a drag is read here, once, and the answer decides everything: a mostly
 * horizontal one of any length turns the page, a still one is a tap, and
 * anything else — a scroll, an indecisive smear — is left alone rather than
 * guessed at. Pure, because the interesting part is the thresholds and those
 * are worth arguing with in a test rather than with a thumb.
 */

export interface Drag {
  /** Travel since the finger went down. Negative is leftwards. */
  dx: number
  dy: number
  /** How long the finger was down, in milliseconds. */
  ms: number
}

export type DragMeans = 'previous' | 'next' | 'tap' | null

export interface DragLimits {
  /** How far a finger must travel before it is paging rather than resting. */
  travel?: number
  /** How far a tap may drift and still be a tap. */
  slop?: number
  /** How long a tap may linger before it is a press, not a tap. */
  restMs?: number
}

/**
 * What to do about a finger that has just lifted.
 *
 * Dragging left shows the next photograph, the way a page turns and the way
 * every gallery on a phone already behaves.
 */
export function dragMeans(drag: Drag, limits: DragLimits = {}): DragMeans {
  const { travel = 44, slop = 10, restMs = 700 } = limits
  const { dx, dy, ms } = drag
  const across = Math.abs(dx)
  const down = Math.abs(dy)

  /* Across rather than down, and far enough to be deliberate. Comparing the
     two is what keeps a scroll down a long comment thread from turning the
     page as well: a finger that travelled further vertically was going
     vertically, however far it also wandered. */
  if (across >= travel && across > down) return dx < 0 ? 'next' : 'previous'

  // Barely moved, and not held: a tap.
  if (across <= slop && down <= slop && ms <= restMs) return 'tap'

  /* Somewhere in between — a scroll, a hesitation, a press. Doing nothing is
     the only answer that cannot be wrong. */
  return null
}

/**
 * How far the picture should follow the finger, mid-drag.
 *
 * A swipe that moves nothing is a swipe you cannot tell is working: you push
 * the photograph, it sits there, and either the next one appears or it does
 * not. Letting it move under the finger says "yes, this is a page turn" while
 * there is still time to change your mind — and going back when the finger
 * lifts short of the threshold says the change of mind was heard.
 *
 * Nothing at all for a drag that is going down rather than across, so reading
 * the comments never smears the photograph sideways.
 */
export function followed(drag: { dx: number; dy: number }, limits: DragLimits = {}): number {
  const { slop = 10 } = limits
  const across = Math.abs(drag.dx)
  if (across <= slop) return 0
  // The same across-beats-down rule the release uses, so what the picture does
  // under the finger and what happens when it lifts can never disagree.
  return across > Math.abs(drag.dy) ? drag.dx : 0
}

export interface Tap {
  at: number
  x: number
  y: number
}

export interface TapLimits {
  /** How long the second tap may take to arrive. */
  withinMs?: number
  /** How far from the first it may land. */
  within?: number
}

/**
 * Whether this tap completes a double tap.
 *
 * Double tap is the gesture for liking a picture — it is what a thumb already
 * does, and unlike a single tap it cannot be confused with paging, closing, or
 * simply putting a finger on the screen.
 */
export function isDoubleTap(first: Tap | null, second: Tap, limits: TapLimits = {}): boolean {
  const { withinMs = 320, within = 36 } = limits
  if (!first) return false
  const gap = second.at - first.at
  if (gap < 0 || gap > withinMs) return false
  return Math.hypot(second.x - first.x, second.y - first.y) <= within
}

/** Where a swipe leaves you, wrapping at both ends the way the arrows do. */
export function pageBy(means: DragMeans, index: number, length: number): number {
  if (length < 1) return 0
  if (means === 'next') return (index + 1) % length
  if (means === 'previous') return (index - 1 + length) % length
  return index
}
