import assert from 'node:assert/strict'
import test from 'node:test'
import { noticesSince, seenNow } from '../src/trip-notices-core.ts'

/* What has happened since somebody last looked.
 *
 * A trip app where the interesting moment happens and nobody is told is a trip
 * app people open twice. Family had to remember to check, and the map — which
 * is the whole reason they came — never said anything had changed.
 *
 * This is a difference, not a clock. Arrivals carry no timestamp anywhere in
 * the app: a stop is behind you because a phone stood at it or because its
 * hour went past, and neither of those records a moment. Timing an arrival at
 * the stop's own scheduled hour would be reporting the plan as if it were the
 * event, and would say the wrong thing about anybody early. So what is new is
 * what was not in the snapshot taken the last time this person looked, which
 * cannot be wrong about anything.
 */

const stop = (id, name, day) => ({ id, name, day })
const DAY = '2026-05-14'

const STOPS = [
  stop('a', 'Harbour breakfast', DAY),
  stop('b', 'Cliff walk', DAY),
  stop('c', 'Lighthouse', DAY),
]

const shot = (id, stopId, when) => ({ id, stopId, when })

test('the first time anybody looks, nothing has been missed', () => {
  /* Otherwise every follower's first open announces the entire trip as news,
     which is the opposite of the point. */
  const notices = noticesSince(
    { stops: STOPS, photos: [shot('p1', 'a', '2026-05-14T09:00:00Z')], doneStopIds: ['a'] },
    null,
  )
  assert.deepEqual(notices, [])
})

test('a stop that has gone behind them since is an arrival', () => {
  const seen = { done: ['a'], photosTo: 0 }
  const notices = noticesSince({ stops: STOPS, photos: [], doneStopIds: ['a', 'b'] }, seen)
  assert.equal(notices.length, 1)
  assert.equal(notices[0].kind, 'arrived')
  assert.equal(notices[0].stopId, 'b')
  assert.match(notices[0].title, /Cliff walk/)
})

test('arrivals come in the order the day ran, not the order they were noticed', () => {
  const notices = noticesSince(
    { stops: STOPS, photos: [], doneStopIds: ['c', 'a', 'b'] },
    { done: [], photosTo: 0 },
  )
  assert.deepEqual(
    notices.filter(n => n.kind === 'arrived').map(n => n.stopId),
    ['a', 'b', 'c'],
  )
})

test('a stop already seen as done is not announced again', () => {
  const notices = noticesSince(
    { stops: STOPS, photos: [], doneStopIds: ['a', 'b'] },
    { done: ['a', 'b'], photosTo: 0 },
  )
  assert.deepEqual(notices, [])
})

test('new photographs are one notice a place, counted, not one notice each', () => {
  /* Fourteen pictures from one afternoon is one thing that happened. Fourteen
     notifications is a reason to turn notifications off. */
  const photos = [
    shot('p1', 'b', '2026-05-14T10:00:00Z'),
    shot('p2', 'b', '2026-05-14T10:05:00Z'),
    shot('p3', 'c', '2026-05-14T13:30:00Z'),
  ]
  const notices = noticesSince(
    { stops: STOPS, photos, doneStopIds: [] },
    { done: [], photosTo: Date.parse('2026-05-14T09:00:00Z') },
  )
  const pictures = notices.filter(n => n.kind === 'photos')
  assert.equal(pictures.length, 2)
  assert.deepEqual(
    pictures.map(n => [n.stopId, n.count]),
    [
      ['b', 2],
      ['c', 1],
    ],
  )
  assert.match(pictures[0].title, /2 new photographs/)
  assert.match(pictures[1].title, /^1 new photograph at/, 'one of them is not plural')
})

test('a notice carries the newest picture in it, to open the gallery at', () => {
  const photos = [shot('p1', 'b', '2026-05-14T10:00:00Z'), shot('p2', 'b', '2026-05-14T10:05:00Z')]
  const notices = noticesSince({ stops: STOPS, photos }, { done: [], photosTo: 0 })
  assert.equal(notices[0].photoId, 'p2')
})

test('photographs from nowhere in particular are still news', () => {
  /* A picture with no stop is a picture somebody took between places, and it
     has no pin — so the notice has nowhere to send the map, and says so by
     carrying no stop rather than by being dropped. */
  const notices = noticesSince(
    { stops: STOPS, photos: [shot('p1', null, '2026-05-14T10:00:00Z')] },
    { done: [], photosTo: 0 },
  )
  assert.equal(notices.length, 1)
  assert.equal(notices[0].stopId, undefined)
  assert.equal(notices[0].photoId, 'p1')
})

test('a photograph already seen is not news, however it is filed', () => {
  const photos = [shot('p1', 'b', '2026-05-14T10:00:00Z')]
  const notices = noticesSince(
    { stops: STOPS, photos },
    { done: [], photosTo: Date.parse('2026-05-14T10:00:00Z') },
  )
  assert.deepEqual(notices, [])
})

test('a picture with no time of its own is never news twice', () => {
  /* It cannot be compared against a watermark, so it has to count as seen —
     announcing it on every open would be worse than missing it once. */
  const notices = noticesSince(
    { stops: STOPS, photos: [shot('p1', 'b', null)] },
    { done: [], photosTo: 0 },
  )
  assert.deepEqual(notices, [])
})

test('the snapshot to compare against next time is the one taken now', () => {
  const photos = [shot('p1', 'b', '2026-05-14T10:00:00Z'), shot('p2', 'c', '2026-05-14T13:30:00Z')]
  const mark = seenNow({ photos, doneStopIds: ['a', 'b'] })
  assert.deepEqual(mark.done, ['a', 'b'])
  assert.equal(mark.photosTo, Date.parse('2026-05-14T13:30:00Z'))

  // And nothing is news against it.
  assert.deepEqual(noticesSince({ stops: STOPS, photos, doneStopIds: ['a', 'b'] }, mark), [])
})

test('an empty trip has an empty snapshot rather than a broken one', () => {
  const mark = seenNow({})
  assert.deepEqual(mark, { done: [], photosTo: 0, landed: [] })
  assert.deepEqual(noticesSince({}, mark), [])
})

test('arrivals come before pictures, because a place is the bigger news', () => {
  const notices = noticesSince(
    {
      stops: STOPS,
      photos: [shot('p1', 'b', '2026-05-14T10:00:00Z')],
      doneStopIds: ['b'],
    },
    { done: [], photosTo: 0 },
  )
  assert.deepEqual(
    notices.map(n => n.kind),
    ['arrived', 'photos'],
  )
})

test('arriving somewhere is not news to the person who arrived', () => {
  /* Telling somebody they reached a place they are standing in is the app
     reporting their own life back to them, and one line of that is enough to
     stop anybody reading the rest. */
  const photos = [shot('p1', 'b', '2026-05-14T10:00:00Z')]
  const seen = { done: [], photosTo: 0 }
  const forThem = noticesSince({ stops: STOPS, photos, doneStopIds: ['b'] }, seen, {
    arrivals: false,
  })
  assert.deepEqual(
    forThem.map(n => n.kind),
    ['photos'],
    'the pictures are still news — they were driving while somebody else shot them',
  )

  const forEveryoneElse = noticesSince({ stops: STOPS, photos, doneStopIds: ['b'] }, seen)
  assert.deepEqual(
    forEveryoneElse.map(n => n.kind),
    ['arrived', 'photos'],
  )
})

/* And that they landed.
 *
 * The only question a family at home actually asks on a travel day. It rides
 * the same machinery as an arrival — a difference against what this device
 * last saw, never a clock — and it is news to exactly the same people: not to
 * whoever was on the plane.
 */

const flightTo = (id, toName) => ({ id, toName, fromName: 'Amsterdam' })

test('a journey that has ended since the last look is news', () => {
  const said = noticesSince(
    { segments: [flightTo('g1', 'Calgary')], landedSegmentIds: ['g1'] },
    { done: [], photosTo: 0, landed: [] },
  )
  assert.deepEqual(
    said.map(notice => notice.title),
    ['Landed at Calgary'],
  )
  assert.equal(said[0].kind, 'landed')
  assert.equal(said[0].segmentId, 'g1')
})

test('a landing already seen is not news twice', () => {
  const said = noticesSince(
    { segments: [flightTo('g1', 'Calgary')], landedSegmentIds: ['g1'] },
    { done: [], photosTo: 0, landed: ['g1'] },
  )
  assert.deepEqual(said, [])
})

test('landing is not news to the person who was on the plane', () => {
  const said = noticesSince(
    { segments: [flightTo('g1', 'Calgary')], landedSegmentIds: ['g1'] },
    { done: [], photosTo: 0, landed: [] },
    { arrivals: false },
  )
  assert.deepEqual(said, [])
})

test('a mark written before landings were counted announces none of them', () => {
  /* Otherwise the update itself becomes the news: every follower opens the app
     once and is told about every flight of the whole trip. A snapshot with no
     record of landings makes no claim about them. */
  const said = noticesSince(
    { segments: [flightTo('g1', 'Calgary')], landedSegmentIds: ['g1'] },
    { done: [], photosTo: 0 },
  )
  assert.deepEqual(said, [])
})

test('the landing leads, because it is the bigger thing that happened', () => {
  const said = noticesSince(
    {
      segments: [flightTo('g1', 'Calgary')],
      landedSegmentIds: ['g1'],
      stops: [{ id: 's1', name: 'Lighthouse' }],
      doneStopIds: ['s1'],
      photos: [{ id: 'p1', stopId: 's1', when: '2026-09-19T21:00:00Z' }],
    },
    { done: [], photosTo: 0, landed: [] },
  )
  assert.deepEqual(
    said.map(notice => notice.kind),
    ['landed', 'arrived', 'photos'],
  )
})

test('the snapshot records which journeys have ended', () => {
  const mark = seenNow({ segments: [flightTo('g1', 'Calgary')], landedSegmentIds: ['g1'] })
  assert.deepEqual(mark.landed, ['g1'])
})
