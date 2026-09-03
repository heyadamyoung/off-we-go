import assert from 'node:assert/strict'
import test from 'node:test'
import {
  initialTripView,
  liveFollowView,
  paddingOffset,
  visibleMapPadding,
} from '../src/live-map-view-core.ts'

test('the following camera waits for the initial GPS snapshot', () => {
  const view = liveFollowView({ center: [-32, 24], zoom: 13.9 }, [], {
    ready: false,
    duration: 900,
  })

  assert.equal(view, null)
})

test('the following camera frames every person emitting GPS', () => {
  const view = liveFollowView(
    { center: [-32, 24], zoom: 13.9 },
    [
      [-104.617, 50.4548],
      [-104.601, 50.466],
    ],
    { ready: true, duration: 900 },
  )

  assert.deepEqual(view.bounds, [
    [-104.617, 50.4548],
    [-104.601, 50.466],
  ])
  assert.ok(Math.abs(view.center[0] - -104.609) < 1e-10)
  assert.ok(Math.abs(view.center[1] - 50.4604) < 1e-10)
  assert.equal(view.zoom, 13.9)
  assert.equal(view.ms, 900)
})

test('the following camera zooms in on one GPS emitter', () => {
  const view = liveFollowView({ center: [-32, 24], zoom: 11 }, [[-104.617, 50.4548]], {
    ready: true,
    duration: 560,
  })

  // focus, so the traveller lands in the middle of the map that is visible
  // rather than the middle of a container a third of which is behind chrome.
  assert.deepEqual(view, { center: [-104.617, 50.4548], zoom: 15, ms: 560, focus: true })
})

/* The map runs the full height of the screen with the chrome floating on top,
   so the middle of the container is not the middle of what anyone can see. */
test('the map is framed into the part of it that is not behind the chrome', () => {
  const phone = visibleMapPadding({ width: 390 })
  assert.ok(phone.top >= 116, 'the phone top bar is 116px of map nobody can see')
  assert.ok(phone.bottom >= 186, 'the phone day bar is 186px of map nobody can see')

  const desktop = visibleMapPadding({ width: 1280 })
  assert.ok(desktop.bottom > desktop.top, 'the bottom bar is there on a desktop too')
  assert.equal(desktop.left, 40)

  const beside = visibleMapPadding({ width: 1280, panelOpen: true })
  assert.ok(beside.left > 440, 'an open panel covers the left of the map')
})

test('focusing puts the target in the middle of the visible band, not the container', () => {
  assert.deepEqual(paddingOffset({ top: 128, right: 20, bottom: 202, left: 20 }), [0, -37])
  assert.deepEqual(paddingOffset({ top: 40, right: 40, bottom: 40, left: 40 }), [0, 0])

  // An open side panel pushes the target right, away from underneath it.
  const [x] = paddingOffset(visibleMapPadding({ width: 1280, panelOpen: true }))
  assert.ok(x > 0, 'the target should move away from the panel, not under it')
})

test('a trip that spans countries opens on the whole itinerary, never mid-sea', () => {
  // Netherlands and Scotland: the old average-of-stops seed put the opening
  // view at street zoom over the North Sea, with everything off every edge.
  const view = initialTripView([
    { lng: 4.9, lat: 52.37 }, // Amsterdam
    { lng: -3.19, lat: 55.95 }, // Edinburgh
    { lng: -5.1, lat: 57.4 }, // the Highlands
  ])
  assert.ok(view.bounds, 'a spanning trip is a bounds fit, not a point')
  assert.deepEqual(view.bounds, [
    [-5.1, 52.37],
    [4.9, 57.4],
  ])
  assert.equal(view.ms, 0, 'the first frame is placed, not animated')
})

test('a single-stop trip opens on that stop at street level', () => {
  const view = initialTripView([{ lng: -104.6, lat: 50.45 }])
  assert.deepEqual(view.center, [-104.6, 50.45])
  assert.equal(view.zoom, 13.9)
  assert.equal(view.bounds, undefined)
})

test('a trip with no stops yet opens somewhere sane instead of nowhere', () => {
  const view = initialTripView([])
  assert.ok(Number.isFinite(view.center[0]) && Number.isFinite(view.center[1]))
  assert.equal(view.bounds, undefined)
})
