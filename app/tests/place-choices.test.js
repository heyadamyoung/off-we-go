import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allPinned,
  canDecideByLocation,
  middleOf,
  placeChoices,
  roughly,
} from '../src/place-choices-core.ts'

/* Amsterdam again, because the distances between these are real ones. */
const stops = [
  { id: 'rijks', name: 'Rijksmuseum', lng: 4.8852, lat: 52.36, day: '2026-09-11', seq: 0 },
  { id: 'vangogh', name: 'Van Gogh Museum', lng: 4.8811, lat: 52.3584, day: '2026-09-11', seq: 1 },
  { id: 'centraal', name: 'Centraal', lng: 4.9003, lat: 52.379, day: '2026-09-12', seq: 2 },
]
const photo = (id, fields = {}) => ({ id, by: 'Wren', ...fields })

test("every stop is offered, in the trip's own order", () => {
  /* Not nearest first. The trip is the order somebody remembers it in, and
     the best guess by distance is exactly what was wrong in the case this
     screen exists to fix. */
  const choices = placeChoices(stops, [])
  assert.deepEqual(
    choices.map(choice => choice.stop.id),
    ['rijks', 'vangogh', 'centraal'],
  )
})

test('a row says how much is already there and shows one of it', () => {
  const photos = [
    photo('1', { stopId: 'rijks' }),
    photo('2', { stopId: 'rijks' }),
    photo('3', { stopId: 'centraal' }),
  ]
  const by = new Map(placeChoices(stops, photos).map(choice => [choice.stop.id, choice]))
  assert.equal(by.get('rijks').count, 2)
  assert.equal(by.get('rijks').thumb.id, '1')
  assert.equal(by.get('vangogh').count, 0)
  assert.equal(by.get('vangogh').thumb, null, 'nothing there yet, and it says so')
})

test('a still is preferred to a film as the face of a place', () => {
  /* A video\'s poster is whatever frame it starts on, and half of those are
     a blur of somebody\'s shoe. */
  const photos = [
    photo('film', { stopId: 'rijks', kind: 'video' }),
    photo('still', { stopId: 'rijks', kind: 'photo' }),
  ]
  assert.equal(placeChoices(stops, photos)[0].thumb.id, 'still')
})

test('distance is measured from the middle of what is being moved', () => {
  const moving = [photo('a', { lng: 4.8852, lat: 52.36 })]
  const by = new Map(placeChoices(stops, [], moving).map(c => [c.stop.id, c]))
  assert.ok(by.get('rijks').metres < 5, 'taken at the Rijksmuseum')
  assert.ok(by.get('vangogh').metres > 250 && by.get('vangogh').metres < 400)
  assert.ok(by.get('centraal').metres > 2000)
})

test('with nothing to measure from, nothing is claimed', () => {
  /* The whole reason this feature exists: pictures that arrived with no
     coordinates. A row that guessed a distance would be inventing one. */
  const moving = [photo('a'), photo('b', { lng: null, lat: null })]
  assert.equal(middleOf(moving), null)
  assert.ok(placeChoices(stops, [], moving).every(choice => choice.metres === null))
  assert.equal(canDecideByLocation(moving), false, 'handing these back would do nothing')
})

test('the middle of several is between them, and ignores the ones that do not know', () => {
  const middle = middleOf([
    photo('a', { lng: 4, lat: 52 }),
    photo('b', { lng: 6, lat: 54 }),
    photo('c'),
  ])
  assert.deepEqual(middle, [5, 53])
})

test('a coordinate that could not be one is not one', () => {
  assert.equal(middleOf([photo('a', { lng: 999, lat: 52 })]), null)
  assert.equal(middleOf([photo('a', { lng: Number.NaN, lat: 52 })]), null)
  assert.equal(canDecideByLocation([photo('a', { lng: 4, lat: 52 })]), true)
})

test('a row knows when everything being moved is already on it', () => {
  const moving = [photo('a', { stopId: 'rijks' }), photo('b', { stopId: 'rijks' })]
  const by = new Map(placeChoices(stops, [], moving).map(c => [c.stop.id, c]))
  assert.equal(by.get('rijks').current, true)
  assert.equal(by.get('vangogh').current, false)
  // A selection spanning two places is not "already" at either of them.
  const spread = [photo('a', { stopId: 'rijks' }), photo('b', { stopId: 'centraal' })]
  assert.ok(placeChoices(stops, [], spread).every(choice => !choice.current))
})

test('searching finds a stop by any of the words on its row', () => {
  assert.deepEqual(
    placeChoices(stops, [], [], 'rijks').map(c => c.stop.id),
    ['rijks'],
  )
  assert.deepEqual(
    placeChoices(stops, [], [], 'MUSEUM').map(c => c.stop.id),
    ['rijks', 'vangogh'],
    'case is never what somebody meant',
  )
  assert.deepEqual(
    placeChoices(stops, [], [], '2026-09-12').map(c => c.stop.id),
    ['centraal'],
  )
  assert.equal(placeChoices(stops, [], [], '   ').length, 3, 'whitespace is not a search')
  assert.equal(placeChoices(stops, [], [], 'lisbon').length, 0)
})

test('distances are read the way somebody would say them', () => {
  assert.equal(roughly(null), '')
  assert.equal(roughly(12), 'here', 'nobody says "twelve metres"')
  assert.equal(roughly(230), '250 m')
  assert.equal(roughly(1400), '1.4 km')
  assert.equal(roughly(48_000), '48 km')
})

test('a selection filed entirely by hand knows it', () => {
  assert.equal(allPinned([photo('a', { stopPinned: true })]), true)
  assert.equal(allPinned([photo('a', { stopPinned: true }), photo('b')]), false)
  assert.equal(allPinned([]), false, 'nothing is not everything')
})
