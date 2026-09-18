/* Which browser tests a shard runs, dealt by weight rather than cut in order.

   Playwright's own --shard cuts the ordered list of tests into consecutive
   pieces. The list is ordered by file, and the heavy tests — the sixty-odd in
   trip.spec.js, each a map boot and a walk through the trip — sit together at
   the end of it, so the last shard drew nearly all of them and ran half as
   long again as the first. Dealt one test at a time to each shard in turn,
   every shard held the same mix of light and heavy, and they finished within
   eleven seconds of each other; dealt by weight — the heaviest first, each
   to the shard with the least so far, with a file's tests weighed by what
   they take — they finish together.

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

/** How long a test in each file takes, in seconds on the runner, from the
    suite's own logs. A file not named here is an ordinary one. Approximate
    is enough: this decides which shard a test lands on, and a weight a
    second off moves the shards a second apart; the deal it replaced, which
    counted every test as one, had them eleven apart. */
export const WEIGHTS = {
  'sight-tap.spec.js': 5.8,
  'phone-layout.spec.js': 5.0,
  'photo-zoom-swipe.spec.js': 4.9,
  'offline.spec.js': 4.7,
  'trip.spec.js': 4.5,
  'photo-swipe-arc.spec.js': 4.4,
  'media-loading.spec.js': 3.9,
  'photo-scroll.spec.js': 3.8,
  'stop-editing.spec.js': 3.6,
  'airport-walk.spec.js': 3.6,
  'video-upload.spec.js': 3.4,
  'trip-notices.spec.js': 3.1,
  'street-names.spec.js': 3.1,
  'offline-papers.spec.js': 3.1,
  'photo-select.spec.js': 2.9,
  'papers.spec.js': 2.8,
  'timeline.spec.js': 2.8,
  'travel.spec.js': 2.7,
  'photo-upload.spec.js': 2.7,
  'now-card.spec.js': 2.5,
  'travel-day.spec.js': 2.5,
  'photo-grid.spec.js': 2.4,
  'oauth-consent.spec.js': 2.1,
  'navigation.spec.js': 1.6,
  'offline-routing.spec.js': 0.3,
}
const ORDINARY = 3

/** The seconds a location is expected to take, by its file. */
export const weightOf = location => {
  const file = location.replace(/:\d+$/, '').replace(/^.*\//, '')
  return WEIGHTS[file] ?? ORDINARY
}

/** The locations dealt to shard `index` (from 1) of `count`: the heaviest
    first, each to the shard with the least so far, so the shards finish
    together. With every weight equal this is the round-robin it replaced —
    the first location to shard 1, the second to shard 2 — and a location
    is dealt to exactly one shard either way. */
export function deal(locations, count, index, weigh = weightOf) {
  if (!(count >= 1) || !(index >= 1) || index > count) {
    throw new Error(`no shard ${index} of ${count}`)
  }
  const plates = Array.from({ length: count }, () => ({ weight: 0, held: [] }))
  const heaviestFirst = locations
    .map((location, at) => ({ location, at, weight: weigh(location) }))
    .sort((a, b) => b.weight - a.weight || a.at - b.at)
  for (const { location, weight } of heaviestFirst) {
    const plate = plates.reduce((least, plate) => (plate.weight < least.weight ? plate : least))
    plate.held.push(location)
    plate.weight += weight
  }
  return plates[index - 1].held
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
