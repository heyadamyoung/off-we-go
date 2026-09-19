import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DRAG_DECIDES_PX,
  followBy,
  OPEN_PX,
  PEEK_PX,
} from '../src/features/trip/model/use-sheet-drag.ts'

/* Where the bar's top goes under a finger. Open, it follows a pull down the
   whole way to its collapsed place and no further, and stays put under a
   pull up — there is nothing above to show, and a bar lifted off the bottom
   of the screen is a bar with a gap under it; collapsed, it rises with the
   finger the whole way to its open height, resists past it, and barely
   sinks under a pull down. */

test('an open bar follows a pull down to its collapsed place, and no further', () => {
  const travel = 212 - PEEK_PX
  assert.equal(followBy(0, false, travel), 0)
  assert.equal(followBy(40, false, travel), 40)
  assert.equal(followBy(travel, false, travel), travel)
  assert.equal(followBy(travel + 200, false, travel), travel)
})

test('an open bar does not move under a pull up; a collapsed bar rises with the finger to its open height', () => {
  const travel = OPEN_PX - PEEK_PX
  assert.equal(followBy(-100, false, travel), 0)
  assert.equal(followBy(-1, false, travel), 0)
  /* One for one on the way up, so the finger and the bar's top agree. */
  assert.equal(followBy(-40, true, travel), -40)
  assert.equal(followBy(-travel, true, travel), -travel)
  const past = followBy(-(travel + 100), true, travel)
  assert.ok(past < -travel && past > -travel - 40, 'past its open height, resisted')
  assert.ok(followBy(100, true, travel) > 0 && followBy(100, true, travel) < 30)
})

test('the decision threshold is a real pull, not a shaky tap', () => {
  assert.ok(DRAG_DECIDES_PX > 12 && DRAG_DECIDES_PX < 60)
})
