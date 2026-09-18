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

     node scripts/shard-tests.mjs <count> <index> [--cover <k>-<k>...]

   prints the locations for that shard (index from 1), one per line, for
   the shell to hand to `playwright test`. An empty deal is an error rather
   than an empty argument list, because `playwright test` with no arguments
   runs the whole suite.

   With --cover, the shard also takes its share of the deals of the shards
   named — the ones whose runner had not arrived (see shard-cover.mjs). A
   late shard's deal is split into fixed parts, one for each of the others
   by index, so what the punctual shards run between them is the whole of
   it whichever of them asked first. */
import { spawnSync } from 'node:child_process'
import { isAbsolute, join, relative } from 'node:path'

/** The locations dealt to shard `index` (from 1) of `count`. */
export function deal(locations, count, index) {
  if (!(count >= 1) || !(index >= 1) || index > count) {
    throw new Error(`no shard ${index} of ${count}`)
  }
  return locations.filter((_, at) => at % count === index - 1)
}

/** Shard `index`'s own deal, and its fixed share of each late shard's. */
export function cover(locations, count, index, late) {
  const mine = deal(locations, count, index)
  for (const shard of late) {
    if (shard === index) continue
    const others = Array.from({ length: count }, (_, at) => at + 1).filter(at => at !== shard)
    mine.push(...deal(deal(locations, count, shard), others.length, others.indexOf(index) + 1))
  }
  return mine
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
  const [count, index] = process.argv.slice(2, 4).map(Number)
  const covering = process.argv.indexOf('--cover')
  const late =
    covering > 0 ? (process.argv[covering + 1] || '').split('-').filter(Boolean).map(Number) : []
  const listed = spawnSync('pnpm', ['exec', 'playwright', 'test', '--list', '--reporter=json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (listed.status !== 0) {
    process.stderr.write(listed.stderr || 'playwright could not list the tests\n')
    process.exit(listed.status || 1)
  }
  const locations = cover(locationsOf(JSON.parse(listed.stdout)), count, index, late)
  if (!locations.length) {
    process.stderr.write(`shard ${index} of ${count} was dealt no tests\n`)
    process.exit(1)
  }
  process.stdout.write(`${locations.join('\n')}\n`)
}
