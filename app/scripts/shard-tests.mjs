/* Which browser tests a shard runs, dealt round-robin rather than cut in order.

   Playwright's own --shard cuts the ordered list of tests into consecutive
   pieces. The list is ordered by file, and the heavy tests — the sixty-odd in
   trip.spec.js, each a map boot and a walk through the trip — sit together at
   the end of it, so the last shard drew nearly all of them and ran half as
   long again as the first. Dealt one test at a time to each shard in turn,
   every shard holds the same mix of light and heavy, and they finish together.

   The list comes from Playwright itself, so a test is never missed by a
   shard or run by two: every location is dealt to exactly one. A location is
   a file and a line, which is what Playwright takes on its command line; a
   loop that declares several tests on one line is one location and stays
   together.

     node scripts/shard-tests.mjs <count> <index>    (index from 1)

   prints the locations for that shard, one per line, for the shell to hand
   to `playwright test`. An empty deal is an error rather than an empty
   argument list, because `playwright test` with no arguments runs the whole
   suite. */
import { spawnSync } from 'node:child_process'
import { isAbsolute, join, relative } from 'node:path'

/** The locations dealt to shard `index` (from 1) of `count`. */
export function deal(locations, count, index) {
  if (!(count >= 1) || !(index >= 1) || index > count) {
    throw new Error(`no shard ${index} of ${count}`)
  }
  return locations.filter((_, at) => at % count === index - 1)
}

/** Every test's file:line, once each, in the order Playwright lists them. */
export function locationsOf(listing, cwd = process.cwd()) {
  const root = listing.config?.rootDir || cwd
  const found = []
  const seen = new Set()
  const walk = suite => {
    for (const spec of suite.specs || []) {
      const file = isAbsolute(spec.file) ? spec.file : join(root, spec.file)
      const location = `${relative(cwd, file)}:${spec.line}`
      if (!seen.has(location)) {
        seen.add(location)
        found.push(location)
      }
    }
    for (const child of suite.suites || []) walk(child)
  }
  for (const suite of listing.suites || []) walk(suite)
  return found
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  const [count, index] = process.argv.slice(2).map(Number)
  const listed = spawnSync('pnpm', ['exec', 'playwright', 'test', '--list', '--reporter=json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (listed.status !== 0) {
    process.stderr.write(listed.stderr || 'playwright could not list the tests\n')
    process.exit(listed.status || 1)
  }
  const locations = deal(locationsOf(JSON.parse(listed.stdout)), count, index)
  if (!locations.length) {
    process.stderr.write(`shard ${index} of ${count} was dealt no tests\n`)
    process.exit(1)
  }
  process.stdout.write(`${locations.join('\n')}\n`)
}
