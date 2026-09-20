import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  FSQ_BUCKET,
  OVERTURE_BUCKET,
  createIndexStore,
  discoverRelease,
  indexFromJson,
  indexToJson,
  listObjects,
  listParts,
  listReleases,
  newestFirst,
  objectUrl,
  parseListing,
  releaseIndex,
  versionOrder,
} from '../src/places/release.js'

/* Discovery, with the bucket played back from recordings rather than asked.
   Nothing in this file touches the network: a test that depends on a public
   S3 bucket fails on a train, and the thing being proved — that an expired
   pin is noticed and replaced — is impossible to stage against the real one
   anyway, because it would need a release to expire on cue. */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'places')
const recording = name => readFile(join(fixtures, name), 'utf8')

/** A fetch that answers from the recordings, keyed by what the URL asks for,
    and refuses anything it was not told about — so an unexpected request is a
    failure rather than a silent live call. */
function bucketFetch(routes) {
  const asked = []
  const impl = async url => {
    const address = String(url)
    asked.push(address)
    for (const [match, body] of routes) {
      if (match(address)) {
        const text = typeof body === 'function' ? await body() : await body
        return { ok: true, status: 200, text: async () => text }
      }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
  impl.asked = asked
  return impl
}

const overtureRoutes = (partsName = 'overture-parts.xml') => [
  [
    url => url.startsWith(OVERTURE_BUCKET) && url.includes('delimiter=%2F'),
    () => recording('overture-releases.xml'),
  ],
  [url => url.startsWith(OVERTURE_BUCKET), () => recording(partsName)],
]

test('a listing is read one Contents block at a time, so a missing Size cannot move', async () => {
  const listed = parseListing(await recording('overture-parts.xml'))
  /* Four Contents blocks in the recording; the one with no <Size> is dropped
     rather than taking its neighbour's, which is the bug this parser exists
     for: a part recorded 70 MB too long answers 416 to a range read an hour
     into a planet run. */
  assert.equal(listed.objects.length, 3)
  assert.deepEqual(
    listed.objects.map(object => object.size),
    [634918674, 704551514, 0],
  )
  assert.ok(listed.objects.every(object => object.key.startsWith('release/2026-08-19.10/')))
  assert.equal(listed.truncated, false)
})

test('common prefixes, entities and continuation tokens are all read', async () => {
  const releases = parseListing(await recording('overture-releases.xml'))
  assert.deepEqual(releases.prefixes, [
    'release/2026-07-22.0/',
    'release/2026-08-19.0/',
    'release/2026-08-19.10/',
    'release/notes/',
  ])
  const firstPage = parseListing(await recording('fsq-parts.xml'))
  assert.equal(firstPage.truncated, true)
  assert.equal(firstPage.next, 'page-two')
  /* &quot; in an ETag decodes rather than arriving as five characters. */
  const parts = parseListing(await recording('overture-parts.xml'))
  assert.ok(parts.objects.length > 0)
})

test('a release version sorts by date and then numerically by revision', () => {
  assert.equal(versionOrder('2026-08-19.10') > versionOrder('2026-08-19.2'), true)
  assert.equal(versionOrder('notes'), null)
  assert.deepEqual(newestFirst(['2026-07-22.0', 'notes', '2026-08-19.0', '2026-08-19.10']), [
    '2026-08-19.10',
    '2026-08-19.0',
    '2026-07-22.0',
  ])
})

test('the newest release is discovered, and only its parquet parts are parts', async () => {
  const fetchImpl = bucketFetch(overtureRoutes())
  const found = await discoverRelease({ source: 'overture', fetch: fetchImpl })
  assert.equal(found.version, '2026-08-19.10')
  assert.deepEqual(found.available, ['2026-08-19.10', '2026-08-19.0', '2026-07-22.0'])
  /* _SUCCESS is not a part, and neither is the entry with no size. */
  assert.equal(found.parts.length, 2)
  assert.equal(found.parts[0].size, 634918674)
  assert.equal(found.expired, false)
  assert.equal(found.notice, null)
  assert.equal(found.problem, null)
  /* The `=` in theme=places is encoded the way the bucket signs it. */
  assert.ok(found.parts[0].url.includes('theme%3Dplaces'))
})

test('a pinned release that still exists is honoured', async () => {
  const fetchImpl = bucketFetch(overtureRoutes())
  const found = await discoverRelease({
    source: 'overture',
    pinned: '2026-08-19.0',
    fetch: fetchImpl,
  })
  assert.equal(found.version, '2026-08-19.0')
  assert.equal(found.expired, false)
  assert.equal(found.notice, null)
})

test('a pinned release that has expired falls back to the newest, loudly', async () => {
  const fetchImpl = bucketFetch(overtureRoutes())
  const found = await discoverRelease({
    source: 'overture',
    pinned: '2026-05-21.0',
    fetch: fetchImpl,
  })
  assert.equal(found.version, '2026-08-19.10')
  assert.equal(found.requested, '2026-05-21.0')
  assert.equal(found.expired, true)
  /* Loudly: the sentence names both versions, so a log says what moved. */
  assert.match(found.notice, /2026-05-21\.0 has expired/)
  assert.match(found.notice, /2026-08-19\.10/)
  /* And it does not throw — a planet run must continue on the live release. */
  assert.equal(found.problem, null)
})

test('Foursquare is discovered the same way, across a truncated listing', async () => {
  const fetchImpl = bucketFetch([
    [url => url.includes('delimiter=%2F'), () => recording('fsq-releases.xml')],
    [url => url.includes('continuation-token=page-two'), () => recording('fsq-parts-page-two.xml')],
    [url => url.startsWith(FSQ_BUCKET), () => recording('fsq-parts.xml')],
  ])
  const found = await discoverRelease({ source: 'fsq', pinned: '2026-06-10', fetch: fetchImpl })
  assert.equal(found.version, '2026-06-10')
  assert.deepEqual(found.available, ['2026-08-05', '2026-06-10'])
  /* Both pages of the parts listing, followed rather than truncated. */
  assert.equal(found.parts.length, 2)
  assert.ok(found.parts[1].url.endsWith('places-00001.snappy.parquet'))
})

test('a source that publishes nothing is a problem, not an exception', async () => {
  /* Exactly what the Foursquare bucket answered on 2026-09-20: two keys at the
     root and no release prefix at all. Overture going quiet must stop a run;
     Foursquare going quiet must only thin it, and only the caller knows
     which it is holding — so this reports rather than throws. */
  const fetchImpl = bucketFetch([[() => true, () => recording('fsq-empty.xml')]])
  const found = await discoverRelease({ source: 'fsq', fetch: fetchImpl })
  assert.equal(found.version, null)
  assert.deepEqual(found.parts, [])
  assert.match(found.problem, /no dated release/)
})

test('a bad status on a listing is raised rather than read as an empty bucket', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => '' })
  await assert.rejects(
    () => listReleases('overture', { fetch: fetchImpl }),
    /answered 503/,
    'a 503 read as "no releases" would delete the planet on the next refresh',
  )
})

test('an index round-trips through JSON as plain numbers', () => {
  const index = {
    version: '2026-08-19.10',
    builtAt: '2026-09-20T00:00:00.000Z',
    parts: [
      {
        url: 'https://example/part-0.parquet',
        size: 100,
        rows: 20,
        xmin: 4,
        xmax: 5,
        ymin: 52,
        ymax: 53,
        groups: [{ s: 0, e: 20, xmin: 4, xmax: 5, ymin: 52, ymax: 53 }],
      },
    ],
  }
  const back = indexFromJson(indexToJson(index))
  assert.deepEqual(back, index)
  assert.equal(typeof back.parts[0].groups[0].s, 'number')
})

test('a part with no bbox statistics becomes the whole world, never a null', () => {
  /* JSON.stringify writes Infinity as null, and a null extent compared with a
     bounding box is false every time — the part would be skipped silently and
     a country would go missing. The whole world is slow; missing is wrong. */
  const written = indexToJson({
    parts: [
      {
        url: 'https://example/part-0.parquet',
        size: 100,
        rows: 0,
        xmin: Infinity,
        xmax: -Infinity,
        ymin: Infinity,
        ymax: -Infinity,
        groups: [],
      },
    ],
  })
  const back = indexFromJson(written)
  assert.deepEqual(
    { ...back.parts[0], url: undefined, size: undefined, rows: undefined, groups: undefined },
    {
      url: undefined,
      size: undefined,
      rows: undefined,
      groups: undefined,
      xmin: -180,
      xmax: 180,
      ymin: -90,
      ymax: 90,
    },
  )
})

test('a truncated index file is refused rather than half-believed', () => {
  assert.throws(() => indexFromJson('{"parts":[{"url":"x"}]}'), /no url or size/)
  assert.throws(() => indexFromJson('{}'), /not a release index/)
})

test('an index is built once and read from the store after that', async () => {
  const files = new Map()
  const store = createIndexStore({
    directory: '/cache',
    fs: {
      mkdir: async () => {},
      readFile: async path => {
        if (!files.has(path)) throw new Error('ENOENT')
        return files.get(path)
      },
      writeFile: async (path, body) => {
        files.set(path, body)
      },
    },
  })
  const index = {
    version: '2026-08-19.10',
    builtAt: '2026-09-20T00:00:00.000Z',
    parts: [
      {
        url: 'https://example/p0',
        size: 1,
        rows: 1,
        xmin: 0,
        xmax: 1,
        ymin: 0,
        ymax: 1,
        groups: [],
      },
    ],
  }
  await store.write('overture-2026-08-19.10', index)
  const lines = []
  const held = await releaseIndex(
    { source: 'overture', version: '2026-08-19.10', parts: [] },
    {
      store,
      log: line => lines.push(line),
      fetch: () => {
        throw new Error('the store should have answered this')
      },
    },
  )
  assert.deepEqual(held.parts, index.parts)
  assert.match(lines[0], /read from cache/)
})

/* The regression for the outage of 2026-09-20: the map said "still loading
   places here" for ever, everywhere, and drew no pins at all.
   The cause was one unguarded `await store.write(...)` at the end of this
   function. The api container runs as `node`; /data belonged to root; the
   mkdir for /data/places threw EACCES. That throw came out of a function that
   had just successfully built the index, was caught by the loader — which
   reports a build failure by returning null — and so the worker was told
   there was no upstream release. No release, no drain; no drain, every cell
   stayed `pending`; every cell pending, every view degraded, for ever.
   A cache is an optimisation. It is not allowed to destroy the thing it was
   asked to keep a copy of. */
test('an index that cannot be cached is still returned, and says so', async () => {
  const lines = []
  const index = await releaseIndex(
    { source: 'overture', version: '2026-08-19.10', parts: [] },
    {
      log: line => lines.push(line),
      store: {
        read: async () => null,
        write: async () => {
          throw Object.assign(new Error("EACCES: permission denied, mkdir '/data/places'"), {
            code: 'EACCES',
          })
        },
      },
    },
  )
  assert.ok(index, 'the built index survives a cache that cannot be written')
  assert.deepEqual(index.parts, [])
  assert.equal(index.version, '2026-08-19.10')
  assert.ok(
    lines.some(line => /could not be cached/.test(line) && /EACCES/.test(line)),
    `the failure is said out loud, not swallowed: ${JSON.stringify(lines)}`,
  )
})

test('a key becomes a URL with its slashes intact', () => {
  assert.equal(
    objectUrl(OVERTURE_BUCKET, 'release/2026-08-19.0/theme=places/type=place/part-0.parquet'),
    `${OVERTURE_BUCKET}release/2026-08-19.0/theme%3Dplaces/type%3Dplace/part-0.parquet`,
  )
})

test('listing and parts helpers ask the bucket the questions they say they do', async () => {
  const fetchImpl = bucketFetch(overtureRoutes())
  await listObjects(OVERTURE_BUCKET, { prefix: 'release/', delimiter: '/', fetch: fetchImpl })
  assert.match(fetchImpl.asked[0], /list-type=2/)
  assert.match(fetchImpl.asked[0], /prefix=release%2F/)
  const parts = await listParts('overture', '2026-08-19.10', { fetch: fetchImpl })
  assert.equal(parts.length, 2)
  assert.match(fetchImpl.asked[1], /theme%3Dplaces/)
})
