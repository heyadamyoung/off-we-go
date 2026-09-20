import assert from 'node:assert/strict'
import test from 'node:test'
import { applyMigration, MIGRATION_RETRY_MS, MIGRATION_BUDGET_MS } from '../src/postgres.js'

/* Applying a migration to a table something else is writing to.
 *
 * This is the failure that took production down and then hid the evidence.
 * `alter table places add column label_zoom real` is microseconds of work but
 * needs ACCESS EXCLUSIVE, and the sweep container writes to `places` without
 * pause. With no lock_timeout the ALTER joined the lock queue and stayed
 * there; migrations run before the API listens, so it never listened; twelve
 * health probes failed over two minutes; the deploy decided the release was
 * bad and rolled it back. The release was fine.
 *
 * A fake client, because what is being proved is the protocol — what is sent,
 * in what order, and what happens when Postgres says no — and a real database
 * cannot be made to refuse a lock on demand without a second connection
 * holding one, which tests the fixture more than the code. */

/** A client that refuses the lock `refusals` times, then gives way. */
function clientRefusing(refusals, code = '55P03') {
  const sent = []
  let refused = 0
  return {
    sent,
    async query(sql, params) {
      sent.push(typeof sql === 'string' ? sql.trim() : sql)
      if (typeof sql === 'string' && sql.startsWith('alter table') && refused < refusals) {
        refused += 1
        const error = new Error('canceling statement due to lock timeout')
        error.code = code
        throw error
      }
      return { rows: [], rowCount: 0 }
    },
  }
}

const ALTER = 'alter table places add column if not exists label_zoom real'

/** No real waiting, and a clock we move ourselves. */
function patiently(overrides = {}) {
  const slept = []
  let clock = 0
  return {
    slept,
    options: {
      log: () => {},
      sleep: async ms => {
        slept.push(ms)
        clock += ms
      },
      now: () => clock,
      ...overrides,
    },
  }
}

test('a migration asks for its lock rather than waiting in the queue', async () => {
  const client = clientRefusing(0)
  const { options } = patiently()
  await applyMigration(client, '046_x.sql', ALTER, 'abc', options)

  /* The lock timeout is set inside the transaction, before the statement, and
     it is `local` — the pool hands this connection on afterwards and the next
     thing to use it must not inherit a three-second patience. */
  assert.equal(client.sent[0], 'begin')
  assert.match(client.sent[1], /^set local lock_timeout = '\d+s'$/)
  assert.equal(client.sent[2], ALTER)
  assert.match(client.sent[3], /^insert into schema_migrations/)
  assert.equal(client.sent[4], 'commit')
})

test('a refused lock is rolled back and asked for again', async () => {
  const client = clientRefusing(3)
  const { options, slept } = patiently()
  const outcome = await applyMigration(client, '046_x.sql', ALTER, 'abc', options)

  assert.equal(outcome.attempts, 4, 'three refusals, then it got in')
  assert.deepEqual(slept, MIGRATION_RETRY_MS.slice(0, 3), 'backing off further each time')
  assert.equal(client.sent.filter(s => s === 'rollback').length, 3)
  assert.equal(client.sent.filter(s => s === 'commit').length, 1)
  assert.equal(
    client.sent.filter(s => s.startsWith('insert into schema_migrations')).length,
    1,
    'written down once, and only once it actually applied',
  )
})

test('a deadlock is the same kind of no', async () => {
  const client = clientRefusing(1, '40P01')
  const { options } = patiently()
  const outcome = await applyMigration(client, '046_x.sql', ALTER, 'abc', options)
  assert.equal(outcome.attempts, 2)
})

/* The fallback, and the reason any of this exists: it never gives up quietly
   and it never moves on. Being slow is recoverable. Being skipped is not. */
test('a lock it can never get stops the run rather than skipping the migration', async () => {
  const client = clientRefusing(Number.POSITIVE_INFINITY)
  const { options } = patiently()
  await assert.rejects(
    () => applyMigration(client, '046_x.sql', ALTER, 'abc', { ...options, budgetMs: 60_000 }),
    /046_x\.sql could not get its lock/,
  )
  assert.equal(
    client.sent.filter(s => s.startsWith('insert into schema_migrations')).length,
    0,
    'never written down as applied',
  )
  assert.equal(client.sent.filter(s => s === 'commit').length, 0)
})

test('the budget is long enough to outlast a busy table, not a broken one', () => {
  assert.ok(MIGRATION_BUDGET_MS >= 10 * 60_000, 'minutes, so a busy sweep is ridden out')
  assert.ok(MIGRATION_BUDGET_MS <= 60 * 60_000, 'but a stuck deploy is still noticed today')
})

/* An error that is not about locks is a real error and must not be retried:
   a typo in a migration retried for thirty minutes is a deploy that hangs
   instead of one that fails in a second with the reason on screen. */
test('an error that is not about a lock fails at once', async () => {
  const client = {
    sent: [],
    async query(sql) {
      client.sent.push(sql.trim())
      if (sql.startsWith('alter table')) {
        const error = new Error('column "labl_zoom" does not exist')
        error.code = '42703'
        throw error
      }
      return { rows: [] }
    },
  }
  const { options, slept } = patiently()
  await assert.rejects(
    () => applyMigration(client, '046_x.sql', ALTER, 'abc', options),
    /labl_zoom/,
  )
  assert.deepEqual(slept, [], 'not retried')
  assert.equal(client.sent.filter(s => s === 'rollback').length, 1)
})
