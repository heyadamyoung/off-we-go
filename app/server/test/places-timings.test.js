import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import pg from 'pg'
import { STANDING, centreOf } from '../src/places/viewpoints.js'
import { freshDatabase as makeDatabase } from './private-database.js'

/* The script the deploy census runs against production.
 *
 * As a real child process against a real migrated database, because that is
 * the only thing that catches what actually goes wrong with a script: a
 * script is an entrypoint, nothing imports it, so a renamed export or a
 * dropped column is invisible to every other test in this suite and shows up
 * for the first time when the container runs the command.
 *
 * That is not hypothetical. On 21 September `places-ingest.mjs` imported a
 * constant that had been deleted, died at module load in 150 milliseconds,
 * and `restart: on-failure` put it back every minute for eight and a half
 * hours while the planet sat at a quarter loaded and every test passed.
 *
 * So: spawn it, and read what it prints.
 */

const baseUrl =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/wayfare_test'
const unreachable = await (async () => {
  const client = new pg.Client({ connectionString: baseUrl })
  try {
    await client.connect()
    await client.end()
  } catch {
    return 'no PostgreSQL to test against'
  }
  return false
})()

const { createPostgresRepository } = await import('../src/postgres.js')
const migrate = async url => {
  const repository = await createPostgresRepository({
    databaseUrl: url,
    adminEmail: 'owner@example.com',
  })
  await repository.migrate()
  await repository.close()
}
const freshDatabase = t => makeDatabase(baseUrl, 'placestimings', t, migrate)

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'places-timings.mjs',
)
const run = promisify(execFile)

test('the timings script runs against the schema it will meet', { skip: unreachable }, async t => {
  const pool = await freshDatabase(t)
  const databaseUrl = pool.options.connectionString ?? String(pool.options)

  /* One real place under each standing viewport, so every probe has something
     to find and a query that silently matches nothing cannot pass for one
     that works. */
  for (const view of STANDING) {
    const { lng, lat } = centreOf(view)
    await pool.query(
      `insert into places (gers_id, name, geom, category, category_raw, confidence, cell, label_zoom)
       values ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, 'museum', 'museum', 0.9,
               $5, 11)`,
      [`overture:${view.name.toLowerCase()}`, `${view.name} Museum`, lng, lat, 'N00E000'],
    )
  }

  const { stdout, stderr } = await run(process.execPath, [script], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PLACES_TIMINGS_BUDGET_MS: '60000' },
    timeout: 120_000,
  })
  const out = `${stdout}${stderr}`

  /* Every standing viewport reported. A script that exits after the first is
     a script that measured Amsterdam and called it the planet. */
  for (const view of STANDING) {
    assert.match(out, new RegExp(`timings: ${view.name}\\b`), `${view.name} unmeasured:\n${out}`)
  }
  /* Every probe answered. This is the assertion with teeth: each of these is
     a different statement against a different index, and a column renamed
     under any one of them prints its error here instead of a number. */
  for (const probe of ['search "muse"', 'search "ri"', 'nearby', 'in-view z', 'tile z14 kept']) {
    assert.ok(out.includes(probe), `no ${probe} in:\n${out}`)
  }
  assert.doesNotMatch(out, /does not exist|is not a function|undefined/, out)
  /* Two numbers per probe — cold and warm — because one number cannot tell a
     slow query from a cold buffer cache, which is the whole distinction the
     script exists to draw. */
  assert.match(out, /search "muse" \d+ms then \d+ms \(\d+\)/, out)
  /* And it found the place that is there, rather than answering emptily. */
  assert.match(out, /in-view z\d+ \d+ms then \d+ms \([1-9]\d*\)/, out)
})

test('a query that cannot be answered is reported, not thrown', { skip: unreachable }, async t => {
  /* A statement timeout on one probe must not cost the census the other
     eleven — and "this one could not be answered" is itself a measurement.
     Proved by taking a table away, which is the bluntest version of every
     way a single probe can fail. */
  const pool = await freshDatabase(t)
  const databaseUrl = pool.options.connectionString ?? String(pool.options)
  await pool.query('drop table place_tiles')

  const { stdout } = await run(process.execPath, [script], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PLACES_TIMINGS_BUDGET_MS: '60000' },
    timeout: 120_000,
  })
  assert.match(stdout, /tile z14 kept .*place_tiles.* does not exist/, stdout)
  /* The probes after the broken one still ran. */
  assert.match(stdout, /timings: Dublin\b/, stdout)
})

test('no DATABASE_URL is refused rather than guessed at', { skip: unreachable }, async () => {
  const { DATABASE_URL, ...without } = process.env
  await assert.rejects(
    run(process.execPath, [script], { env: without, timeout: 30_000 }),
    error => {
      assert.equal(error.code, 64, `exited ${error.code}`)
      assert.match(error.stderr, /DATABASE_URL/)
      return true
    },
  )
})
