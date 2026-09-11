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
  assert.equal(dragMeans({ dx: -90, dy: 4, ms: 180 }), 'next')
  assert.equal(dragMeans({ dx: 90, dy: 4, ms: 180 }), 'previous')
})

test('a slow short drag is not a page turn', () => {
  /* A thumb never lands perfectly still, and a hesitant nudge is not a
     decision. Slowly, so the flick below cannot answer for it. */
  assert.equal(dragMeans({ dx: -20, dy: 2, ms: 600 }), null)
  assert.equal(dragMeans({ dx: -47, dy: 2, ms: 600 }), null)
  assert.equal(dragMeans({ dx: -48, dy: 2, ms: 600 }), 'next')
})

test('a flick turns the page however short it is', () => {
  /* This is how anybody actually pages through photographs: a quick sweep of
     the thumb, nowhere near the far side of the screen. Asking such a gesture
     to cross a fixed distance is what made the viewer feel like hard work. */
  assert.equal(dragMeans({ dx: -40, dy: 3, ms: 60 }), 'next', '0.67px per ms')
  assert.equal(dragMeans({ dx: 36, dy: 0, ms: 50 }), 'previous')
  // Same distance, taken at a stroll: not a flick, and not far enough either.
  assert.equal(dragMeans({ dx: -40, dy: 3, ms: 500 }), null)
})

test('a flick still has to be a movement rather than a twitch', () => {
  /* A tap is fast and tiny by definition; it must not read as a page turn. */
  assert.equal(dragMeans({ dx: -8, dy: 1, ms: 10 }), 'tap')
  assert.equal(dragMeans({ dx: -18, dy: 1, ms: 20 }), null, 'quick, but barely moved')
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

test('a slow drag has to cross about a fifth of the picture', () => {
  /* Two fifths was too much — a whole thumb's reach for one photograph, and it
     made the viewer feel like hard work. About a fifth, with the flick above
     carrying everything quicker than that. */
  const phone = carryDistance(390)
  assert.ok(phone > 80 && phone < 92, `about a fifth of a phone, got ${phone}`)
  const slowly = dx => dragMeans({ dx, dy: 4, ms: 700 }, { travel: phone })
  assert.equal(slowly(-60), null, 'a nudge holds')
  assert.equal(slowly(-(phone - 1)), null, 'and just short')
  assert.equal(slowly(-phone), 'next')
})

test('a narrow stage still asks for a real push', () => {
  /* A fifth of a very small stage is a twitch; there is a floor under it. */
  assert.equal(carryDistance(120), 48)
  assert.equal(carryDistance(0), 48, 'and an unmeasured stage does not ask for nothing')
})

test('a wide one does not ask for half a metre of mouse', () => {
  /* There are arrows and arrow keys on a desktop, and they are the better
     tool: the cap is there so the swipe stays possible, not so it is easy. */
  assert.equal(carryDistance(1600), 140)
})

test('a sweep that took no measurable time is the fastest thing there is', () => {
  /* Some clocks are coarse enough that a real gesture reports zero
     milliseconds. Reading that as "slow" refuses the swipe outright. */
  assert.equal(dragMeans({ dx: -50, dy: 2, ms: 0 }), 'next')
  assert.equal(dragMeans({ dx: -8, dy: 1, ms: 0 }), 'tap', 'but a twitch is still a tap')
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
