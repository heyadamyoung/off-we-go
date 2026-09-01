import assert from 'node:assert/strict'
import test from 'node:test'
import { liveFollowView } from '../src/live-map-view-core.ts'

test('the following camera waits for the initial GPS snapshot', () => {
  const view = liveFollowView(
    { center: [-32, 24], zoom: 13.9 },
    [],
    { ready: false, duration: 900 },
  )

  assert.equal(view, null)
})

test('the following camera frames every person emitting GPS', () => {
  const view = liveFollowView(
    { center: [-32, 24], zoom: 13.9 },
    [[-104.617, 50.4548], [-104.601, 50.466]],
    { ready: true, duration: 900 },
  )

  assert.deepEqual(view.bounds, [[-104.617, 50.4548], [-104.601, 50.466]])
  assert.ok(Math.abs(view.center[0] - -104.609) < 1e-10)
  assert.ok(Math.abs(view.center[1] - 50.4604) < 1e-10)
  assert.equal(view.zoom, 13.9)
  assert.equal(view.ms, 900)
})

test('the following camera zooms in on one GPS emitter', () => {
  const view = liveFollowView(
    { center: [-32, 24], zoom: 11 },
    [[-104.617, 50.4548]],
    { ready: true, duration: 560 },
  )

  assert.deepEqual(view, { center: [-104.617, 50.4548], zoom: 15, ms: 560 })
})
