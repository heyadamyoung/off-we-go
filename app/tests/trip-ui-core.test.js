import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_DAYS, parseTripSearch } from '../src/trip-search-core.ts'
import { daysOf, photoItem, stopItem, tripItems } from '../src/features/trip/model/trip-items.ts'
import { DEFAULT_PREFERENCES, readPreferences, toggleChannel } from '../src/preferences-core.ts'

/* ------------------------------------------------------ the trip screen's URL */

test('an ordinary trip link carries no query string at all', () => {
  assert.deepEqual(parseTripSearch({}), {})
  assert.deepEqual(parseTripSearch({ view: 'map' }), {}, 'the map is the default, not a parameter')
})

test('an unknown view falls back to the map rather than rendering nothing', () => {
  assert.deepEqual(parseTripSearch({ view: 'nonsense' }), {})
  assert.deepEqual(parseTripSearch({ view: 'photos' }), { view: 'photos' })
})

test('the settings sheet always opens on a real tab', () => {
  assert.deepEqual(parseTripSearch({ sheet: 'settings' }), { sheet: 'settings', tab: 'trip' })
  assert.deepEqual(parseTripSearch({ sheet: 'settings', tab: 'phones' }), {
    sheet: 'settings',
    tab: 'phones',
  })
  assert.deepEqual(parseTripSearch({ sheet: 'settings', tab: 'nope' }), {
    sheet: 'settings',
    tab: 'trip',
  })
})

test('a tab without its sheet is dropped, so a stale link does not open a blank dialog', () => {
  assert.deepEqual(parseTripSearch({ tab: 'people' }), {})
})

test('free text out of the URL is trimmed, capped and never left empty', () => {
  assert.deepEqual(parseTripSearch({ q: '  canal  ' }), { q: 'canal' })
  assert.deepEqual(parseTripSearch({ q: '   ' }), {})
  assert.equal(parseTripSearch({ q: 'x'.repeat(500) }).q.length, 120)
  assert.deepEqual(parseTripSearch({ sel: 42 }), {}, 'a non-string id is not an id')
})

/* --------------------------------------------------------- what a day contains */

const STOPS = [
  {
    id: 's1',
    name: 'Rijksmuseum',
    day: 'Sat 5 Sep',
    time: '09:30',
    status: 'done',
    note: 'The Night Watch',
  },
  { id: 's2', name: 'Foodhallen', day: 'Sat 5 Sep', time: '13:00', status: 'now' },
  { id: 's3', name: 'Anne Frank House', day: 'Sun 6 Sep', time: '15:45', status: 'planned' },
]
const PHOTOS = [
  { id: 'p1', stopId: 's1', by: 'Maya', when: '10:42', caption: 'In front of The Night Watch' },
  { id: 'p2', stopId: 's3', by: 'Alex', when: '16:10', caption: 'The bookcase' },
]

test('a day shows its own stops and the photographs taken at them, in order', () => {
  const items = tripItems({ stops: STOPS, photos: PHOTOS, day: 'Sat 5 Sep' })
  assert.deepEqual(
    items.map(item => item.id),
    ['s1', 'p1', 's2'],
  )
  assert.equal(items[1].kind, 'photo')
})

test('a stop comes before the photographs taken at it, even at the same time', () => {
  const together = tripItems({
    stops: [{ id: 's', name: 'Stop', day: 'Mon', time: '10:00' }],
    photos: [{ id: 'p', stopId: 's', by: 'A', when: '10:00' }],
    day: 'Mon',
  })
  assert.deepEqual(
    together.map(item => item.kind),
    ['stop', 'photo'],
  )
})

test('all days shows the whole trip in day then time order', () => {
  const items = tripItems({ stops: STOPS, photos: PHOTOS, day: ALL_DAYS })
  assert.deepEqual(
    items.map(item => item.id),
    ['s1', 'p1', 's2', 's3', 'p2'],
  )
})

test('a search looks across the whole trip, not only the chosen day', () => {
  const found = tripItems({ stops: STOPS, photos: PHOTOS, day: 'Sat 5 Sep', query: 'anne' })
  assert.deepEqual(
    found.map(item => item.id),
    ['s3'],
  )
})

test('a search matches a caption and a stop note as well as a name', () => {
  const byCaption = tripItems({ stops: STOPS, photos: PHOTOS, day: ALL_DAYS, query: 'bookcase' })
  assert.deepEqual(
    byCaption.map(item => item.id),
    ['p2'],
  )
  const byNote = tripItems({ stops: STOPS, photos: PHOTOS, day: ALL_DAYS, query: 'night watch' })
  assert.deepEqual(byNote.map(item => item.id).sort(), ['p1', 's1'])
})

test('the strip can leave photographs out without losing the stops', () => {
  const items = tripItems({ stops: STOPS, photos: PHOTOS, day: ALL_DAYS, withPhotos: false })
  assert.equal(
    items.every(item => item.kind === 'stop'),
    true,
  )
  assert.equal(items.length, 3)
})

test('a stop with no time still says something rather than showing an empty line', () => {
  assert.equal(stopItem({ id: 's', name: 'Somewhere' }).meta, 'No time set')
  // Never "Untitled": fall back to the stop's kind, then to a plain word.
  assert.equal(stopItem({ id: 's', name: '', kind: 'Stay' }).title, 'Stay')
  assert.equal(stopItem({ id: 's', name: '' }).title, 'Stop')
})

test('a photograph with no caption is titled by its time and place', () => {
  const item = photoItem({ id: 'p', stopId: 's1', when: 'Sat 10:41' }, STOPS[0])
  assert.equal(item.title, `Sat 10:41 · ${STOPS[0].name}`)
})

test('a photograph borrows the day of the stop it was taken at', () => {
  const item = photoItem({ id: 'p', stopId: 's1', by: 'Maya', when: '10:42' }, STOPS[0])
  assert.equal(item.day, 'Sat 5 Sep')
  assert.equal(item.meta, '10:42 · Maya')
})

test('the day list is every day that has a stop, in order, without blanks', () => {
  assert.deepEqual(daysOf([...STOPS, { id: 's4', name: 'Loose', day: '' }]), [
    'Sat 5 Sep',
    'Sun 6 Sep',
  ])
})

/* ------------------------------------------------------------- preferences */

test('an account that has never opened settings gets the documented defaults', () => {
  assert.deepEqual(readPreferences(undefined), DEFAULT_PREFERENCES)
  assert.deepEqual(readPreferences(null), DEFAULT_PREFERENCES)
  assert.deepEqual(readPreferences('nonsense'), DEFAULT_PREFERENCES)
})

test('a preference added after somebody saved their settings still reads as its default', () => {
  const old = { notify: { photos: { on: false, channels: ['email'] } } }
  const read = readPreferences(old)
  assert.deepEqual(read.notify.photos, { on: false, channels: ['email'] })
  assert.deepEqual(
    read.notify.digest,
    DEFAULT_PREFERENCES.notify.digest,
    'the one that did not exist yet is not silently off',
  )
  assert.equal(read.privacy.discoverable, DEFAULT_PREFERENCES.privacy.discoverable)
})

test('a channel a notification does not offer is discarded rather than stored', () => {
  const read = readPreferences({
    notify: { arrivals: { on: true, channels: ['email', 'pigeon'] } },
  })
  assert.deepEqual(
    read.notify.arrivals.channels,
    ['push'],
    'arrivals are push only, so an unusable list falls back to the default',
  )
})

test('an unknown discoverability setting does not widen who can find you', () => {
  assert.equal(
    readPreferences({ privacy: { discoverable: 'everyone' } }).privacy.discoverable,
    'shared',
  )
})

test('turning off the last channel turns the notification off rather than silencing it', () => {
  const both = { on: true, channels: ['push', 'email'] }
  assert.deepEqual(toggleChannel(both, 'email'), { on: true, channels: ['push'] })
  const onlyPush = { on: true, channels: ['push'] }
  assert.deepEqual(toggleChannel(onlyPush, 'push'), { on: false, channels: ['push'] })
})

test('a channel is added back when it is switched on again', () => {
  assert.deepEqual(toggleChannel({ on: true, channels: ['push'] }, 'email'), {
    on: true,
    channels: ['push', 'email'],
  })
})
