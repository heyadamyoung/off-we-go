import assert from 'node:assert/strict'
import test from 'node:test'
import { followPoints } from '../src/live-markers-core.ts'

const at = minutesAgo => new Date(Date.now() - minutesAgo * 60_000)
const regina = { deviceId: 'a', lng: -104.617, lat: 50.4548, at: at(900) }
const amsterdam = { deviceId: 'b', lng: 4.876, lat: 52.367, at: at(30) }

test('everyone reporting is framed together', () => {
  assert.deepEqual(followPoints([regina, amsterdam], [regina, amsterdam]),
    [[-104.617, 50.4548], [4.876, 52.367]])
})

/* Two phones last heard from on different continents have a midpoint in the
   Atlantic. Following that shows the ocean and nobody in it. */
test('with nobody reporting it goes to the most recent position, not everyone’s', () => {
  const points = followPoints([], [regina, amsterdam])

  assert.equal(points.length, 1, 'framing every last-known position spans continents')
  assert.deepEqual(points[0], [4.876, 52.367], 'the newest fix is the one worth looking at')
})

test('nothing to follow is nothing, not a point in the sea', () => {
  assert.deepEqual(followPoints([], []), [])
  assert.deepEqual(followPoints([], [{ deviceId: 'a', lng: Number.NaN, lat: 5, at: at(2) }]), [])
})
