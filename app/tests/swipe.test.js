import assert from 'node:assert/strict'
import test from 'node:test'
import { dragMeans, isDoubleTap, pageBy } from '../src/swipe-core.ts'

test('dragging across turns the page, and left goes forward', () => {
  /* The direction everything else on a phone uses: the picture follows the
     finger, so dragging it leftwards brings the next one in from the right. */
  assert.equal(dragMeans({ dx: -90, dy: 4, ms: 180 }), 'next')
  assert.equal(dragMeans({ dx: 90, dy: 4, ms: 180 }), 'previous')
})

test('a short drag is not a page turn', () => {
  /* A thumb never lands perfectly still. Paging on twenty pixels would make
     the viewer feel like it was flinching. */
  assert.equal(dragMeans({ dx: -20, dy: 2, ms: 120 }), null)
  assert.equal(dragMeans({ dx: -43, dy: 2, ms: 120 }), null)
  assert.equal(dragMeans({ dx: -44, dy: 2, ms: 120 }), 'next')
})

test('a scroll is not a page turn, however far it wanders sideways', () => {
  /* The comments sit under the photograph on a phone, so a finger going down
     the thread passes right over the stage. It must not take the page with
     it — and a thumb travelling down an arc covers real horizontal ground. */
  assert.equal(dragMeans({ dx: -60, dy: 200, ms: 300 }), null)
  assert.equal(dragMeans({ dx: 80, dy: 81, ms: 300 }), null, 'a diagonal is not a decision')
  assert.equal(dragMeans({ dx: 80, dy: 79, ms: 300 }), 'previous', 'but mostly across is')
})

test('a finger that hardly moves is a tap', () => {
  assert.equal(dragMeans({ dx: 0, dy: 0, ms: 60 }), 'tap')
  assert.equal(dragMeans({ dx: 6, dy: -5, ms: 200 }), 'tap', 'nobody taps perfectly still')
  assert.equal(dragMeans({ dx: 14, dy: 0, ms: 200 }), null, 'but a smear is not a tap either')
})

test('a long press is not a tap', () => {
  /* Holding is how a photograph is deleted elsewhere in this app. It must not
     also be how one is liked. */
  assert.equal(dragMeans({ dx: 0, dy: 0, ms: 900 }), null)
})

test('two quick taps in the same place are a double tap', () => {
  const first = { at: 1000, x: 200, y: 300 }
  assert.ok(isDoubleTap(first, { at: 1180, x: 205, y: 296 }))
})

test('two taps far apart in time or place are two taps', () => {
  const first = { at: 1000, x: 200, y: 300 }
  assert.ok(!isDoubleTap(first, { at: 1400, x: 200, y: 300 }), 'too slow')
  assert.ok(!isDoubleTap(first, { at: 1100, x: 260, y: 300 }), 'too far')
  assert.ok(!isDoubleTap(null, { at: 1100, x: 200, y: 300 }), 'and a first tap is not one')
})

test('paging wraps at both ends, the way the arrows already do', () => {
  assert.equal(pageBy('next', 2, 3), 0)
  assert.equal(pageBy('previous', 0, 3), 2)
  assert.equal(pageBy('tap', 1, 3), 1, 'a tap does not move')
  assert.equal(pageBy(null, 1, 3), 1)
  assert.equal(pageBy('next', 0, 1), 0, 'one photograph stays put')
})
