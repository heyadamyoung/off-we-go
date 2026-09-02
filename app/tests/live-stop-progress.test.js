import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyLiveStopStatuses, deriveLiveStopProgress, describeLiveStopProgress, liveHistoryHours,
} from '../src/live-stop-progress-core.ts'

const NOW = new Date('2026-09-01T18:00:00.000Z')
const STOPS = [
  { id: 'museum', name: 'Museum', lng: 0.02, lat: 0, seq: 0 },
]

test('without a GPS fix the trip waits instead of presenting itinerary state as live', () => {
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [], now: NOW })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'no-fix')
  assert.equal(progress.latestFix, null)
})

test('the initial GPS snapshot is loading rather than falsely reported as disabled', () => {
  const progress = deriveLiveStopProgress({
    stops: STOPS, fixes: [], now: NOW, sourceState: 'loading',
  })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'loading')
  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Finding live location…', meta: 'Checking connected phones', tone: 'waiting',
  })
})

test('a location-service failure is not mistaken for a phone with sharing disabled', () => {
  const progress = deriveLiveStopProgress({
    stops: STOPS, fixes: [], now: NOW, sourceState: 'error',
  })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'service-error')
  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Live location unavailable', meta: 'Could not reach the location service', tone: 'waiting',
  })
})

test('a fresh accurate fix selects the nearest stop and measures the distance to it', () => {
  const fix = {
    deviceId: 'phone-1', lng: 0, lat: 0,
    accuracy: 12, speed: 1.2, at: new Date('2026-09-01T17:59:30.000Z'),
  }

  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [fix], now: NOW })

  assert.equal(progress.state, 'heading')
  assert.equal(progress.destination?.id, 'museum')
  assert.equal(progress.currentStop, null)
  assert.ok(Math.abs(progress.distanceMetres - 2223.9) < 1)
  assert.equal(progress.latestFix, fix)
})

test('within one kilometre the destination changes from heading to approaching', () => {
  const stops = [{ id: 'market', name: 'Market', lng: 0.005, lat: 0, seq: 0 }]
  const fixes = [{
    deviceId: 'phone-1', lng: 0, lat: 0,
    accuracy: 8, at: new Date('2026-09-01T17:59:45.000Z'),
  }]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'approaching')
  assert.ok(Math.abs(progress.distanceMetres - 556) < 1)
})

test('within 125 metres the nearest stop is current and distance points to the next stop', () => {
  const stops = [
    { id: 'food', name: 'Food Hall', lng: 0, lat: 0, seq: 0 },
    { id: 'house', name: 'Historic House', lng: 0.013, lat: 0, seq: 1 },
  ]
  const fixes = [{
    deviceId: 'phone-1', lng: 0.0002, lat: 0,
    accuracy: 9, speed: 0.4, at: new Date('2026-09-01T17:59:45.000Z'),
  }]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'arrived')
  assert.equal(progress.currentStop?.id, 'food')
  assert.equal(progress.destination?.id, 'house')
  assert.ok(Math.abs(progress.distanceMetres - 1423) < 2)
})

test('after leaving an observed stop the itinerary advances to the following stop', () => {
  const stops = [
    { id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 },
    { id: 'second', name: 'Second', lng: 0.01, lat: 0, seq: 1 },
    { id: 'third', name: 'Third', lng: 0.02, lat: 0, seq: 2 },
  ]
  const fixes = [
    { deviceId: 'phone-1', lng: 0, lat: 0, accuracy: 8, speed: 0.2,
      at: new Date('2026-09-01T17:57:00.000Z') },
    { deviceId: 'phone-1', lng: 0.004, lat: 0, accuracy: 8, speed: 1.2,
      at: new Date('2026-09-01T17:59:45.000Z') },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'approaching')
  assert.equal(progress.currentStop, null)
  assert.equal(progress.destination?.id, 'second')
  assert.ok(Math.abs(progress.distanceMetres - 667) < 2)
  assert.deepEqual(progress.visitedStopIds, ['first'])
})

test('a fix older than five minutes is reported as stale and never drives the trip state', () => {
  const stale = {
    deviceId: 'phone-1', lng: 0.02, lat: 0,
    accuracy: 7, at: new Date('2026-09-01T17:54:59.000Z'),
  }

  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [stale], now: NOW })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'stale-fix')
  assert.equal(progress.latestFix, null)
  assert.equal(progress.lastFix, stale)
})

test('an imprecise GPS fix asks for a better signal instead of claiming an arrival', () => {
  const imprecise = {
    deviceId: 'phone-1', lng: 0.02, lat: 0,
    accuracy: 240, at: new Date('2026-09-01T17:59:45.000Z'),
  }

  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [imprecise], now: NOW })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'poor-accuracy')
  assert.equal(progress.latestFix, null)
  assert.equal(progress.lastFix, imprecise)
})

test('a live position with no itinerary stops is distinguished from missing GPS', () => {
  const fix = {
    deviceId: 'phone-1', lng: -104.617, lat: 50.454,
    accuracy: 9, at: new Date('2026-09-01T17:59:45.000Z'),
  }

  const progress = deriveLiveStopProgress({ stops: [], fixes: [fix], now: NOW })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'no-stops')
  assert.equal(progress.latestFix, fix)
})

test('the next destination follows itinerary sequence even when stops arrive out of order', () => {
  const stops = [
    { id: 'third', name: 'Third', lng: 0.02, lat: 0, seq: 2 },
    { id: 'second', name: 'Second', lng: 0.01, lat: 0, seq: 1 },
    { id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 },
  ]
  const fixes = [{
    deviceId: 'phone-1', lng: 0, lat: 0,
    accuracy: 8, speed: 0, at: new Date('2026-09-01T17:59:45.000Z'),
  }]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'arrived')
  assert.equal(progress.currentStop?.id, 'first')
  assert.equal(progress.destination?.id, 'second')
})

test('one phone does not inherit another traveller\'s visited stops', () => {
  const stops = [
    { id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 },
    { id: 'second', name: 'Second', lng: 0.02, lat: 0, seq: 1 },
  ]
  const fixes = [
    { deviceId: 'phone-a', lng: 0, lat: 0, accuracy: 8,
      at: new Date('2026-09-01T17:58:00.000Z') },
    { deviceId: 'phone-b', lng: 0.004, lat: 0, accuracy: 8,
      at: new Date('2026-09-01T17:59:50.000Z') },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.latestFix?.deviceId, 'phone-b')
  assert.deepEqual(progress.visitedStopIds, [])
  assert.equal(progress.destination?.id, 'first')
})

test('an out-of-order visit cannot skip the itinerary or complete it', () => {
  const stops = [
    { id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 },
    { id: 'middle', name: 'Middle', lng: 0.01, lat: 0, seq: 1 },
    { id: 'final', name: 'Final', lng: 0.02, lat: 0, seq: 2 },
  ]
  const fixes = [
    { deviceId: 'phone-1', lng: 0.02, lat: 0, accuracy: 8, speed: 0,
      at: new Date('2026-09-01T17:57:00.000Z') },
    { deviceId: 'phone-1', lng: 0.024, lat: 0, accuracy: 8, speed: 1,
      at: new Date('2026-09-01T17:59:45.000Z') },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'heading')
  assert.equal(progress.destination?.id, 'first')
  assert.deepEqual(progress.visitedStopIds, [])
})

test('a return trip can revisit co-located first and final stops in sequence', () => {
  const stops = [
    { id: 'outbound', name: 'Station outbound', lng: 0, lat: 0, seq: 0 },
    { id: 'museum', name: 'Museum', lng: 0.02, lat: 0, seq: 1 },
    { id: 'return', name: 'Station return', lng: 0, lat: 0, seq: 2 },
  ]
  const fixes = [
    { deviceId: 'phone-1', lng: 0, lat: 0, accuracy: 8, speed: 0,
      at: new Date('2026-09-01T17:40:00.000Z') },
    { deviceId: 'phone-1', lng: 0.01, lat: 0, accuracy: 8, speed: 2,
      at: new Date('2026-09-01T17:45:00.000Z') },
    { deviceId: 'phone-1', lng: 0.02, lat: 0, accuracy: 8, speed: 0,
      at: new Date('2026-09-01T17:50:00.000Z') },
    { deviceId: 'phone-1', lng: 0.01, lat: 0, accuracy: 8, speed: 2,
      at: new Date('2026-09-01T17:55:00.000Z') },
    { deviceId: 'phone-1', lng: 0, lat: 0, accuracy: 8, speed: 0,
      at: new Date('2026-09-01T17:59:45.000Z') },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'arrived')
  assert.equal(progress.currentStop?.id, 'return')
  assert.deepEqual(progress.visitedStopIds, ['outbound', 'museum', 'return'])
})

test('nearby sequential stops advance when GPS is clearly closer to the next stop', () => {
  const stops = [
    { id: 'cafe', name: 'Cafe', lng: 0, lat: 0, seq: 0 },
    { id: 'gallery', name: 'Gallery', lng: 0.0009, lat: 0, seq: 1 },
  ]
  const fixes = [
    { deviceId: 'phone-1', lng: 0, lat: 0, accuracy: 8, speed: 0,
      at: new Date('2026-09-01T17:58:00.000Z') },
    { deviceId: 'phone-1', lng: 0.0009, lat: 0, accuracy: 8, speed: 0,
      at: new Date('2026-09-01T17:59:45.000Z') },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'arrived')
  assert.equal(progress.currentStop?.id, 'gallery')
  assert.deepEqual(progress.visitedStopIds, ['cafe', 'gallery'])
})

test('a multi-day trip keeps GPS visit evidence for the server retention window', () => {
  const stops = [
    { id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 },
    { id: 'second', name: 'Second', lng: 0.02, lat: 0, seq: 1 },
  ]
  const fixes = [
    { deviceId: 'phone-1', lng: 0, lat: 0, accuracy: 8, speed: 0,
      at: new Date('2026-08-29T18:00:00.000Z') },
    { deviceId: 'phone-1', lng: 0.01, lat: 0, accuracy: 8, speed: 1,
      at: new Date('2026-09-01T17:59:45.000Z') },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.deepEqual(progress.visitedStopIds, ['first'])
  assert.equal(progress.destination?.id, 'second')
  assert.equal(liveHistoryHours({ startsOn: '2026-08-20' }, NOW), 312)
  assert.equal(liveHistoryHours({}, NOW), 720)
})

test('passing a stop at driving speed does not mark the traveller as there', () => {
  const stops = [
    { id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 },
    { id: 'second', name: 'Second', lng: 0.01, lat: 0, seq: 1 },
  ]
  const fixes = [{
    deviceId: 'phone-1', lng: 0.0002, lat: 0,
    accuracy: 7, speed: 12, at: new Date('2026-09-01T17:59:50.000Z'),
  }]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'approaching')
  assert.equal(progress.currentStop, null)
  assert.equal(progress.destination?.id, 'first')
  assert.deepEqual(progress.visitedStopIds, [])
})

test('GPS uncertainty must fit inside the arrival radius before claiming we are there', () => {
  const stops = [{ id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 }]
  const fixes = [{
    deviceId: 'phone-1', lng: 0.00072, lat: 0,
    accuracy: 60, speed: 0, at: new Date('2026-09-01T17:59:50.000Z'),
  }]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'approaching')
  assert.equal(progress.currentStop, null)
  assert.equal(progress.destination?.id, 'first')
})

test('missing accuracy and motion evidence cannot claim an arrival', () => {
  const stop = [{ id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 }]
  const fixes = [{
    deviceId: 'phone-1', lng: 0, lat: 0,
    accuracy: null, speed: null, at: new Date('2026-09-01T17:59:50.000Z'),
  }]

  const progress = deriveLiveStopProgress({ stops: stop, fixes, now: NOW })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'poor-accuracy')
  assert.equal(progress.currentStop, null)
  assert.deepEqual(progress.visitedStopIds, [])
})

test('two accurate stationary fixes can establish arrival when the phone omits speed', () => {
  const stop = [{ id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 }]
  const fixes = [
    { deviceId: 'phone-1', lng: 0, lat: 0, accuracy: 8, speed: null,
      at: new Date('2026-09-01T17:59:20.000Z') },
    { deviceId: 'phone-1', lng: 0.00001, lat: 0, accuracy: 8, speed: null,
      at: new Date('2026-09-01T17:59:50.000Z') },
  ]

  const progress = deriveLiveStopProgress({ stops: stop, fixes, now: NOW })

  assert.equal(progress.state, 'arrived')
  assert.equal(progress.currentStop?.id, 'first')
})

test('approaching copy names the destination and formats its live distance', () => {
  const stops = [{ id: 'market', name: 'Market', lng: 0.005, lat: 0, seq: 0 }]
  const fixes = [{
    deviceId: 'phone-1', lng: 0, lat: 0,
    accuracy: 8, at: new Date('2026-09-01T17:59:45.000Z'),
  }]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Approaching Market', meta: '560 m away', tone: 'approaching',
  })
})

test('heading copy shows kilometres to the active destination', () => {
  const fixes = [{
    deviceId: 'phone-1', lng: 0, lat: 0,
    accuracy: 12, at: new Date('2026-09-01T17:59:30.000Z'),
  }]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Heading to Museum', meta: '2.2 km away', tone: 'heading',
  })
})

test('arrival copy identifies the current stop and distance to what comes next', () => {
  const stops = [
    { id: 'food', name: 'Food Hall', lng: 0, lat: 0, seq: 0 },
    { id: 'house', name: 'Historic House', lng: 0.013, lat: 0, seq: 1 },
  ]
  const fixes = [{
    deviceId: 'phone-1', lng: 0.0002, lat: 0,
    accuracy: 9, speed: 0.4, at: new Date('2026-09-01T17:59:45.000Z'),
  }]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'At Food Hall', meta: 'next: Historic House · 1.4 km away', tone: 'arrived',
  })
})

test('missing GPS copy tells the traveller how to make progress live', () => {
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [], now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Waiting for GPS', meta: 'Enable location sharing on a phone', tone: 'waiting',
  })
})

test('stale GPS copy states when the last update was received', () => {
  const fixes = [{
    deviceId: 'phone-1', lng: 0, lat: 0,
    accuracy: 8, at: new Date('2026-09-01T17:54:59.000Z'),
  }]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Location paused', meta: 'Last update 5 min ago', tone: 'waiting',
  })
})

test('older stale GPS copy uses hours instead of an unwieldy minute count', () => {
  const fixes = [{
    deviceId: 'phone-1', lng: 0, lat: 0,
    accuracy: 8, at: new Date('2026-09-01T16:00:00.000Z'),
  }]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Location paused', meta: 'Last update 2 h ago', tone: 'waiting',
  })
})

test('poor GPS copy exposes the accuracy instead of using that fix', () => {
  const fixes = [{
    deviceId: 'phone-1', lng: 0, lat: 0,
    accuracy: 240, at: new Date('2026-09-01T17:59:45.000Z'),
  }]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Improving GPS signal', meta: 'Last fix had 240 m accuracy', tone: 'waiting',
  })
})

test('live GPS with no stops asks for an itinerary destination', () => {
  const fixes = [{
    deviceId: 'phone-1', lng: -104.617, lat: 50.454,
    accuracy: 9, at: new Date('2026-09-01T17:59:45.000Z'),
  }]
  const progress = deriveLiveStopProgress({ stops: [], fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Live location', meta: 'Add a stop to see trip progress', tone: 'waiting',
  })
})

test('arrival at the final stop is called out without inventing another destination', () => {
  const stops = [{ id: 'museum', name: 'Museum', lng: 0, lat: 0, seq: 0 }]
  const fixes = [{
    deviceId: 'phone-1', lng: 0.0001, lat: 0,
    accuracy: 8, speed: 0, at: new Date('2026-09-01T17:59:45.000Z'),
  }]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'At Museum', meta: 'Final stop', tone: 'arrived',
  })
})

test('leaving the final observed stop completes live itinerary progress', () => {
  const stops = [{ id: 'museum', name: 'Museum', lng: 0, lat: 0, seq: 0 }]
  const fixes = [
    { deviceId: 'phone-1', lng: 0, lat: 0, accuracy: 8, speed: 0,
      at: new Date('2026-09-01T17:57:00.000Z') },
    { deviceId: 'phone-1', lng: 0.004, lat: 0, accuracy: 8,
      at: new Date('2026-09-01T17:59:45.000Z') },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'complete')
  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Route complete', meta: '1 stop visited', tone: 'complete',
  })
})

test('map positions expose one fresh reliable fix per reporting phone', () => {
  const phoneAGood = { deviceId: 'phone-a', lng: 1, lat: 1, accuracy: 15,
    at: new Date('2026-09-01T17:59:30.000Z') }
  const phoneAPoor = { deviceId: 'phone-a', lng: 2, lat: 2, accuracy: 250,
    at: new Date('2026-09-01T17:59:50.000Z') }
  const phoneB = { deviceId: 'phone-b', lng: 3, lat: 3, accuracy: 10,
    at: new Date('2026-09-01T17:59:40.000Z') }
  const phoneCStale = { deviceId: 'phone-c', lng: 4, lat: 4, accuracy: 10,
    at: new Date('2026-09-01T17:50:00.000Z') }

  const progress = deriveLiveStopProgress({
    stops: [], fixes: [phoneAGood, phoneAPoor, phoneB, phoneCStale], now: NOW,
  })

  assert.deepEqual(progress.freshFixes, [phoneB, phoneAGood])
})

test('GPS progress replaces manual stop statuses everywhere the trip is rendered', () => {
  const stops = [
    { id: 'first', name: 'First', lng: 0, lat: 0, seq: 0, status: 'next' },
    { id: 'second', name: 'Second', lng: 0.01, lat: 0, seq: 1, status: 'planned' },
    { id: 'third', name: 'Third', lng: 0.02, lat: 0, seq: 2, status: 'done' },
  ]
  const fixes = [
    { deviceId: 'phone-1', lng: 0, lat: 0, accuracy: 8, speed: 0,
      at: new Date('2026-09-01T17:57:00.000Z') },
    { deviceId: 'phone-1', lng: 0.01, lat: 0, accuracy: 8, speed: 0,
      at: new Date('2026-09-01T17:59:45.000Z') },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  const liveStops = applyLiveStopStatuses(stops, progress)

  assert.deepEqual(liveStops.map(stop => stop.status), ['done', 'now', 'next'])
  assert.deepEqual(stops.map(stop => stop.status), ['next', 'planned', 'done'])
})
