import assert from 'node:assert/strict'
import test from 'node:test'
import { deal, locationsOf } from '../scripts/shard-tests.mjs'

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
