import assert from 'node:assert/strict'
import test from 'node:test'
import { DRAG_DECIDES_PX, followBy, PEEK_PX } from '../src/features/trip/model/use-sheet-drag.ts'

/* Where the bar goes under a finger. Open, it follows a pull down the whole
   way to its collapsed place and no further, and resists a pull up because
   there is nothing above to show; collapsed, it lifts a little under a pull
   up and barely moves under a pull down. */

test('an open bar follows a pull down to its collapsed place, and no further', () => {
  const travel = 212 - PEEK_PX
  assert.equal(followBy(0, false, travel), 0)
  assert.equal(followBy(40, false, travel), 40)
  assert.equal(followBy(travel, false, travel), travel)
  assert.equal(followBy(travel + 200, false, travel), travel)
})

test('an open bar resists a pull up, and a collapsed bar lifts only a little', () => {
  const travel = 132
  assert.ok(followBy(-100, false, travel) < 0)
  assert.ok(followBy(-100, false, travel) > -30, 'resisted, not followed')
  assert.ok(followBy(-200, true, travel) < 0)
  assert.ok(followBy(-200, true, travel) >= -48, 'a lift, not a slide')
  assert.ok(followBy(100, true, travel) > 0 && followBy(100, true, travel) < 30)
})

test('the decision threshold is a real pull, not a shaky tap', () => {
  assert.ok(DRAG_DECIDES_PX > 12 && DRAG_DECIDES_PX < 60)
})
