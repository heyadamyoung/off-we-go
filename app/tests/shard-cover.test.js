import assert from 'node:assert/strict'
import test from 'node:test'
import { covered, judge, marker, shardOf } from '../scripts/shard-cover.mjs'

/* The punctual shards cover for the one whose runner is late, and nothing
   here can lose a test: a late shard skips its own deal only when every
   other shard has left a marker saying it ran a share of it. */

const origin = '2026-09-18T14:45:28Z'
const job = (name, status, startedAt) => ({
  name,
  status,
  created_at: origin,
  started_at: startedAt,
})

test('a shard is late when it has not started, or started long after the run began', () => {
  const jobs = [
    job(
      'Lint, unit tests, the entrypoint and the release images',
      'in_progress',
      '2026-09-18T14:45:31Z',
    ),
    job('Browser tests (1 of 4)', 'in_progress', '2026-09-18T14:45:31Z'),
    job('Browser tests (2 of 4)', 'in_progress', '2026-09-18T14:45:33Z'),
    // Queued, and carrying the time it was queued as if it had started.
    job('Browser tests (3 of 4)', 'queued', origin),
    job('Browser tests (4 of 4)', 'in_progress', '2026-09-18T14:46:06Z'),
  ]
  assert.deepEqual(judge({ jobs, me: 1 }), { mine: 'punctual', late: [3, 4] })
  assert.deepEqual(judge({ jobs, me: 4 }), { mine: 'late', late: [3] })
  // A shard that is not in the list at all is late, and covers nobody.
  assert.deepEqual(judge({ jobs, me: 9 }), { mine: 'late', late: [3, 4] })
})

test('the run begins when its first job was created, not when the run was queued', () => {
  // Queued behind another run for a minute: every job is created late and
  // starts within seconds of that, so nobody is late.
  const jobs = [
    {
      name: 'Browser tests (1 of 2)',
      status: 'in_progress',
      created_at: '2026-09-18T14:09:33Z',
      started_at: '2026-09-18T14:09:36Z',
    },
    {
      name: 'Browser tests (2 of 2)',
      status: 'in_progress',
      created_at: '2026-09-18T14:09:33Z',
      started_at: '2026-09-18T14:09:38Z',
    },
  ]
  assert.deepEqual(judge({ jobs, me: 1 }), { mine: 'punctual', late: [] })
})

test('only a browser shard is a shard', () => {
  assert.equal(shardOf('Browser tests (3 of 7)'), 3)
  assert.equal(shardOf('Browser tests against a real server (uploads)'), null)
  assert.equal(shardOf('Server tests'), null)
  assert.equal(shardOf(undefined), null)
})

test('a late shard is covered only when every other shard says it ran a share', () => {
  const artifacts = names => names.map(name => ({ name }))
  assert.equal(marker([5], 3), 'cover-5-by-3')
  assert.equal(marker([2, 5], 3), 'cover-2-5-by-3')
  const all = artifacts([
    'cover-5-by-1',
    'cover-5-by-2',
    'cover-2-5-by-3',
    'cover-5-by-4',
    'browser-test-results-2',
  ])
  assert.equal(covered({ me: 5, count: 5, artifacts: all }), true)
  // Shard 2 was named by shard 3 alone.
  assert.equal(covered({ me: 2, count: 5, artifacts: all }), false)
  // One marker short: a sibling asked too late to see 5 as late.
  assert.equal(covered({ me: 5, count: 5, artifacts: all.slice(1) }), false)
  assert.equal(covered({ me: 5, count: 5, artifacts: [] }), false)
})
