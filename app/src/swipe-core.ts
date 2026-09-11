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
  /* How fast it was going when it lifted, in pixels a millisecond, measured
     over the last moment of the gesture rather than averaged over all of it.
     Positive rightwards, as `dx` is. */
  vx?: number
}

export type DragMeans = 'previous' | 'next' | 'tap' | null

export interface DragLimits {
  /** How far the picture must end up carried before the page turns. */
  travel?: number
  /** How far a tap may drift and still be a tap. */
  slop?: number
  /** How long a tap may linger before it is a press, not a tap. */
  restMs?: number
  /** How far ahead a finger's speed is taken to carry it, in milliseconds.
   This is what lets a flick count without asking it to cover the distance: a
   sweep at two pixels a millisecond is plainly going somewhere, and saying so
   as "where it would be a fifth of a second from now" is one rule rather than
   a second, independent one that can fire on its own. */
  project?: number
}

/**
 * How far a finger has to carry the picture before the page turns.
 *
 * A fixed number of pixels is the wrong shape for this. Forty-four of them is
 * a comfortable minimum on a watch and about a tenth of a phone, which meant a
 * hesitant nudge — a finger that moved, thought better of it, and lifted —
 * turned the page anyway. It has to be most of a swipe, so it is measured as a
 * share of the picture being swiped.
 *
 * Half of it. A fifth was the first attempt and it was wrong in the way that
 * matters: a swipe somebody decided against halfway through still turned the
 * page, so the gesture could not be taken back once begun. Half is the share
 * every phone gallery uses, and it means exactly what a person means by
 * carrying a photograph across — if it has not got past the middle, it goes
 * back.
 *
 * Floored so a narrow stage still needs a deliberate push, and capped so a
 * wide desktop one does not ask for half a metre of mouse: there are arrows
 * and arrow keys over there, and they are the better tool anyway.
 */
export function carryDistance(width: number, share = 0.5, least = 60, most = 260): number {
  if (!(width > 0)) return least
  return Math.min(Math.max(width * share, least), most)
}

/**
 * What to do about a finger that has just lifted.
 *
 * Dragging left shows the next photograph, the way a page turns and the way
 * every gallery on a phone already behaves.
 */
export function dragMeans(drag: Drag, limits: DragLimits = {}): DragMeans {
  const { travel = 60, slop = 10, restMs = 700, project = 200 } = limits
  const { dx, dy, vx = 0 } = drag
  const across = Math.abs(dx)
  const down = Math.abs(dy)
  const sideways = across > down

  /* Across rather than down. Comparing the two is what keeps a scroll down a
     long comment thread from turning the page as well: a finger that travelled
     further vertically was going vertically, however far it also wandered. */
  if (!sideways) return tapOrNothing(drag, slop, restMs)

  /* Where the photograph would come to rest if you let the finger's own speed
     carry it. One rule, not two.
     
     It used to be distance OR speed, each able to fire on its own, and the
     speed was the AVERAGE over the whole gesture. Between them those two got
     the everyday case exactly backwards: a swipe that set off quickly and then
     slowed to a stop — which is precisely how somebody changes their mind —
     still had a high average and turned the page, while a deliberate slow
     carry needed a fifth of the screen and no more.
     
     Projection reads what the finger was doing when it left instead. Stop, and
     there is nothing to carry you: the distance is all you have, and it has to
     be half the picture. Flick, and the distance barely matters. */
  const carried = dx + vx * project
  if (Math.abs(carried) >= travel) return carried < 0 ? 'next' : 'previous'

  return tapOrNothing(drag, slop, restMs)
}

/* A finger that went nowhere is a tap; one that went somewhere indecisive is
   nothing at all. Doing nothing is the only answer that cannot be wrong. */
function tapOrNothing(drag: Drag, slop: number, restMs: number): DragMeans {
  const { dx, dy, ms } = drag
  if (Math.abs(dx) <= slop && Math.abs(dy) <= slop && ms <= restMs) return 'tap'
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

/* ---- the filmstrip -------------------------------------------------------

   A viewer that draws one picture and puts its transform back to nought when
   the page turns can only ever snap: there is no next photograph on the
   screen to slide in, so the one you pushed walks back to the middle and is
   replaced where it stands. Which is exactly what it looked like.

   So three are drawn at once — the one before, the one you are on, the one
   after — side by side in a track, and it is the track that moves. Under the
   finger you see the next one coming in at the edge; let go and the track
   carries on to it in one movement. Nothing is swapped, nothing reloads,
   because the picture that arrives has been on the screen all along, just
   past the edge of it.

   The arithmetic is here; the browser part is in use-viewer-gestures. */

/** How many are drawn either side of the one you are looking at. */
export const PANES_EITHER_SIDE = 1

/**
 * Which photograph a slot of the strip holds, wrapping the way the arrows do.
 *
 * The strip is counted in a number that never wraps — it just goes up as you
 * page forward and down as you page back — and the wrapping happens here, at
 * the moment a slot is asked what it holds. That is what lets a slot keep its
 * identity across a page turn: the pane holding slot 7 is still the pane
 * holding slot 7 afterwards, so the browser moves it rather than rebuilding
 * it, and the picture in it is not fetched again.
 */
export function atSlot(slot: number, length: number): number {
  if (length < 1) return 0
  return ((slot % length) + length) % length
}

/**
 * The slots to draw, in order, around the one being looked at.
 *
 * Three of them, or one when there is only one photograph — a strip of three
 * on a trip with a single picture would be the same picture three times, and
 * a swipe that appears to move to a different copy of what you were already
 * looking at is worse than one that does not move at all.
 */
export function strip(slot: number, length: number, eitherSide = PANES_EITHER_SIDE): number[] {
  if (length < 2) return [slot]
  const out: number[] = []
  for (let at = slot - eitherSide; at <= slot + eitherSide; at++) out.push(at)
  return out
}

/**
 * Where the track sits, given the finger and the turn in progress.
 *
 * Nought is the picture you are on, centred. A finger dragging left gives a
 * negative `dx` and the next photograph comes in from the right. A turn to
 * the next one is `moving` of 1, which carries the track a full width so that
 * next photograph ends up where this one was.
 *
 * A width, not a number of pixels: a percentage in a transform is of the
 * element's own box, and the track is exactly one photograph wide. So nothing
 * has to measure the stage, nothing has to watch it for resizes, and a phone
 * turned on its side is right on the frame it turns rather than the frame
 * after — all of which a measured width gets wrong at least once.
 */
export function trackShift(dx: number, moving: number): string {
  if (!moving) return `${dx}px`
  // A whole number of photographs, as a percentage of one of them.
  const whole = `${Math.abs(moving) * 100}%`
  if (!dx) return moving > 0 ? `-${whole}` : whole
  /* The sign is written out rather than folded into the number: calc has no
     opinion about `- -100%` except that it is a syntax error, and a transform
     the browser cannot parse is a strip that does not move at all. */
  return `calc(${dx}px ${moving > 0 ? '-' : '+'} ${whole})`
}

/**
 * Which photographs to have ready, as indices, nearest first.
 *
 * Not the whole trip: a year of photographs warmed at once is a phone's data
 * allowance and a browser's memory for something nobody has asked to look at.
 * Not one, either — a single picture ahead is no help to somebody paging
 * quickly, which is how anybody looks through a day's photographs.
 *
 * Nearest first because it is also the order they are wanted in, and a
 * browser given six requests at once will start them in the order it got
 * them.
 */
export function warmAround(index: number, length: number, reach = 3): number[] {
  if (length < 2) return []
  const out: number[] = []
  const seen = new Set<number>([atSlot(index, length)])
  for (let step = 1; step <= reach; step++) {
    for (const at of [atSlot(index + step, length), atSlot(index - step, length)]) {
      if (seen.has(at)) continue
      seen.add(at)
      out.push(at)
    }
  }
  return out
}
