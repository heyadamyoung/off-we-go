import assert from 'node:assert/strict'
import test from 'node:test'
import { bearingBetween, headingFromEvent, shortestTurn, turnTowards } from '../src/compass-core.ts'

test('webkitCompassHeading is trusted as-is, normalized', () => {
  assert.equal(headingFromEvent({ webkitCompassHeading: 90 }), 90)
  assert.equal(headingFromEvent({ webkitCompassHeading: 370 }), 10)
  // the webkit reading wins even when alpha rides along
  assert.equal(headingFromEvent({ webkitCompassHeading: 45, alpha: 10, absolute: true }), 45)
})

test('absolute alpha converts counterclockwise to compass clockwise', () => {
  assert.equal(headingFromEvent({ alpha: 0, absolute: true }), 0)
  assert.equal(headingFromEvent({ alpha: 90, absolute: true }), 270)
  assert.equal(headingFromEvent({ alpha: 270, absolute: true }), 90)
})

test('the screen angle folds into the alpha path', () => {
  assert.equal(headingFromEvent({ alpha: 0, absolute: true }, 90), 90)
  assert.equal(headingFromEvent({ alpha: 90, absolute: true }, 90), 0)
})

test('a relative alpha is refused — its origin is wherever the page loaded', () => {
  assert.equal(headingFromEvent({ alpha: 120, absolute: false }), null)
  assert.equal(headingFromEvent({ alpha: 120 }), null)
  assert.equal(headingFromEvent({}), null)
  assert.equal(headingFromEvent({ webkitCompassHeading: Number.NaN, alpha: 30 }), null)
})

test('shortestTurn takes the short way across north', () => {
  assert.equal(shortestTurn(350, 10), 20)
  assert.equal(shortestTurn(10, 350), -20)
  assert.equal(shortestTurn(0, 180), 180)
  assert.equal(shortestTurn(90, 90), 0)
})

test('turnTowards accumulates without pirouettes', () => {
  // walking a needle 350 -> 10 must land at 370, not spin back down to 10
  const first = turnTowards(null, 350)
  const second = turnTowards(first, 10)
  assert.equal(first, 350)
  assert.equal(second, 370)
  // and applying the same target twice moves nothing (StrictMode renders twice)
  assert.equal(turnTowards(second, 10), 370)
  assert.equal(turnTowards(second, 340), 340)
})

test('bearings point where the world does', () => {
  const amsterdam = [4.9041, 52.3676]
  const north = [4.9041, 52.5]
  const east = [5.1, 52.3676]
  assert.equal(Math.round(bearingBetween(amsterdam, north)), 0)
  assert.equal(Math.round(bearingBetween(amsterdam, east)), 90)
  assert.equal(Math.round(bearingBetween(north, amsterdam)), 180)
})
