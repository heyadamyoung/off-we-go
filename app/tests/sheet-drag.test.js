import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DRAG_DECIDES_PX,
  OPEN_PX,
  PEEK_PX,
  stageAfter,
  stageOnTap,
  visibleUnder,
} from '../src/features/trip/model/use-sheet-drag.ts'

/* The bar under a finger, through its three stages. Its top edge follows the
   finger one for one from the peek to the top of the screen and resists past
   either end; let go past the threshold, or flicked, it goes on to the next
   stage the way it was going — and further when it went far enough — never
   back the way it came; short of the threshold it settles where it was. */

const heights = { peek: PEEK_PX, open: OPEN_PX, tall: 750 }

test('the top edge follows the finger one for one, and resists past the ends', () => {
  assert.equal(visibleUnder(0, 'open', heights), OPEN_PX)
  assert.equal(visibleUnder(40, 'open', heights), OPEN_PX - 40)
  assert.equal(visibleUnder(-100, 'open', heights), OPEN_PX + 100)
  assert.equal(visibleUnder(-(750 - PEEK_PX), 'peek', heights), 750)
  const past = visibleUnder(-(750 - PEEK_PX) - 100, 'peek', heights)
  assert.ok(past > 750 && past < 790, 'past the top, resisted')
  const under = visibleUnder(200, 'peek', heights)
  assert.ok(under < PEEK_PX && under > PEEK_PX - 40, 'under the peek, resisted')
})

test('a pull past the threshold goes on the way it went, never back', () => {
  assert.equal(stageAfter(DRAG_DECIDES_PX, 'open', heights), 'peek')
  assert.equal(stageAfter(-DRAG_DECIDES_PX, 'open', heights), 'tall')
  assert.equal(stageAfter(-60, 'peek', heights), 'open')
  assert.equal(stageAfter(60, 'tall', heights), 'open')
  /* Far enough from the peek to be nearer the top than the open height: the top. */
  assert.equal(stageAfter(-(heights.tall - PEEK_PX) + 60, 'peek', heights), 'tall')
  assert.equal(stageAfter(heights.tall - PEEK_PX - 60, 'tall', heights), 'peek')
  /* Nowhere further to go that way: stays. */
  assert.equal(stageAfter(100, 'peek', heights), 'peek')
  assert.equal(stageAfter(-100, 'tall', heights), 'tall')
})

test('short of the threshold it settles where it was; a flick decides anyway', () => {
  assert.equal(stageAfter(12, 'open', heights), 'open')
  assert.equal(stageAfter(-12, 'open', heights), 'open')
  assert.equal(stageAfter(0, 'open', heights), 'open')
  assert.equal(stageAfter(12, 'open', heights, 0.9), 'peek')
  assert.equal(stageAfter(-12, 'peek', heights, 0.9), 'open')
})

test('a tap is the next stage over', () => {
  assert.equal(stageOnTap('peek'), 'open')
  assert.equal(stageOnTap('open'), 'peek')
  assert.equal(stageOnTap('tall'), 'peek')
  assert.ok(DRAG_DECIDES_PX > 12 && DRAG_DECIDES_PX < 60)
})
