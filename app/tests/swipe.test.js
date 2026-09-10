import assert from 'node:assert/strict'
import test from 'node:test'
import { carryDistance, dragMeans, followed, isDoubleTap, pageBy } from '../src/swipe-core.ts'

test('dragging across turns the page, and left goes forward', () => {
  /* The direction everything else on a phone uses: the picture follows the
     finger, so dragging it leftwards brings the next one in from the right. */
  assert.equal(dragMeans({ dx: -90, dy: 4, ms: 180 }), 'next')
  assert.equal(dragMeans({ dx: 90, dy: 4, ms: 180 }), 'previous')
})

test('a short drag is not a page turn', () => {
  /* A thumb never lands perfectly still, and a hesitant nudge is not a
     decision. The default is the floor; the viewer hands in a share of the
     picture's own width, which is a good deal further. */
  assert.equal(dragMeans({ dx: -20, dy: 2, ms: 120 }), null)
  assert.equal(dragMeans({ dx: -63, dy: 2, ms: 120 }), null)
  assert.equal(dragMeans({ dx: -64, dy: 2, ms: 120 }), 'next')
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

test('the picture follows the finger once it is going somewhere', () => {
  /* A swipe that moves nothing is a swipe you cannot tell is working. */
  assert.equal(followed({ dx: -80, dy: 4 }), -80)
  assert.equal(followed({ dx: 120, dy: -10 }), 120)
})

test('it does not twitch under a finger that has barely moved', () => {
  assert.equal(followed({ dx: 4, dy: 0 }), 0)
  assert.equal(followed({ dx: -9, dy: 2 }), 0)
})

test('and it does not smear sideways while somebody is scrolling', () => {
  /* The same across-beats-down rule the release uses, so what the picture does
     under the finger and what happens when it lifts cannot disagree. */
  assert.equal(followed({ dx: -40, dy: 160 }), 0)
  assert.equal(followed({ dx: -100, dy: 99 }), -100)
})

test('what the picture does and what the release does agree', () => {
  /* If one of these ever said "across" and the other "down", the photograph
     would slide away and then snap back for no reason anybody could see. */
  for (const drag of [
    { dx: -80, dy: 4, ms: 200 },
    { dx: 80, dy: 79, ms: 200 },
    { dx: -40, dy: 160, ms: 300 },
    { dx: 5, dy: 5, ms: 100 },
  ]) {
    const moved = followed(drag) !== 0
    const paged = dragMeans(drag) === 'next' || dragMeans(drag) === 'previous'
    if (paged) assert.ok(moved, `${JSON.stringify(drag)} paged without ever moving`)
  }
})

test('the page turns only once the picture has been carried most of the way', () => {
  /* A fixed 44px was about a tenth of a phone, so a hesitant nudge — a finger
     that moved, thought better of it, and lifted — turned the page anyway. */
  const phone = carryDistance(390)
  assert.equal(phone, 156, 'most of the way across, not a tenth of it')
  assert.equal(dragMeans({ dx: -80, dy: 4, ms: 200 }, { travel: phone }), null, 'a nudge holds')
  assert.equal(dragMeans({ dx: -155, dy: 4, ms: 200 }, { travel: phone }), null, 'and just short')
  assert.equal(dragMeans({ dx: -156, dy: 4, ms: 200 }, { travel: phone }), 'next')
})

test('a narrow stage still asks for a deliberate push', () => {
  /* Two fifths of a very small stage is a twitch; there is a floor under it. */
  assert.equal(carryDistance(120), 64)
  assert.equal(carryDistance(0), 64, 'and an unmeasured stage does not ask for nothing')
})

test('a wide one does not ask for half a metre of mouse', () => {
  /* There are arrows and arrow keys on a desktop, and they are the better
     tool: the cap is there so the swipe stays possible, not so it is easy. */
  assert.equal(carryDistance(1600), 240)
})
