import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AT_REST,
  clampPan,
  clampScale,
  dragPans,
  fitInside,
  panLimit,
  spread,
  toggleZoom,
  zoomAbout,
} from '../src/zoom-core.ts'

/* A phone, and a landscape photograph letterboxed on it. */
const screen = { width: 390, height: 780 }
const shown = { width: 390, height: 260 }

test('a photograph at rest cannot be dragged at all', () => {
  /* This is what keeps a swipe a swipe. If a picture that already fits could
     slide under the finger, every attempt to turn the page would smear it
     sideways instead. */
  assert.deepEqual(panLimit(shown, screen, 1), { width: 0, height: 0 })
  assert.deepEqual(clampPan({ scale: 1, x: 200, y: 200 }, shown, screen), AT_REST)
  assert.equal(dragPans(AT_REST), false)
  assert.equal(dragPans({ scale: 2, x: 0, y: 0 }), true)
})

test('zoomed in, it may be dragged exactly as far as its edges allow', () => {
  /* Half the overflow each way: at 2x a 390-wide picture is 780 wide on a
     390-wide screen, so 195 either side before the edge comes inside. */
  assert.deepEqual(panLimit(shown, screen, 2), { width: 195, height: 0 })
  const dragged = clampPan({ scale: 2, x: 400, y: 400 }, shown, screen)
  assert.equal(dragged.x, 195)
  assert.equal(dragged.y, 0, 'still letterboxed vertically, so nowhere to go')
})

test('zooming keeps what is under the fingers under the fingers', () => {
  /* Scaling about the middle instead is the thing that feels broken without
     anybody being able to say why: you pinch on a face and the face swims. */
  const at = { x: 100, y: 40 }
  const after = zoomAbout(AT_REST, 2, at, shown, screen)
  assert.equal(after.scale, 2)
  // The image point under `at` was (at - x)/scale = 100; it must still be there.
  assert.equal((at.x - after.x) / after.scale, 100)
})

test('zoom does not go below rest or past the ceiling', () => {
  assert.equal(clampScale(0.2), 1)
  assert.equal(clampScale(99), 6)
  assert.equal(zoomAbout(AT_REST, 0.5, { x: 0, y: 0 }, shown, screen).scale, 1)
  assert.equal(zoomAbout({ scale: 5, x: 0, y: 0 }, 4, { x: 0, y: 0 }, shown, screen).scale, 6)
})

test('pinching all the way back out leaves it centred again', () => {
  /* Not merely at scale 1 — at rest. A picture that fits and is still offset
     is a picture with a black stripe down one side. */
  const zoomed = zoomAbout(AT_REST, 3, { x: 120, y: 50 }, shown, screen)
  const back = zoomAbout(zoomed, 1 / 3, { x: 120, y: 50 }, shown, screen)
  assert.equal(back.scale, 1)
  assert.deepEqual({ x: back.x, y: back.y }, { x: 0, y: 0 })
})

test('double tap goes in where you tapped, and out from anywhere', () => {
  const inward = toggleZoom(AT_REST, { x: 80, y: 30 }, shown, screen)
  assert.equal(inward.scale, 2.5)
  assert.equal((80 - inward.x) / inward.scale, 80, 'about the spot tapped')
  assert.deepEqual(toggleZoom(inward, { x: 0, y: 0 }, shown, screen), AT_REST)
})

test('two fingers are a distance and nothing more', () => {
  assert.equal(spread({ x: 0, y: 0 }, { x: 3, y: 4 }), 5)
})

test('a photograph asked to fit takes the smaller of the two ratios', () => {
  /* A 390x780 phone is taller than 3:2 and taller than 2:3 alike, so both of
     these are held by their width and letterboxed above and below — which is
     the point of measuring rather than assuming: neither one can be dragged
     up or down, however tall the photograph is. */
  assert.deepEqual(fitInside({ width: 3000, height: 2000 }, screen), { width: 390, height: 260 })
  assert.deepEqual(fitInside({ width: 2000, height: 3000 }, screen), { width: 390, height: 585 })
  // Taller than the phone, and now it is the height that holds it.
  assert.deepEqual(fitInside({ width: 1000, height: 4000 }, screen), { width: 195, height: 780 })
  // A picture whose size is not known yet must not divide by zero.
  assert.deepEqual(fitInside({ width: 0, height: 0 }, screen), screen)
})
