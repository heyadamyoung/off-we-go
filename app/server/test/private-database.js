import pg from 'pg'

/* A database of this test file's own.
 *
 * node's test runner runs files in parallel, and the two files that exercise
 * PostgreSQL both begin by resetting the schema. `drop schema public cascade`
 * in one deletes, mid-query, the tables the other is working through — which
 * fails as three unrelated assertions in whichever file lost the race, and
 * passes cleanly on the retry. Three failures one run and 257 passes the next
 * is not a bug anybody enjoys chasing, and `pnpm test:server` is a deploy gate.
 *
 * A schema each would need every hardcoded `public.` in those files rewritten.
 * A database each needs nothing but this, and leaves `public` inside it
 * private to the one file that resets it.
 */
export async function privateDatabase(baseUrl, name) {
  const url = new URL(baseUrl)
  const base = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres'
  const database = `${base}_${name}`

  const admin = new pg.Client({ connectionString: baseUrl })
  await admin.connect()
  try {
    await admin.query(`create database "${database}"`)
  } catch (error) {
    // Already there from a previous run; the file resets it on the way in.
    if (error.code !== '42P04') throw error
  } finally {
    await admin.end()
  }

  url.pathname = `/${database}`
  return url.toString()
}

/* A database per test, made by copying one that is already migrated.
 *
 * Every places test file began each case with `drop schema public cascade`
 * and a full migration — fifty-two files, about two seconds — and
 * places-worker.test.js alone did that twenty-six times. Measured: 79.8
 * seconds for one file, against 55 for the whole of the rest of the server
 * suite put together, and the test job it is in was three minutes twenty-four.
 *
 * Postgres can copy a database. `create database x template y` is a file
 * copy of a schema with no rows in it, which is milliseconds, so the
 * migrations run once per file instead of once per case and every case still
 * gets a database nobody else has touched. Nothing about what the tests
 * assert changes — that is the point of doing it this way rather than
 * truncating between cases, where a case that adds an index or a type would
 * leave it behind for the next one.
 *
 * `migrate` is passed in rather than imported so this file stays free of the
 * server; it is handed a connection string and should bring that database up
 * to date and then let go of it — a template with a connection still on it
 * cannot be copied.
 */
const templates = new Map()
let made = 0

/* The promise is what is remembered, not the database it resolves to.
 *
 * Remembering the result meant two cases starting at once both found nothing
 * in the map, both built the template, and the second one's `with (force)`
 * dropped it out from under the first — which arrives as `terminating
 * connection due to administrator command` in a test that has nothing to do
 * with templates. Four of them, in one run. */
function templateFor(baseUrl, name, migrate) {
  const started = templates.get(name)
  if (started) return started
  const building = buildTemplate(baseUrl, name, migrate)
  templates.set(name, building)
  return building
}

async function buildTemplate(baseUrl, name, migrate) {
  const url = new URL(baseUrl)
  const base = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres'
  const template = `${base}_${name}_template`
  const admin = new pg.Client({ connectionString: baseUrl })
  await admin.connect()
  try {
    /* Dropped and remade rather than reused: a template left over from a run
       against older code would hand every case a schema from last week. */
    await admin.query(`drop database if exists "${template}" with (force)`)
    await admin.query(`create database "${template}"`)
  } finally {
    await admin.end()
  }
  url.pathname = `/${template}`
  await migrate(url.toString())
  return template
}

/**
 * @param {string} baseUrl       a connection string on the server to use
 * @param {string} name          this test file's own name, for the databases
 * @param {{after: Function}} t  the test context, which drops it afterwards
 * @param {(url: string) => Promise<void>} migrate
 * @returns {Promise<import('pg').Pool>}
 */
export async function freshDatabase(baseUrl, name, t, migrate) {
  const template = await templateFor(baseUrl, name, migrate)
  const url = new URL(baseUrl)
  const base = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres'
  made += 1
  const database = `${base}_${name}_${made}`
  const admin = new pg.Client({ connectionString: baseUrl })
  await admin.connect()
  try {
    await admin.query(`drop database if exists "${database}" with (force)`)
    await admin.query(`create database "${database}" template "${template}"`)
  } finally {
    await admin.end()
  }
  url.pathname = `/${database}`
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 })
  /* A pool with no error listener turns a dropped connection into an uncaught
     exception, and the teardown below drops this database with force. Work a
     case left running — a shutdown is bounded now, so it can — then dies with
     a connection error that lands on whichever case happens to be running,
     which is how `terminating connection due to administrator command`
     appeared twice in one run against tests that touch none of this. */
  pool.on('error', () => {})
  t.after(async () => {
    await pool.end().catch(() => {})
    const cleaner = new pg.Client({ connectionString: baseUrl })
    await cleaner.connect()
    await cleaner.query(`drop database if exists "${database}" with (force)`).catch(() => {})
    await cleaner.end()
  })
  return pool
}
