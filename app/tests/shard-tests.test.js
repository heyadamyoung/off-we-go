import assert from 'node:assert/strict'
import test from 'node:test'
import { cover, deal, locationsOf, WEIGHTS, weightOf } from '../scripts/shard-tests.mjs'

/* The deal that balances the browser shards: every location to exactly one
   shard, in turn, so the heavy tests at the end of the list are spread rather
   than stacked on the last runner. */

test('every location is dealt to exactly one shard, in turn', () => {
  const locations = ['a:1', 'a:2', 'b:1', 'c:1', 'c:2', 'c:3', 'c:4']
  const shards = [1, 2, 3].map(index => deal(locations, 3, index))
  assert.deepEqual(shards, [
    ['a:1', 'c:1', 'c:4'],
    ['a:2', 'c:2'],
    ['b:1', 'c:3'],
  ])
  assert.deepEqual(shards.flat().sort(), [...locations].sort())
})

test('a weighed deal gives the heaviest first to whoever has the least, and evens out', () => {
  const seconds = { 'slow.spec.js:1': 9, 'slow.spec.js:2': 8, 'quick.spec.js:1': 1 }
  const weigh = location => seconds[location] ?? 2
  const locations = [
    'quick.spec.js:1',
    'mid.spec.js:1',
    'slow.spec.js:1',
    'mid.spec.js:2',
    'slow.spec.js:2',
  ]
  const shards = [1, 2].map(index => deal(locations, 2, index, weigh))
  // 9 + 2 against 8 + 2 + 1: as even as these get.
  assert.deepEqual(shards, [
    ['slow.spec.js:1', 'mid.spec.js:2'],
    ['slow.spec.js:2', 'mid.spec.js:1', 'quick.spec.js:1'],
  ])
  assert.deepEqual(shards.flat().sort(), [...locations].sort())
})

test('the weights are by file, and a file not named is an ordinary one', () => {
  assert.equal(weightOf('tests/navigation.spec.js:63'), WEIGHTS['navigation.spec.js'])
  assert.equal(weightOf('tests/trip.spec.js:1766'), WEIGHTS['trip.spec.js'])
  assert.equal(weightOf('tests/brand-new.spec.js:5'), 3)
  for (const weight of Object.values(WEIGHTS)) assert.ok(weight > 0 && weight < 10)
})

test('the punctual shards cover a late one between them, in fixed shares by index', () => {
  const locations = ['a:1', 'a:2', 'b:1', 'c:1', 'c:2', 'c:3', 'c:4', 'd:1', 'd:2']
  // Shard 2 of 3 is late: its deal is a:2, c:2, d:1.
  const one = cover(locations, 3, 1, [2])
  const three = cover(locations, 3, 3, [2])
  assert.deepEqual(one, ['a:1', 'c:1', 'c:4', 'a:2', 'd:1'])
  assert.deepEqual(three, ['b:1', 'c:3', 'd:2', 'c:2'])
  // Between them, every test the late shard held; and a shard covers
  // nobody when nobody is late, itself least of all.
  assert.deepEqual([...one, ...three].sort(), [...locations].sort())
  assert.deepEqual(cover(locations, 3, 2, []), deal(locations, 3, 2))
  assert.deepEqual(cover(locations, 3, 2, [2]), deal(locations, 3, 2))
})

test('a shard that does not exist is refused rather than dealt nothing', () => {
  assert.throws(() => deal(['a:1'], 2, 3), /no shard 3 of 2/)
  assert.throws(() => deal(['a:1'], 2, 0), /no shard 0 of 2/)
})

test('locations come from the listing once each, relative to the working directory', () => {
  const listing = {
    config: { rootDir: '/repo/app/tests' },
    suites: [
      {
        file: 'trip.spec.js',
        specs: [{ file: 'trip.spec.js', line: 10 }],
        suites: [
          {
            specs: [
              // Two tests declared by one loop share a line and stay together.
              { file: 'trip.spec.js', line: 40 },
              { file: 'trip.spec.js', line: 40 },
            ],
          },
        ],
      },
      { file: 'zoom.spec.js', specs: [{ file: '/repo/app/tests/zoom.spec.js', line: 3 }] },
    ],
  }
  assert.deepEqual(locationsOf(listing, '/repo/app'), [
    'tests/trip.spec.js:10',
    'tests/trip.spec.js:40',
    'tests/zoom.spec.js:3',
  ])
})
