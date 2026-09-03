import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nearestOf, TAP_PAD } from '../src/features/map/model/tap-target.ts'

/* The canvas tap targets — attraction dots, gates — are a few pixels wide, so
   taps resolve through a padded nearest-candidate search rather than an exact
   pixel hit. These pin the pure half of that. */

test('the candidate nearest the tap wins, wherever it sits in the list', () => {
  const tap = { x: 100, y: 100 }
  const candidates = [
    { x: 100, y: 113 }, // 13px below
    { x: 104, y: 103 }, // 5px away — the winner
    { x: 88, y: 100 }, // 12px left
  ]
  assert.equal(nearestOf(tap, candidates), 1)
})

test('a dead-centre hit beats every neighbour', () => {
  const tap = { x: 50, y: 50 }
  assert.equal(
    nearestOf(tap, [
      { x: 52, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 51 },
    ]),
    1,
  )
})

test('no candidates means no pick, not a crash', () => {
  assert.equal(nearestOf({ x: 0, y: 0 }, []), -1)
})

test('the pad is a fingertip, not a pixel', () => {
  // The regression this guards: dots are 3-7px wide, and an exact-pixel hit
  // test made the layer feel dead on a phone. Anyone shrinking this back
  // below ~10px is reintroducing that.
  assert.ok(TAP_PAD >= 10)
})
