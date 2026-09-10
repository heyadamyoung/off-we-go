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
