import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createFooterStore, createReleaseLoader } from '../src/places/upstream.js'

/* The two caches the places layer keeps on disk, and what each of them is
   allowed to do when the disk says no.
 *
 * This file exists because of an outage: nothing here was covered, and an
 * unwritable /data/places took the whole layer down in production — the map
 * said "still loading places here" everywhere and drew nothing, for days,
 * because a cache write failure was allowed to look like "there is no
 * upstream release". Both stores are optimisations. Neither may cost an
 * answer, and neither may fail silently for ever.
 *
 * Nothing here touches the network or /data: the stores are pointed at a
 * temporary directory, and the one case that needs an unwritable path gets
 * one by asking for a directory underneath a regular file, which is ENOTDIR
 * for root and for anybody else alike. */

/** A path that cannot be made a directory, for any user, on any machine. */
async function unwritable() {
  const base = await mkdtemp(join(tmpdir(), 'places-'))
  const file = join(base, 'not-a-directory')
  await writeFile(file, 'x')
  return join(file, 'places')
}

test('a footer that cannot be kept costs speed, not the read', async () => {
  const store = createFooterStore({ directory: await unwritable() })
  await store.saveFooter('https://example.invalid/part-0.parquet', new Uint8Array([1, 2, 3]))
  assert.equal(
    await store.loadFooter('https://example.invalid/part-0.parquet'),
    null,
    'nothing was kept, and asking for it is a miss rather than a throw',
  )
})

test('a footer cache that cannot be written says so once, not once per footer', async () => {
  const lines = []
  const store = createFooterStore({ directory: await unwritable(), log: line => lines.push(line) })
  for (let part = 0; part < 16; part += 1) {
    await store.saveFooter(`https://example.invalid/part-${part}.parquet`, new Uint8Array([1]))
  }
  assert.equal(lines.length, 1, `said once for sixteen parts, not sixteen times: ${lines.length}`)
  assert.match(lines[0], /footers cannot be kept/)
})

/** A loader built over a bucket that answers nothing. */
const brokenLoader = (overrides = {}) => {
  const lines = []
  const loader = createReleaseLoader({
    source: 'overture',
    fetch: async () => ({ ok: false, status: 503, text: async () => '' }),
    store: { read: async () => null, write: async () => {} },
    log: line => lines.push(line),
    ...overrides,
  })
  return { loader, lines }
}

test('a bucket that will not answer is null, never a throw', async () => {
  const { loader, lines } = brokenLoader()
  assert.equal(await loader(), null)
  assert.match(lines.at(-1), /no upstream release/)
  assert.equal(loader.current, null, 'nothing was loaded, so there is no current version')
})

test('a failed discovery is remembered, then tried again', async () => {
  let asked = 0
  let clock = 1_000
  const { loader } = brokenLoader({
    fetch: async () => {
      asked += 1
      return { ok: false, status: 503, text: async () => '' }
    },
    now: () => clock,
    retryMs: 60_000,
  })
  await loader()
  await loader()
  assert.equal(asked, 1, 'the second call inside the window does not ask the bucket again')
  clock += 60_001
  await loader()
  assert.equal(asked, 2, 'and once the window has passed, it does')
})

test('a burst of callers on a cold loader share one build', async () => {
  let building = 0
  let peak = 0
  const { loader } = brokenLoader({
    fetch: async () => {
      building += 1
      peak = Math.max(peak, building)
      await new Promise(resolve => setImmediate(resolve))
      building -= 1
      return { ok: false, status: 503, text: async () => '' }
    },
  })
  await Promise.all([loader(), loader(), loader(), loader()])
  assert.equal(peak, 1, 'four degraded queries on a cold box build one index between them')
})
