import assert from 'node:assert/strict'
import test from 'node:test'
import {
  atSlot,
  carryDistance,
  dragMeans,
  followed,
  isDoubleTap,
  pageBy,
  strip,
  trackShift,
  warmAround,
} from '../src/swipe-core.ts'

test('dragging across turns the page, and left goes forward', () => {
  /* The direction everything else on a phone uses: the picture follows the
     finger, so dragging it leftwards brings the next one in from the right. */
  assert.equal(dragMeans({ dx: -200, dy: 4, ms: 180 }, { travel: 195 }), 'next')
  assert.equal(dragMeans({ dx: 200, dy: 4, ms: 180 }, { travel: 195 }), 'previous')
})

/* A phone: 390 across, so half of it is 195. Everything below is written in
   those numbers, because the whole argument is about how much of a screen a
   person has to cross before the page turns. */
const PHONE = { travel: carryDistance(390) }

test('half the screen is the bar, and a swipe short of it goes back', () => {
  /* A fifth was the first attempt and it was wrong in the way that matters:
     a swipe somebody decided against halfway through turned the page anyway,
     so the gesture could not be taken back once begun. */
  assert.equal(carryDistance(390), 195)
  assert.equal(dragMeans({ dx: -100, dy: 4, ms: 400, vx: 0 }, PHONE), null)
  assert.equal(dragMeans({ dx: -194, dy: 4, ms: 700, vx: 0 }, PHONE), null, 'just short')
  assert.equal(dragMeans({ dx: -195, dy: 4, ms: 700, vx: 0 }, PHONE), 'next', 'just past')
})

test('a finger that stopped is treated as stopped, however fast it set off', () => {
  /* This is the everyday case that was getting it backwards. Speed used to be
     averaged over the whole gesture, so a swipe that set off quickly and then
     slowed to a halt — which is exactly the shape of changing your mind —
     still read as fast and turned the page. */
  const quickThenStopped = { dx: -120, dy: 2, ms: 140, vx: 0 }
  assert.equal(dragMeans(quickThenStopped, PHONE), null)

  // And the same distance, still moving, is a decision.
  assert.equal(dragMeans({ ...quickThenStopped, vx: -1.2 }, PHONE), 'next')
})

test('a flick turns the page without covering the distance', () => {
  /* What makes a flick a decision is its speed, and the rule says so by
     asking where the picture would come to rest — not by a second, separate
     test that can fire on its own. A real thumb flick runs well over one
     pixel a millisecond. */
  assert.equal(dragMeans({ dx: -40, dy: 3, ms: 40, vx: -2 }, PHONE), 'next')
  assert.equal(dragMeans({ dx: 40, dy: 3, ms: 40, vx: 2 }, PHONE), 'previous')

  // A dawdle at the same distance is not.
  assert.equal(dragMeans({ dx: -40, dy: 3, ms: 600, vx: -0.05 }, PHONE), null)
})

test('speed pulling the other way can take a swipe back', () => {
  /* A finger that went out and was on its way home when it lifted has changed
     its mind, and the projection hears that — which a distance-only rule,
     reading only where it ended up, cannot. */
  assert.equal(dragMeans({ dx: -180, dy: 4, ms: 300, vx: 1.5 }, PHONE), null)
})

test('a drag going down the screen is a scroll, whatever else it did', () => {
  /* The comments sit under the photograph on a phone, so a finger going down
     the thread passes right over the stage. */
  assert.equal(dragMeans({ dx: -200, dy: -260, ms: 300, vx: -1 }, PHONE), null)
  assert.equal(dragMeans({ dx: 30, dy: 200, ms: 300 }, PHONE), null)
})

test('a finger that went nowhere is a tap', () => {
  assert.equal(dragMeans({ dx: 0, dy: 0, ms: 90 }, PHONE), 'tap')
  assert.equal(dragMeans({ dx: 4, dy: -3, ms: 120 }, PHONE), 'tap', 'a thumb is not a pixel')
  // Held, rather than tapped: a press is somebody thinking, not choosing.
  assert.equal(dragMeans({ dx: 0, dy: 0, ms: 900 }, PHONE), null)
  // And something indecisive is nothing at all, which cannot be wrong.
  assert.equal(dragMeans({ dx: -40, dy: 6, ms: 500, vx: 0 }, PHONE), null)
})

test('a narrow stage still asks for a real push', () => {
  /* Half of a watch is a few dozen pixels, which a resting thumb covers. */
  assert.equal(carryDistance(80), 60)
  assert.equal(carryDistance(0), 60, 'and an unmeasured stage is not a free page turn')
})

test('a wide one does not ask for half a metre of mouse', () => {
  /* There are arrows and arrow keys over there, and they are the better tool. */
  assert.equal(carryDistance(1600), 260)
  assert.equal(carryDistance(3000), 260)
})

test('the projection window can be argued with', () => {
  const slow = { dx: -100, dy: 2, ms: 200, vx: -0.5 }
  assert.equal(dragMeans(slow, { travel: 195, project: 100 }), null, '100ms ahead: 150px')
  assert.equal(dragMeans(slow, { travel: 195, project: 400 }), 'next', '400ms ahead: 300px')
})

test('the picture follows the finger, but not a scroll', () => {
  assert.equal(followed({ dx: -60, dy: 5 }), -60)
  assert.equal(followed({ dx: 60, dy: 5 }), 60)
  // Straight down the comments: the photograph must not smear sideways.
  assert.equal(followed({ dx: -20, dy: 90 }), 0)
  // And a thumb resting is not a drag at all.
  assert.equal(followed({ dx: 6, dy: 2 }), 0)
})

test('double tap is close in time and close in place', () => {
  const first = { at: 1000, x: 100, y: 100 }
  assert.equal(isDoubleTap(first, { at: 1120, x: 104, y: 98 }), true)
  assert.equal(isDoubleTap(first, { at: 1500, x: 100, y: 100 }), false, 'too slow')
  assert.equal(isDoubleTap(first, { at: 1120, x: 200, y: 100 }), false, 'too far')
  assert.equal(isDoubleTap(null, { at: 1120, x: 100, y: 100 }), false, 'nothing to double')
})

test('paging wraps at both ends, the way the arrows do', () => {
  assert.equal(pageBy('next', 2, 3), 0)
  assert.equal(pageBy('previous', 0, 3), 2)
  assert.equal(pageBy('tap', 1, 3), 1)
  assert.equal(pageBy('next', 0, 0), 0)
})

/* ---- the filmstrip -------------------------------------------------------

   A viewer that draws one picture and puts its transform back to nought when
   the page turns can only snap: there is no next photograph on the screen to
   slide in, so the one you pushed walks back to the middle and is replaced
   where it stands. Three are drawn now, and it is the strip that moves. */

test('a slot knows which photograph it holds, and wraps like the arrows', () => {
  assert.equal(atSlot(0, 4), 0)
  assert.equal(atSlot(4, 4), 0, 'a whole turn round')
  assert.equal(atSlot(-1, 4), 3, 'and backwards past the start')
  assert.equal(atSlot(-5, 4), 3)
  assert.equal(atSlot(7, 3), 1)
  assert.equal(atSlot(3, 0), 0, 'nothing to hold')
})

test('the strip is the one you are on and its neighbours', () => {
  assert.deepEqual(strip(5, 10), [4, 5, 6])
  // Counted in slots that never wrap, which is what keeps a pane's identity
  // across a turn — a rebuilt pane is a photograph fetched again.
  assert.deepEqual(strip(0, 10), [-1, 0, 1])
  assert.deepEqual(strip(-3, 10), [-4, -3, -2])
})

test('one photograph is one pane', () => {
  /* Three panes of the same picture would mean swiping from a photograph to
     a copy of itself, which is worse than not moving at all. */
  assert.deepEqual(strip(0, 1), [0])
  assert.deepEqual(strip(4, 0), [4])
  // Two is enough for a strip, even though both neighbours are the other one.
  assert.deepEqual(strip(0, 2), [-1, 0, 1])
})

test('the track is moved in widths, not pixels', () => {
  /* A percentage in a transform is of the element's own box, and the track is
     exactly one photograph wide — so nothing measures the stage, and a phone
     turned on its side is right on the frame it turns. */
  assert.equal(trackShift(0, 0), '0px')
  assert.equal(trackShift(-40, 0), '-40px', 'under the finger, exactly the finger')
  assert.equal(trackShift(0, 1), '-100%', 'a whole photograph to the next one')
  assert.equal(trackShift(0, -1), '100%')
})

test('a turn carries on from wherever the finger left it', () => {
  /* The distance still to travel is whatever the swipe had not covered, so
     the movement is one continuous thing rather than a jump and a slide. */
  assert.equal(trackShift(-40, 1), 'calc(-40px - 100%)')
  assert.equal(trackShift(25, -1), 'calc(25px + 100%)')
})

test('the track transform is always something a browser will parse', () => {
  /* calc has no opinion about `- -100%` except that it is a syntax error, and
     a transform the browser cannot parse is a strip that does not move. */
  for (const dx of [-120, -1, 0, 1, 120])
    for (const moving of [-1, 0, 1]) {
      const shift = trackShift(dx, moving)
      assert.doesNotMatch(shift, /[-+]\s*[-+]/, `${shift} has two signs in a row`)
      assert.doesNotMatch(shift, /calc\([^)]*[-+]\)/, `${shift} ends on an operator`)
      if (shift.startsWith('calc('))
        assert.match(shift, /^calc\(-?\d+px [-+] \d+%\)$/, `${shift} is not a sum of two terms`)
    }
})

test('a few either way are warmed, nearest first, and never the whole trip', () => {
  /* The two beside this one are already on the screen; what this buys is the
     one after that, for somebody paging quickly. */
  assert.deepEqual(warmAround(5, 20, 2), [6, 4, 7, 3])
  assert.deepEqual(warmAround(0, 20, 2), [1, 19, 2, 18], 'and it wraps, as paging does')
})

test('warming never asks for the same photograph twice', () => {
  /* On a short trip the reach runs all the way round and meets itself. */
  const warmed = warmAround(0, 3, 5)
  assert.equal(new Set(warmed).size, warmed.length, `${warmed} repeats itself`)
  assert.ok(!warmed.includes(0), 'and never the one already on the screen')
  assert.deepEqual(warmAround(0, 1, 3), [], 'nothing to warm on a single photograph')
  assert.deepEqual(warmAround(0, 0, 3), [])
})
