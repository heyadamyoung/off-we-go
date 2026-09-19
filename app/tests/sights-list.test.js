import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterSights,
  isSightSort,
  SIGHT_SORTS,
  sightsListView,
  sortSights,
} from '../src/sights-list-core.ts'

/* The sights as a list: a word finds them by name, kind or note; the sort
   is what it says; the ones already on the trip step aside on request. */

const place = (name, extra = {}) => ({
  id: name.toLowerCase().replace(/\W+/g, '-'),
  pageTitle: name,
  name,
  kind: '',
  note: '',
  image: null,
  source: null,
  lng: 4.9,
  lat: 52.37,
  icon: 'pin',
  metres: 500,
  readers: 100,
  skip: false,
  ...extra,
})

const sights = [
  place('Rijksmuseum', {
    kind: 'National museum',
    note: 'Dutch arts and history',
    readers: 42000,
    metres: 900,
  }),
  place('Anne Frank House', { kind: 'Biographical museum', readers: 38000, metres: 1500 }),
  place('Vondelpark', {
    kind: 'Public urban park',
    note: 'a park of 47 hectares',
    readers: 9000,
    metres: 300,
  }),
  place('Westerkerk', { kind: 'Protestant church', readers: 12000, metres: 1400 }),
  place('Café Américain', { kind: 'Café', readers: 800, metres: null }),
]

test('a word finds sights by name, kind or note, accents and case aside', () => {
  assert.deepEqual(
    filterSights(sights, 'museum').map(s => s.name),
    ['Rijksmuseum', 'Anne Frank House'],
  )
  assert.deepEqual(
    filterSights(sights, 'PARK').map(s => s.name),
    ['Vondelpark'],
  )
  assert.deepEqual(
    filterSights(sights, 'hectares').map(s => s.name),
    ['Vondelpark'],
  )
  assert.deepEqual(
    filterSights(sights, 'cafe americain').map(s => s.name),
    ['Café Américain'],
  )
  assert.deepEqual(
    filterSights(sights, 'museum dutch').map(s => s.name),
    ['Rijksmuseum'],
  )
  assert.equal(filterSights(sights, '   ').length, sights.length)
  assert.deepEqual(filterSights(sights, 'nothing here'), [])
})

test('each sort is what it says, and a sight with no distance sorts last by distance', () => {
  assert.deepEqual(
    sortSights(sights, 'popular').map(s => s.name),
    ['Rijksmuseum', 'Anne Frank House', 'Westerkerk', 'Vondelpark', 'Café Américain'],
  )
  assert.deepEqual(
    sortSights(sights, 'nearest').map(s => s.name),
    ['Vondelpark', 'Rijksmuseum', 'Westerkerk', 'Anne Frank House', 'Café Américain'],
  )
  assert.deepEqual(
    sortSights(sights, 'name').map(s => s.name),
    ['Anne Frank House', 'Café Américain', 'Rijksmuseum', 'Vondelpark', 'Westerkerk'],
  )
  assert.deepEqual(
    sortSights(sights, 'kind').map(s => s.kind),
    ['Biographical museum', 'Café', 'National museum', 'Protestant church', 'Public urban park'],
  )
  assert.equal(sortSights(sights, 'name') !== sights, true, 'never sorts in place')
})

test('the view hides what is on the trip only when asked, and counts either way', () => {
  const onTrip = s => s.name === 'Rijksmuseum'
  const shown = sightsListView(sights, { query: '', sort: 'popular', hideOnTrip: false, onTrip })
  assert.equal(shown.total, 5)
  assert.equal(shown.onTrip, 1)
  assert.equal(shown.shown.length, 5)
  const hidden = sightsListView(sights, { query: 'museum', sort: 'name', hideOnTrip: true, onTrip })
  assert.deepEqual(
    hidden.shown.map(s => s.name),
    ['Anne Frank House'],
  )
  assert.equal(hidden.total, 5)
})

test('only the four sorts are sorts', () => {
  for (const sort of SIGHT_SORTS) assert.equal(isSightSort(sort.value), true)
  assert.equal(isSightSort('random'), false)
  assert.equal(isSightSort(null), false)
})
