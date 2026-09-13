import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyLiveStopStatuses,
  deriveLiveStopProgress,
  describeLiveStopProgress,
  liveHistoryHours,
} from '../src/live-stop-progress-core.ts'

const NOW = new Date('2026-09-01T18:00:00.000Z')
const STOPS = [{ id: 'museum', name: 'Museum', lng: 0.02, lat: 0, seq: 0 }]

test('without a GPS fix the trip waits instead of presenting itinerary state as live', () => {
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [], now: NOW })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'no-fix')
  assert.equal(progress.latestFix, null)
})

test('the initial GPS snapshot is loading rather than falsely reported as disabled', () => {
  const progress = deriveLiveStopProgress({
    stops: STOPS,
    fixes: [],
    now: NOW,
    sourceState: 'loading',
  })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'loading')
  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Finding live location…',
    meta: 'Checking connected phones',
    tone: 'waiting',
  })
})

test('a location-service failure is not mistaken for a phone with sharing disabled', () => {
  const progress = deriveLiveStopProgress({
    stops: STOPS,
    fixes: [],
    now: NOW,
    sourceState: 'error',
  })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'service-error')
  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Live location unavailable',
    meta: 'Could not reach the location service',
    tone: 'waiting',
  })
})

test('a fresh accurate fix selects the nearest stop and measures the distance to it', () => {
  const fix = {
    deviceId: 'phone-1',
    lng: 0,
    lat: 0,
    accuracy: 12,
    speed: 1.2,
    at: new Date('2026-09-01T17:59:30.000Z'),
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
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'approaching')
  assert.ok(Math.abs(progress.distanceMetres - 556) < 1)
})

test('within 125 metres the nearest stop is current and distance points to the next stop', () => {
  const stops = [
    { id: 'food', name: 'Food Hall', lng: 0, lat: 0, seq: 0 },
    { id: 'house', name: 'Historic House', lng: 0.013, lat: 0, seq: 1 },
  ]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0.0002,
      lat: 0,
      accuracy: 9,
      speed: 0.4,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]

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
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      speed: 0.2,
      at: new Date('2026-09-01T17:57:00.000Z'),
    },
    {
      deviceId: 'phone-1',
      lng: 0.004,
      lat: 0,
      accuracy: 8,
      speed: 1.2,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'approaching')
  assert.equal(progress.currentStop, null)
  assert.equal(progress.destination?.id, 'second')
  assert.ok(Math.abs(progress.distanceMetres - 667) < 2)
  assert.deepEqual(progress.visitedStopIds, ['first'])
})

test('a fix older than the freshness window does not pass for a live one', () => {
  /* A kilometre short of the museum, a quarter of an hour ago. Nowhere near
     enough to have been there, and too old to be where they are now — so the
     dot has nothing current to draw and says so. */
  const stale = {
    deviceId: 'phone-1',
    lng: 0.01,
    lat: 0,
    accuracy: 7,
    at: new Date('2026-09-01T17:44:59.000Z'),
  }

  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [stale], now: NOW })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'stale-fix')
  assert.equal(progress.latestFix, null)
  assert.equal(progress.lastFix, stale)
})

test('a phone going quiet does not un-visit the places it saw', () => {
  /* The other side of the same fix. A phone that reported all day and went
     flat at six has not un-been anywhere, and a trip that forgot its own day
     every evening would be worse than useless. Staleness is a fact about the
     live dot; it is not an argument about the past. */
  const stale = {
    deviceId: 'phone-1',
    lng: 0.02,
    lat: 0,
    accuracy: 7,
    at: new Date('2026-09-01T14:00:00.000Z'),
  }

  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [stale], now: NOW })

  assert.equal(progress.latestFix, null, 'still nothing live')
  assert.deepEqual(progress.visitedStopIds, ['museum'], 'and the museum still happened')
})

test('an imprecise GPS fix asks for a better signal instead of claiming an arrival', () => {
  const imprecise = {
    deviceId: 'phone-1',
    lng: 0.02,
    lat: 0,
    accuracy: 240,
    at: new Date('2026-09-01T17:59:45.000Z'),
  }

  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [imprecise], now: NOW })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'poor-accuracy')
  assert.equal(progress.latestFix, null)
  assert.equal(progress.lastFix, imprecise)
})

test('a live position with no itinerary stops is distinguished from missing GPS', () => {
  const fix = {
    deviceId: 'phone-1',
    lng: -104.617,
    lat: 50.454,
    accuracy: 9,
    at: new Date('2026-09-01T17:59:45.000Z'),
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
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'arrived')
  assert.equal(progress.currentStop?.id, 'first')
  assert.equal(progress.destination?.id, 'second')
})

test("one phone does not inherit another traveller's visited stops", () => {
  const stops = [
    { id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 },
    { id: 'second', name: 'Second', lng: 0.02, lat: 0, seq: 1 },
  ]
  const fixes = [
    { deviceId: 'phone-a', lng: 0, lat: 0, accuracy: 8, at: new Date('2026-09-01T17:58:00.000Z') },
    {
      /* Well clear of the first stop on its own account — at four hundred
         metres it would now arrive there itself, which would prove nothing
         about whose visits it inherits. */
      deviceId: 'phone-b',
      lng: 0.009,
      lat: 0,
      accuracy: 8,
      at: new Date('2026-09-01T17:59:50.000Z'),
    },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.latestFix?.deviceId, 'phone-b')
  assert.deepEqual(progress.visitedStopIds, [])
  assert.equal(progress.destination?.id, 'first')
})

test('being at a later day’s stop early does not tick it off', () => {
  /* The guarantee the in-order walk existed for, now made by the calendar
     instead. Driving past Thursday's restaurant on Monday is not dinner, and
     the old model could only say so by refusing to look at anything past the
     stop it was parked on — which is what made it freeze. */
  const stops = [
    ON('2026-09-01', { id: 'monday', name: 'Monday', lng: 4.8852, lat: 52.36, seq: 0 }),
    ON('2026-09-02', { id: 'tuesday', name: 'Tuesday', lng: 4.8687, lat: 52.3579, seq: 1 }),
    ON('2026-09-04', { id: 'thursday', name: 'Thursday', lng: 2.3522, lat: 48.8566, seq: 2 }),
  ]

  const progress = deriveLiveStopProgress({
    stops,
    fixes: [fix(near(stops[2], 10), '2026-09-01T17:55:00.000Z')],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, [], 'nothing has happened yet')
  assert.equal(progress.destination?.id, 'monday', 'and today is still today')
})

test('a return trip visits both ends of the same station, each on its own day', () => {
  /* Out on Monday, the museum on Tuesday, home from the same platform on
     Wednesday. Two stops share one pin and the days are the only thing that
     tells them apart — which is exactly what a trip has, and exactly what the
     ordering walk was groping for. */
  const platform = { lng: 4.9003, lat: 52.379 }
  const stops = [
    ON('2026-08-31', { id: 'outbound', name: 'Station out', ...platform, seq: 0 }),
    ON('2026-09-01', { id: 'museum', name: 'Museum', lng: 4.8852, lat: 52.36, seq: 1 }),
    ON('2026-09-02', { id: 'return', name: 'Station back', ...platform, seq: 2 }),
  ]

  const monday = deriveLiveStopProgress({
    stops,
    fixes: [fix(near(stops[0], 10), '2026-08-31T09:00:00.000Z')],
    now: new Date('2026-08-31T18:00:00.000Z'),
  })
  assert.deepEqual(monday.visitedStopIds, ['outbound'], 'one end, not both')
  assert.equal(monday.destination?.id, 'museum')

  const wednesday = deriveLiveStopProgress({
    stops,
    fixes: [
      fix(near(stops[0], 10), '2026-08-31T09:00:00.000Z'),
      fix(near(stops[1], 10), '2026-09-01T13:00:00.000Z'),
      fix(near(stops[2], 10), '2026-09-02T17:55:00.000Z'),
    ],
    now: new Date('2026-09-02T18:00:00.000Z'),
  })
  assert.deepEqual(wednesday.visitedStopIds, ['outbound', 'museum', 'return'])
  assert.equal(wednesday.destination, null, 'and the trip is done')
})

test('nearby sequential stops advance when GPS is clearly closer to the next stop', () => {
  const stops = [
    { id: 'cafe', name: 'Cafe', lng: 0, lat: 0, seq: 0 },
    { id: 'gallery', name: 'Gallery', lng: 0.0009, lat: 0, seq: 1 },
  ]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:58:00.000Z'),
    },
    {
      deviceId: 'phone-1',
      lng: 0.0009,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
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
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-08-29T18:00:00.000Z'),
    },
    {
      deviceId: 'phone-1',
      lng: 0.01,
      lat: 0,
      accuracy: 8,
      speed: 1,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
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
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0.0002,
      lat: 0,
      accuracy: 7,
      speed: 12,
      at: new Date('2026-09-01T17:59:50.000Z'),
    },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'approaching')
  assert.equal(progress.currentStop, null)
  assert.equal(progress.destination?.id, 'first')
  assert.deepEqual(progress.visitedStopIds, [])
})

test('a fix that is confidently outside cannot claim an arrival', () => {
  /* This used to require the opposite — that distance PLUS accuracy fit inside
     the radius, so a fix had to prove it was there. A vague fix can prove
     nothing, which made uncertainty a bar to arriving and froze the itinerary
     of anybody whose phone was indoors. The question is the other way round
     now: could it be inside? Eight hundred metres out with sixty metres of
     doubt could not be, whichever way the error falls. */
  const stops = [{ id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 }]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0.0072,
      lat: 0,
      accuracy: 60,
      speed: 0,
      at: new Date('2026-09-01T17:59:50.000Z'),
    },
  ]

  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'approaching')
  assert.equal(progress.currentStop, null)
  assert.deepEqual(progress.visitedStopIds, [])
  assert.equal(progress.destination?.id, 'first')
})

test('being somewhere now is a tighter question than having been there', () => {
  /* Two questions that shared one number. Walk five minutes down the road from
     the museum and you have certainly been to it — the itinerary must move on,
     or every stop after it freezes — but you are no longer at it, and the
     words under the live dot should not say you are. */
  const stops = [
    { id: 'museum', name: 'Museum', lng: 0, lat: 0, seq: 0 },
    { id: 'later', name: 'Later', lng: 0.05, lat: 0, seq: 1 },
  ]
  const away = metres => ({
    deviceId: 'phone-1',
    lng: 0,
    lat: metres / 111_320,
    accuracy: 10,
    speed: 0.4,
    at: new Date('2026-09-01T17:59:00.000Z'),
  })

  const here = deriveLiveStopProgress({ stops, fixes: [away(100)], now: NOW })
  assert.equal(here.currentStop?.id, 'museum', 'a hundred metres away is at it')

  const gone = deriveLiveStopProgress({ stops, fixes: [away(420)], now: NOW })
  assert.deepEqual(gone.visitedStopIds, ['museum'], 'four hundred is still a visit')
  assert.equal(gone.currentStop, null, 'but not a place you still are')
  assert.equal(gone.destination?.id, 'later')
})

test('missing accuracy and motion evidence cannot claim an arrival', () => {
  const stop = [{ id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 }]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: null,
      speed: null,
      at: new Date('2026-09-01T17:59:50.000Z'),
    },
  ]

  const progress = deriveLiveStopProgress({ stops: stop, fixes, now: NOW })

  assert.equal(progress.state, 'waiting')
  assert.equal(progress.reason, 'poor-accuracy')
  assert.equal(progress.currentStop, null)
  assert.deepEqual(progress.visitedStopIds, [])
})

test('two accurate stationary fixes can establish arrival when the phone omits speed', () => {
  const stop = [{ id: 'first', name: 'First', lng: 0, lat: 0, seq: 0 }]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      speed: null,
      at: new Date('2026-09-01T17:59:20.000Z'),
    },
    {
      deviceId: 'phone-1',
      lng: 0.00001,
      lat: 0,
      accuracy: 8,
      speed: null,
      at: new Date('2026-09-01T17:59:50.000Z'),
    },
  ]

  const progress = deriveLiveStopProgress({ stops: stop, fixes, now: NOW })

  assert.equal(progress.state, 'arrived')
  assert.equal(progress.currentStop?.id, 'first')
})

test('approaching copy names the destination and formats its live distance', () => {
  const stops = [{ id: 'market', name: 'Market', lng: 0.005, lat: 0, seq: 0 }]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Approaching Market',
    meta: '560 m away',
    tone: 'approaching',
  })
})

test('heading copy shows kilometres to the active destination', () => {
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 12,
      at: new Date('2026-09-01T17:59:30.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Heading to Museum',
    meta: '2.2 km away',
    tone: 'heading',
  })
})

test('arrival copy identifies the current stop and distance to what comes next', () => {
  const stops = [
    { id: 'food', name: 'Food Hall', lng: 0, lat: 0, seq: 0 },
    { id: 'house', name: 'Historic House', lng: 0.013, lat: 0, seq: 1 },
  ]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0.0002,
      lat: 0,
      accuracy: 9,
      speed: 0.4,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'At Food Hall',
    meta: 'next: Historic House · 1.4 km away',
    tone: 'arrived',
  })
})

test('missing GPS copy tells the traveller how to make progress live', () => {
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [], now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Waiting for GPS',
    meta: 'Enable location sharing on a phone',
    tone: 'waiting',
  })
})

test('stale GPS is called what it is — silence, never a claimed pause', () => {
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      at: new Date('2026-09-01T17:39:59.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'No update for 20 min',
    meta: 'Showing the last known position',
    tone: 'waiting',
  })
})

test('older stale GPS copy uses hours instead of an unwieldy minute count', () => {
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      at: new Date('2026-09-01T16:00:00.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'No update for 2 h',
    meta: 'Showing the last known position',
    tone: 'waiting',
  })
})

test('a pause the phone reported is said plainly', () => {
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      at: new Date('2026-09-01T17:39:59.000Z'),
    },
  ]
  const devices = [
    {
      lastSeen: new Date('2026-09-01T17:39:59.000Z'),
      pausedAt: new Date('2026-09-01T17:55:30.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes, now: NOW, devices })

  assert.equal(progress.reason, 'paused')
  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Sharing paused',
    meta: 'Last update 20 min ago',
    tone: 'waiting',
  })
})

test('a phone that reported again after its pause is not paused any more', () => {
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      at: new Date('2026-09-01T17:39:59.000Z'),
    },
  ]
  const devices = [
    {
      lastSeen: new Date('2026-09-01T17:39:59.000Z'),
      pausedAt: new Date('2026-09-01T17:00:00.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes, now: NOW, devices })

  assert.equal(progress.reason, 'stale-fix')
})

test('a pause with no fix at all still reads as paused, not as missing GPS', () => {
  const devices = [{ lastSeen: null, pausedAt: new Date('2026-09-01T17:55:30.000Z') }]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes: [], now: NOW, devices })

  assert.equal(progress.reason, 'paused')
  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Sharing paused',
    meta: 'Paused on the phone',
    tone: 'waiting',
  })
})

test('poor GPS copy exposes the accuracy instead of using that fix', () => {
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 240,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops: STOPS, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Improving GPS signal',
    meta: 'Last fix had 240 m accuracy',
    tone: 'waiting',
  })
})

test('live GPS with no stops asks for an itinerary destination', () => {
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: -104.617,
      lat: 50.454,
      accuracy: 9,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops: [], fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Live location',
    meta: 'Add a stop to see trip progress',
    tone: 'waiting',
  })
})

test('arrival at the final stop is called out without inventing another destination', () => {
  const stops = [{ id: 'museum', name: 'Museum', lng: 0, lat: 0, seq: 0 }]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0.0001,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'At Museum',
    meta: 'Final stop',
    tone: 'arrived',
  })
})

test('leaving the final observed stop completes live itinerary progress', () => {
  const stops = [{ id: 'museum', name: 'Museum', lng: 0, lat: 0, seq: 0 }]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:57:00.000Z'),
    },
    {
      deviceId: 'phone-1',
      lng: 0.004,
      lat: 0,
      accuracy: 8,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.state, 'complete')
  assert.deepEqual(describeLiveStopProgress(progress, NOW), {
    text: 'Route complete',
    meta: '1 stop visited',
    tone: 'complete',
  })
})

test('map positions expose one fresh reliable fix per reporting phone', () => {
  const phoneAGood = {
    deviceId: 'phone-a',
    lng: 1,
    lat: 1,
    accuracy: 15,
    at: new Date('2026-09-01T17:59:30.000Z'),
  }
  const phoneAPoor = {
    deviceId: 'phone-a',
    lng: 2,
    lat: 2,
    accuracy: 250,
    at: new Date('2026-09-01T17:59:50.000Z'),
  }
  const phoneB = {
    deviceId: 'phone-b',
    lng: 3,
    lat: 3,
    accuracy: 10,
    at: new Date('2026-09-01T17:59:40.000Z'),
  }
  const phoneCStale = {
    deviceId: 'phone-c',
    lng: 4,
    lat: 4,
    accuracy: 10,
    at: new Date('2026-09-01T17:40:00.000Z'),
  }

  const progress = deriveLiveStopProgress({
    stops: [],
    fixes: [phoneAGood, phoneAPoor, phoneB, phoneCStale],
    now: NOW,
  })

  assert.deepEqual(progress.freshFixes, [phoneB, phoneAGood])
})

test('GPS overrides a stale planned or up-next everywhere the trip is rendered', () => {
  /* What the phones do know, they are believed about. The first stop was left
     marked Up next and has since been walked past; the live list says so.

     It used to say the overlay replaced manual statuses full stop, and the
     fixture marked the third stop Visited by hand and expected it back as Up
     next. That is the bug in its live form — the app telling somebody they
     are heading to a place they have said they already saw — so the fixture
     leaves that case to the tests below and this one keeps what is true. */
  const stops = [
    { id: 'first', name: 'First', lng: 0, lat: 0, seq: 0, status: 'next' },
    { id: 'second', name: 'Second', lng: 0.01, lat: 0, seq: 1, status: 'planned' },
    { id: 'third', name: 'Third', lng: 0.02, lat: 0, seq: 2, status: 'planned' },
  ]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:57:00.000Z'),
    },
    {
      deviceId: 'phone-1',
      lng: 0.01,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  const liveStops = applyLiveStopStatuses(stops, progress)

  assert.deepEqual(
    liveStops.map(stop => stop.status),
    ['done', 'now', 'next'],
  )
  // And the itinerary itself is untouched — the overlay is a view, not a write.
  assert.deepEqual(
    stops.map(stop => stop.status),
    ['next', 'planned', 'planned'],
  )
})

test('a status somebody set by hand survives a trip with no live location', () => {
  /* The reported bug, and the ordinary case: nobody is sharing a location.
     You open a stop, tap Visited, watch it save — and it comes back Planned.

     The overlay knows three things: where a phone is now, where it is heading,
     and which stops it has actually been at. With no fix it knows none of
     them, and it said 'planned' about every stop on the trip anyway. The
     itinerary is drawn from this list everywhere — map, timeline, strip,
     detail card — so the status a person chose was written to the server
     correctly and then painted over on the way to the screen. */
  const stops = [
    { id: 'a', name: 'A', lng: 0, lat: 0, seq: 0, status: 'done' },
    { id: 'b', name: 'B', lng: 0.01, lat: 0, seq: 1, status: 'now' },
    { id: 'c', name: 'C', lng: 0.02, lat: 0, seq: 2, status: 'planned' },
    { id: 'd', name: 'D', lng: 0.03, lat: 0, seq: 3 },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes: [], now: NOW })
  assert.equal(progress.state, 'waiting', 'no fix, so the overlay knows nothing')

  assert.deepEqual(
    applyLiveStopStatuses(stops, progress).map(stop => stop.status),
    ['done', 'now', 'planned', undefined],
  )
})

test('a phone that was not there cannot un-visit somewhere you were', () => {
  /* Live GPS covers two of these stops and has never heard of the third. A
     person marked it Visited — they were there before location sharing was
     switched on, or with the phone in a drawer. The absence of a fix is not
     evidence they were not there, so 'done' set by hand is never taken away. */
  const stops = [
    { id: 'first', name: 'First', lng: 0, lat: 0, seq: 0, status: 'planned' },
    { id: 'second', name: 'Second', lng: 0.01, lat: 0, seq: 1, status: 'planned' },
    { id: 'elsewhere', name: 'Elsewhere', lng: 40, lat: 40, seq: 2, status: 'done' },
  ]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:57:00.000Z'),
    },
    {
      deviceId: 'phone-1',
      lng: 0.01,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  const live = applyLiveStopStatuses(stops, progress)
  assert.equal(live.at(-1).status, 'done', 'the one the GPS knows nothing about keeps what it had')
})

test('only one stop is ever the one you are at', () => {
  /* Not a bug — a guard on the half of the old behaviour that was right, so
     that leaving stored statuses alone does not quietly reintroduce a second
     "Happening now". Where the overlay has an opinion at all, a stale 'now'
     or 'next' on a stop it is not talking about gives way. A 'done' does not:
     that is the test above. */
  const stops = [
    { id: 'a', name: 'A', lng: 0, lat: 0, seq: 0, status: 'planned' },
    { id: 'b', name: 'B', lng: 0.01, lat: 0, seq: 1, status: 'planned' },
    { id: 'c', name: 'C', lng: 0.02, lat: 0, seq: 2, status: 'planned' },
    { id: 'stale', name: 'Stale', lng: 0.03, lat: 0, seq: 3, status: 'now' },
  ]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:57:00.000Z'),
    },
    {
      deviceId: 'phone-1',
      lng: 0.01,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })
  assert.equal(progress.currentStop?.id, 'b')
  assert.equal(progress.destination?.id, 'c')

  const live = applyLiveStopStatuses(stops, progress)
  assert.equal(live.at(-1).status, 'planned', 'the stale one gives way')
  assert.equal(live.filter(stop => stop.status === 'now').length, 1)
})

test('a stop marked Visited by hand does not stall the itinerary behind it', () => {
  /* The middle case, and the worst one. The cursor walks the itinerary in
     order and only moves on when a phone arrives at the stop it is waiting
     for. Park it on somewhere the traveller has already been and marked
     Visited — a museum they saw before they turned location sharing on — and
     no fix will ever satisfy it, because nobody is going back. The cursor
     stops there for the rest of the trip: no stop after it is ever the
     destination, nothing further is ever reached, and the live banner spends
     a fortnight saying "Heading to" a place three days behind. */
  const stops = [
    { id: 'seen', name: 'Seen already', lng: 40, lat: 40, seq: 0, status: 'done' },
    { id: 'here', name: 'Here', lng: 0, lat: 0, seq: 1, status: 'planned' },
    { id: 'onwards', name: 'Onwards', lng: 0.01, lat: 0, seq: 2, status: 'planned' },
  ]
  const fixes = [
    {
      deviceId: 'phone-1',
      lng: 0,
      lat: 0,
      accuracy: 8,
      speed: 0,
      at: new Date('2026-09-01T17:59:45.000Z'),
    },
  ]
  const progress = deriveLiveStopProgress({ stops, fixes, now: NOW })

  assert.equal(progress.currentStop?.id, 'here', 'the phone is at the stop it is actually at')
  assert.equal(progress.destination?.id, 'onwards', 'and the trip carries on past the skipped one')
  assert.deepEqual(
    applyLiveStopStatuses(stops, progress).map(stop => stop.status),
    ['done', 'now', 'next'],
  )
})

/* ---- arrival, as a phone on a real trip actually reports it --------------

   Reported as the itinerary being stuck on the first stop — an early flight —
   and never picking up anywhere visited since.

   The cursor walks the itinerary in order and moves on only when the phone
   arrives at the stop it is waiting for, so one arrival that fails to register
   freezes every stop after it for the rest of the trip. Arrival demanded four
   things at once: an accuracy, a speed, that speed under 18km/h, and the fix's
   distance PLUS its accuracy inside 125 metres. Any one of them missing is a
   permanent no.

   Every fixture above this line reports a speed and an accuracy in single
   figures, which is a phone held still in the open with the screen on. The
   ones below are what a phone on a trip sends: minutes between fixes, tens of
   metres of accuracy indoors, and often no speed at all. */

const RIJKS = { id: 'rijks', name: 'Rijksmuseum', lng: 4.8852, lat: 52.36, seq: 0 }
const VONDEL = { id: 'vondel', name: 'Vondelpark', lng: 4.8687, lat: 52.3579, seq: 1 }
const CENTRAAL = { id: 'centraal', name: 'Centraal', lng: 4.9003, lat: 52.379, seq: 2 }
const ITINERARY = [RIJKS, VONDEL, CENTRAAL]

const METRE = 1 / 111_320
const near = (stop, metresNorth) => ({ lng: stop.lng, lat: stop.lat + metresNorth * METRE })
const fix = (point, at, extra = {}) => ({
  deviceId: 'phone-1',
  ...point,
  accuracy: 20,
  at: new Date(at),
  ...extra,
})

test('a phone that reports every few minutes still arrives somewhere', () => {
  /* The commonest shape of the bug. Nothing is wrong with these fixes: the
     phone is standing at the museum, twenty metres of accuracy, reporting
     every five minutes as a backgrounded app does. It reports no speed,
     because it is not moving, and a speed worked out from a fix five minutes
     old is refused as too old to mean anything.

     That left `speed` unknown — and unknown was treated as disqualifying, so
     this phone could never arrive anywhere, ever. A missing signal is not a
     negative one. */
  const progress = deriveLiveStopProgress({
    stops: ITINERARY,
    fixes: [
      fix(near(RIJKS, 0), '2026-09-01T17:45:00.000Z'),
      fix(near(RIJKS, 5), '2026-09-01T17:50:00.000Z'),
      fix(near(RIJKS, 3), '2026-09-01T17:55:00.000Z'),
    ],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, ['rijks'])
  assert.equal(progress.destination?.id, 'vondel', 'and the trip has moved on to the next one')
})

test('a fix only has to be plausibly inside, not provably inside', () => {
  /* Indoors, in a station, in a city of tall buildings, a phone reports tens
     of metres of accuracy. The test was distance PLUS accuracy inside the
     radius — which is asking the fix to prove it is inside, and a vague fix
     can never prove anything. So the vaguer the reading the less likely it
     was to count, exactly backwards: a fix that says "somewhere within ninety
     metres of here" and is standing a hundred metres from the door is
     plainly at the museum. */
  const progress = deriveLiveStopProgress({
    stops: ITINERARY,
    fixes: [fix(near(RIJKS, 100), '2026-09-01T17:55:00.000Z', { accuracy: 90, speed: 0.5 })],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, ['rijks'])
})

test('an itinerary item is a place, not a pin', () => {
  /* A stop is one point and the thing it names is a building, a park, an
     airport, a square. A hundred and twenty-five metres is a radius sized for
     GPS error rather than for anywhere anybody goes — it is narrower than the
     Rijksmuseum is wide. Four hundred metres from the pin is still at it. */
  const progress = deriveLiveStopProgress({
    stops: ITINERARY,
    fixes: [fix(near(RIJKS, 400), '2026-09-01T17:55:00.000Z', { accuracy: 10, speed: 0.5 })],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, ['rijks'])
})

test('a whole day of walking is picked up, not just the first stop', () => {
  /* The report, end to end: three stops, a phone reporting the way a phone
     does, and by the evening the trip should know all three have happened —
     rather than sitting on the first one for the rest of the fortnight. */
  const progress = deriveLiveStopProgress({
    stops: ITINERARY,
    fixes: [
      fix(near(RIJKS, 60), '2026-09-01T10:00:00.000Z'),
      fix(near(RIJKS, 20), '2026-09-01T10:30:00.000Z'),
      fix(near(VONDEL, 120), '2026-09-01T13:00:00.000Z', { accuracy: 45 }),
      fix(near(VONDEL, 80), '2026-09-01T13:40:00.000Z', { accuracy: 45 }),
      fix(near(CENTRAAL, 200), '2026-09-01T17:50:00.000Z', { accuracy: 60 }),
      fix(near(CENTRAAL, 150), '2026-09-01T17:56:00.000Z', { accuracy: 60 }),
    ],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, ['rijks', 'vondel', 'centraal'])
  assert.equal(progress.currentStop?.id, 'centraal', 'and it knows where they are now')
})

test('driving straight past is still not arriving', () => {
  /* The gate the speed limit is actually for, and the one worth keeping. A
     wider radius makes this matter more, not less: at sixty miles an hour a
     five-hundred-metre circle is nineteen seconds of motorway. */
  const progress = deriveLiveStopProgress({
    stops: ITINERARY,
    fixes: [
      fix(near(RIJKS, 300), '2026-09-01T17:54:00.000Z', { speed: 28 }),
      fix(near(RIJKS, 60), '2026-09-01T17:55:00.000Z', { speed: 28 }),
    ],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, [], 'passing through is not being there')
})

/* ---- ways past a stop nobody's phone ever saw -----------------------------

   The itinerary is a cursor: it advances when the phone arrives at the stop it
   is waiting for, and there was no other way forward. So one stop a phone
   never saw — an airport on the first morning, a place somebody drove past,
   anywhere at all with location sharing off — stopped the trip dead, for the
   rest of the trip. Every stop after it stayed planned for a fortnight and
   nothing anybody did in the app could move it.

   Widening the radius makes that rarer. It cannot make it impossible, and a
   thing that wedges permanently needs a way out rather than better odds. There
   are three, and they are all evidence that the trip has moved on rather than
   guesses that it has:

     - somebody marked the stop Visited
     - its day is over
     - the phone did in fact arrive there, which is the ordinary path

   What there is NOT is "we could not find an arrival, so let us assume" — that
   would let a trip that starts and ends at the same hotel mark itself complete
   on the first morning. */

const ON = (day, stop) => ({ ...stop, day })

test('a stop from a day that is over does not hold the rest of the trip', () => {
  /* The report. An early flight the phone never reported near — in the air, in
     a terminal, location sharing not switched on yet — and behind it a trip
     that never moved again. The day is over; the flight is behind us whether
     or not anything saw it. */
  const stops = [
    ON('2026-08-30', { id: 'flight', name: 'Flight', lng: -104.66, lat: 50.43, seq: 0 }),
    ON('2026-09-01', { id: 'museum', name: 'Museum', lng: 4.8852, lat: 52.36, seq: 1 }),
    ON('2026-09-01', { id: 'park', name: 'Park', lng: 4.8687, lat: 52.3579, seq: 2 }),
  ]
  const progress = deriveLiveStopProgress({
    stops,
    fixes: [
      fix(near(stops[1], 30), '2026-09-01T17:50:00.000Z'),
      fix(near(stops[1], 10), '2026-09-01T17:56:00.000Z'),
    ],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, ['museum'], 'the flight was never seen, not claimed')
  assert.equal(progress.currentStop?.id, 'museum', 'but the trip is where it actually is')
  assert.equal(progress.destination?.id, 'park')
})

test('a day that is over does not erase what the phone did see on it', () => {
  /* The other half. Letting go of a stop nobody saw must not throw away the
     ones they did: the trip's own history is the point of the thing. */
  const stops = [
    ON('2026-08-30', { id: 'first', name: 'First', lng: 4.8852, lat: 52.36, seq: 0 }),
    ON('2026-08-30', { id: 'skipped', name: 'Skipped', lng: 2.3522, lat: 48.8566, seq: 1 }),
    ON('2026-09-01', { id: 'today', name: 'Today', lng: 4.8687, lat: 52.3579, seq: 2 }),
  ]
  const progress = deriveLiveStopProgress({
    stops,
    fixes: [
      fix(near(stops[0], 20), '2026-08-30T11:00:00.000Z'),
      fix(near(stops[2], 20), '2026-09-01T17:55:00.000Z'),
    ],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, ['first', 'today'])
})

test('a stop whose day has not come is still ahead', () => {
  /* The hatch is "the day is over", not "the day is not now". Tomorrow's stop
     is the destination, not something to be let go of. */
  const stops = [
    ON('2026-09-01', { id: 'today', name: 'Today', lng: 4.8852, lat: 52.36, seq: 0 }),
    ON('2026-09-02', { id: 'tomorrow', name: 'Tomorrow', lng: 4.8687, lat: 52.3579, seq: 1 }),
  ]
  const progress = deriveLiveStopProgress({
    stops,
    fixes: [fix(near(stops[0], 3000), '2026-09-01T17:55:00.000Z')],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, [])
  assert.equal(progress.destination?.id, 'today', "today's stop has not happened yet")
})

test('an undated itinerary still gets out of the way when somebody says so', () => {
  /* No dates to go on, which is an ordinary trip to have. The remaining way
     past is a person saying they were there — and it has to work on a stop the
     phone has no opinion about at all, which is the case it exists for. */
  const stops = [
    { id: 'unseen', name: 'Unseen', lng: -104.66, lat: 50.43, seq: 0, status: 'done' },
    { id: 'here', name: 'Here', lng: 4.8852, lat: 52.36, seq: 1 },
    { id: 'next', name: 'Next', lng: 4.8687, lat: 52.3579, seq: 2 },
  ]
  const progress = deriveLiveStopProgress({
    stops,
    fixes: [fix(near(stops[1], 20), '2026-09-01T17:55:00.000Z')],
    now: NOW,
  })

  assert.equal(progress.currentStop?.id, 'here')
  assert.equal(progress.destination?.id, 'next')
})

test('the itinerary is walked in the order the trip happens, not the order it was typed', () => {
  /* Stops are numbered as they are added, and nobody plans a trip in order:
     the flight out gets remembered halfway through writing up the museums,
     and the flight home gets typed last of all. Everywhere a traveller reads
     the itinerary — the timeline, the day bar, the strip along the bottom —
     it is ordered by day. The live cursor read it by the numbers instead, so
     it walked a different trip from the one on the screen: parked on
     something three days out while the stop in front of them was never even
     considered, and moving between them in an order that looks like nothing
     at all. */
  const stops = [
    { id: 'wednesday', name: 'Wednesday', lng: 2.3522, lat: 48.8566, day: '2026-09-03', seq: 0 },
    { id: 'monday', name: 'Monday', lng: 4.8852, lat: 52.36, day: '2026-09-01', seq: 1 },
    { id: 'tuesday', name: 'Tuesday', lng: 4.8687, lat: 52.3579, day: '2026-09-02', seq: 2 },
  ]

  const progress = deriveLiveStopProgress({
    stops,
    fixes: [fix(near(stops[1], 20), '2026-09-01T17:55:00.000Z')],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, ['monday'], 'the day they are actually on')
  assert.equal(progress.currentStop?.id, 'monday')
  assert.equal(progress.destination?.id, 'tuesday', 'and the next day comes next')
})

test('stops on the same day keep the order somebody put them in', () => {
  /* The day decides first and the itinerary's own numbering decides within
     it, which is exactly what the timeline does. */
  const stops = [
    { id: 'afternoon', name: 'Afternoon', lng: 4.8687, lat: 52.3579, day: '2026-09-01', seq: 9 },
    { id: 'morning', name: 'Morning', lng: 4.8852, lat: 52.36, day: '2026-09-01', seq: 2 },
    { id: 'someday', name: 'Someday', lng: 2.3522, lat: 48.8566, seq: 1 },
  ]

  const walked = deriveLiveStopProgress({
    stops,
    fixes: [
      fix(near(stops[1], 20), '2026-09-01T17:40:00.000Z'),
      fix(near(stops[0], 20), '2026-09-01T17:55:00.000Z'),
    ],
    now: NOW,
  })
  assert.deepEqual(walked.visitedStopIds, ['morning', 'afternoon'])
  assert.equal(walked.destination?.id, 'someday', 'and anything undated waits at the end')
})

/* ---- the heuristic itself ------------------------------------------------

   Everything above is the old model being patched: a cursor that walked the
   itinerary and moved on only when the phone arrived at the stop it was
   waiting for. It has one shape of failure and it has it permanently — any
   condition that fails to fire leaves the cursor where it is, for ever, and
   every fix so far has been another way to shove it along.

   So the model changes. Time is the backbone and the phone is evidence, which
   is the opposite of a cursor with the calendar bolted on as an escape hatch.
   Three questions, and none of them can block another:

     VISITED   per stop, on its own evidence: a fix near it, dated on or after
               that stop's own day — or a person saying so.
     HERE      the stop the latest fix is standing at, if any.
     NEXT      the first stop in trip order that is neither visited nor on a
               day that is over.

   It cannot wedge, and the reason is worth stating outright: NEXT depends on
   what has been visited and on the calendar, and the calendar advances every
   midnight whether or not anybody's phone is on. The worst a stop nobody ever
   saw can do is be next until its day passes. That is bounded by a day rather
   than by the length of the trip. */

test('a stop is visited on its own evidence, not on its neighbours’', () => {
  /* No cursor. Missing the first stop entirely says nothing at all about the
     second and third — under the old model it said everything, because the
     cursor sat on the first one and nothing behind it was ever examined. */
  const stops = [
    ON('2026-09-01', { id: 'missed', name: 'Missed', lng: -104.66, lat: 50.43, seq: 0 }),
    ON('2026-09-01', { id: 'museum', name: 'Museum', lng: 4.8852, lat: 52.36, seq: 1 }),
    ON('2026-09-01', { id: 'park', name: 'Park', lng: 4.8687, lat: 52.3579, seq: 2 }),
  ]
  const progress = deriveLiveStopProgress({
    stops,
    fixes: [
      fix(near(stops[1], 20), '2026-09-01T14:00:00.000Z'),
      fix(near(stops[2], 20), '2026-09-01T17:55:00.000Z'),
    ],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, ['museum', 'park'])
  assert.equal(progress.destination?.id, 'missed', 'still on today, so still ahead')
})

test('the same place on two days is told apart by the day', () => {
  /* The guarantee the cursor existed for, done properly. A trip that starts
     and ends at the same hotel must not tick off the last night on the first
     morning — and the calendar knows which is which, where an ordering walk
     only knew that one came after the other. */
  const hotel = { lng: 4.8852, lat: 52.36 }
  const stops = [
    ON('2026-09-01', { id: 'first-night', name: 'Hotel', ...hotel, seq: 0 }),
    ON('2026-09-05', { id: 'last-night', name: 'Hotel', ...hotel, seq: 1 }),
  ]
  const progress = deriveLiveStopProgress({
    stops,
    fixes: [fix(near(stops[0], 10), '2026-09-01T17:55:00.000Z')],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, ['first-night'])
  assert.equal(progress.destination?.id, 'last-night', 'the last night is still to come')
})

test('being somewhere before its day does not count as having been there', () => {
  /* The same rule stated on its own. Walking past the restaurant on Monday is
     not dinner on Thursday. */
  const stops = [
    ON('2026-09-04', { id: 'thursday', name: 'Thursday', lng: 4.8852, lat: 52.36, seq: 0 }),
  ]
  const progress = deriveLiveStopProgress({
    stops,
    fixes: [fix(near(stops[0], 10), '2026-09-01T17:55:00.000Z')],
    now: NOW,
  })

  assert.deepEqual(progress.visitedStopIds, [])
  assert.equal(progress.destination?.id, 'thursday')
})

test('the trip knows what is next with no phone reporting at all', () => {
  /* The whole point of time being the backbone. Nobody is sharing a location —
     no phone paired, batteries dead, everybody's tracking off — and the trip
     still knows perfectly well that Tuesday is over and Wednesday is next.
     The live dot still says it is waiting, because it is; the itinerary does
     not have to wait with it. */
  const stops = [
    ON('2026-08-31', { id: 'monday', name: 'Monday', lng: 4.8852, lat: 52.36, seq: 0 }),
    ON('2026-09-01', { id: 'today', name: 'Today', lng: 4.8687, lat: 52.3579, seq: 1 }),
    ON('2026-09-02', { id: 'tomorrow', name: 'Tomorrow', lng: 2.3522, lat: 48.8566, seq: 2 }),
  ]
  const progress = deriveLiveStopProgress({ stops, fixes: [], now: NOW })

  assert.equal(progress.state, 'waiting', 'honest about the dot')
  assert.equal(progress.destination?.id, 'today', 'and useful about the trip')
})

test('a trip whose days are all behind it is over', () => {
  const stops = [
    ON('2026-08-30', { id: 'one', name: 'One', lng: 4.8852, lat: 52.36, seq: 0 }),
    ON('2026-08-31', { id: 'two', name: 'Two', lng: 4.8687, lat: 52.3579, seq: 1 }),
  ]
  const progress = deriveLiveStopProgress({
    stops,
    fixes: [fix(near(stops[0], 10), '2026-08-30T12:00:00.000Z')],
    now: NOW,
  })

  assert.equal(progress.destination, null)
  assert.equal(progress.state, 'complete')
})
