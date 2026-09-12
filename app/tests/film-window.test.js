import assert from 'node:assert/strict'
import test from 'node:test'
import { FILM_PITCH, filmScroll, filmWindow } from '../src/film-window-core.ts'

const strip = { width: 800, spare: 4 }

test('an unmeasured strip draws around the photograph being looked at', () => {
  // The first render: nothing has measured the row yet, and the one thing that
  // certainly has to be on it is the picture the viewer is on.
  const at = filmWindow(500, { keep: 200, spare: 4 })
  assert.equal(at.from, 196)
  assert.equal(at.to, 205)
  assert.ok(at.from <= 200 && 200 < at.to, 'the current photograph must be drawn')
})

test('a measured strip draws what the scroll is looking at', () => {
  const at = filmWindow(500, { ...strip, scroll: FILM_PITCH * 50 })
  assert.equal(at.from, 46)
  // 800px of strip is a little over seven thumbnails, plus four either side.
  assert.equal(at.to, 62)
})

test('it holds the rest of the trip open so the scrollbar tells the truth', () => {
  const count = 500
  const at = filmWindow(count, { ...strip, scroll: FILM_PITCH * 50 })
  const drawn = (at.to - at.from) * FILM_PITCH
  assert.equal(at.before + drawn + at.after, count * FILM_PITCH)
})

test('a short trip is drawn whole, with nothing held open', () => {
  const at = filmWindow(6, { ...strip })
  assert.deepEqual(at, { from: 0, to: 6, before: 0, after: 0 })
})

test('it never runs off either end', () => {
  const start = filmWindow(500, { ...strip, scroll: 0 })
  assert.equal(start.from, 0)
  assert.equal(start.before, 0)

  const end = filmWindow(500, { ...strip, scroll: FILM_PITCH * 500 })
  assert.equal(end.to, 500)
  assert.equal(end.after, 0)
})

test('an empty trip draws nothing rather than a negative window', () => {
  assert.deepEqual(filmWindow(0, strip), { from: 0, to: 0, before: 0, after: 0 })
})

test('the window is a handful, not the trip', () => {
  /* The whole point. Five hundred photographs used to be a thousand elements
     built every time the viewer opened. */
  const at = filmWindow(500, { ...strip, scroll: FILM_PITCH * 200 })
  assert.ok(at.to - at.from < 20, `drew ${at.to - at.from} of 500`)
})

test('the current photograph is scrolled to the middle', () => {
  const middle = filmScroll(50, 800)
  assert.equal(middle, 50 * FILM_PITCH - (800 - FILM_PITCH) / 2)
  // A photograph near the start cannot be centred, and must not ask to be.
  assert.equal(filmScroll(0, 800), 0)
  assert.equal(filmScroll(1, 800), 0)
})

test('nothing is asked of a strip nobody has measured', () => {
  assert.equal(filmScroll(50, 0), 0)
})
