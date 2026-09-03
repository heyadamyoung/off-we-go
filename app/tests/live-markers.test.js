import assert from 'node:assert/strict'
import test from 'node:test'
import { lastKnownFixes, livePhoneMarkers } from '../src/live-markers-core.ts'

const at = minutesAgo => new Date(Date.now() - minutesAgo * 60_000)

const phones = [{ id: 'phone-maya', userId: 'maya', name: "Maya's phone" }]
const family = [{ id: 'maya', name: 'Maya', avatar: 'maya.jpg' }]

test('a phone that has stopped reporting keeps its dot where it was last seen', () => {
  const fixes = [
    { deviceId: 'phone-maya', lng: 4.87, lat: 52.36, at: at(870) },
    { deviceId: 'phone-maya', lng: 4.86, lat: 52.35, at: at(900) },
  ]

  const markers = livePhoneMarkers({ fixes, fresh: [], phones, family })

  assert.equal(markers.length, 1, 'the traveller must not disappear off the map')
  assert.deepEqual(
    [markers[0].lng, markers[0].lat],
    [4.87, 52.36],
    'the newest fix is the last known',
  )
  assert.equal(markers[0].stale, true)
  assert.match(markers[0].title, /^Maya · last seen /)
})

test('a phone still reporting is live, and says how long ago plainly', () => {
  const fixes = [{ deviceId: 'phone-maya', lng: 4.87, lat: 52.36, at: at(1) }]

  const [marker] = livePhoneMarkers({ fixes, fresh: fixes, phones, family })

  assert.equal(marker.stale, false)
  assert.doesNotMatch(marker.title, /last seen/)
  assert.equal(marker.avatar, 'maya.jpg')
})

test('one dot per phone, and a phone nobody claims still gets a name', () => {
  const fixes = [
    { deviceId: 'phone-maya', lng: 4.87, lat: 52.36, at: at(5) },
    { deviceId: 'phone-maya', lng: 4.8, lat: 52.3, at: at(40) },
    { deviceId: 'phone-unknown', lng: 4.88, lat: 52.37, at: at(9) },
  ]

  const markers = livePhoneMarkers({ fixes, fresh: [fixes[0]], phones, family })

  assert.equal(markers.length, 2)
  assert.deepEqual(
    markers.map(m => m.stale),
    [false, true],
  )
  assert.equal(markers[1].name, 'Phone')
})

test('a fix without a usable position is not a place anyone was', () => {
  const fixes = [
    { deviceId: 'phone-maya', lng: Number.NaN, lat: 52.36, at: at(2) },
    { deviceId: 'phone-maya', lng: 4.87, lat: 52.36, at: at(30) },
    { deviceId: 'phone-other', lng: 4.1, lat: 52.1, at: new Date(Number.NaN) },
  ]

  const kept = lastKnownFixes(fixes)

  assert.equal(kept.length, 1)
  assert.equal(kept[0].lng, 4.87)
})
