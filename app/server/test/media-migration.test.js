import assert from 'node:assert/strict'
import test from 'node:test'
import {
  copyDecision,
  humanBytes,
  inParallel,
  storagePathFor,
  summarise,
} from '../scripts/mediaMigrationCore.mjs'

test('a file keeps the exact path the database calls it by', () => {
  /* The path is the identity. Every photo row holds one and every signed link
     names one, so a file that lands in the bucket under a different name is a
     photograph nothing can find any more. */
  const root = '/data/uploads'
  assert.equal(storagePathFor(root, '/data/uploads/trip-1/abc.jpg'), 'trip-1/abc.jpg')
  assert.equal(
    storagePathFor(root, '/data/uploads/trip-1/abc.hls/0/seg00001.ts'),
    'trip-1/abc.hls/0/seg00001.ts',
  )
  assert.equal(storagePathFor(root, '/data/uploads/profiles/me.jpg'), 'profiles/me.jpg')
  // A trailing slash on the root is the same root.
  assert.equal(storagePathFor('/data/uploads/', '/data/uploads/trip-1/abc.jpg'), 'trip-1/abc.jpg')
})

test('what is not media does not go into the bucket', () => {
  const root = '/data/uploads'
  /* Left by an upload that died mid-write, and named so it could never be
     served. Copying them moves rubbish into a store that charges for it. */
  assert.equal(
    storagePathFor(root, '/data/uploads/trip-1/abc.jpg.3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.tmp'),
    null,
  )
  assert.equal(storagePathFor(root, '/data/uploads/.DS_Store'), null)
  assert.equal(storagePathFor(root, '/data/uploads/trip-1/.hidden/x.jpg'), null)
  // And nothing from outside the volume, however it was reached.
  assert.equal(storagePathFor(root, '/etc/passwd'), null)
  assert.equal(storagePathFor(root, '/data/uploads-elsewhere/x.jpg'), null)
})

test('a second run copies only what did not arrive the first time', () => {
  /* Which is the run that matters: the one after an interruption, made by
     somebody who does not know how far the last one got. */
  assert.equal(copyDecision(1000, null), 'copy')
  assert.equal(copyDecision(1000, 1000), 'skip')
})

test('a half-written object is overwritten rather than left', () => {
  /* A different size at the same path is an upload that died partway. Leaving
     it would be a photograph that downloads as a truncated file for ever, and
     it would look exactly like a successful migration. */
  assert.equal(copyDecision(1000, 400), 'replace')
  assert.equal(copyDecision(1000, 1200), 'replace')
})

test('an empty file is nothing to move', () => {
  assert.equal(copyDecision(0, null), 'empty')
  assert.equal(copyDecision(0, 0), 'empty')
})

test('the tally says what happened, and counts a failure as a failure', () => {
  const counts = summarise([
    { decision: 'copy', bytes: 100 },
    { decision: 'copy', bytes: 200 },
    { decision: 'replace', bytes: 50 },
    { decision: 'skip', bytes: 999 },
    { decision: 'empty', bytes: 0 },
    { decision: 'copy', bytes: 300, error: new Error('refused') },
  ])
  assert.equal(counts.copied, 2)
  assert.equal(counts.replaced, 1)
  assert.equal(counts.skipped, 1)
  assert.equal(counts.empty, 1)
  assert.equal(counts.failed, 1)
  /* Only what was actually written. Counting a file that failed, or one that
     was already there, would report a migration as having moved bytes it
     never moved. */
  assert.equal(counts.bytes, 350)
})

test('bytes are printed for somebody watching a terminal', () => {
  assert.equal(humanBytes(0), '0B')
  assert.equal(humanBytes(512), '512B')
  assert.equal(humanBytes(1024), '1.0KB')
  assert.equal(humanBytes(1024 * 1024 * 3.5), '3.5MB')
  assert.match(humanBytes(1024 ** 4 * 2), /2\.0TB/)
})

test('work runs a few at a time, in order, and every item is done once', async () => {
  const items = Array.from({ length: 50 }, (_, index) => index)
  let running = 0
  let mostAtOnce = 0
  const seen = []

  const results = await inParallel(items, 4, async item => {
    running++
    mostAtOnce = Math.max(mostAtOnce, running)
    await new Promise(resolve => setTimeout(resolve, item % 3))
    seen.push(item)
    running--
    return item * 2
  })

  /* One at a time makes ten thousand photographs an afternoon of round trips;
     all at once opens ten thousand sockets and is refused. */
  assert.equal(mostAtOnce, 4)
  assert.equal(seen.length, 50)
  assert.equal(new Set(seen).size, 50, 'nothing was done twice, and nothing was missed')
  // Results stay in the order they were given, whatever order they finished in.
  assert.deepEqual(
    results,
    items.map(item => item * 2),
  )
})

test('fewer things than workers is not a problem', async () => {
  assert.deepEqual(await inParallel([1, 2], 8, async n => n + 1), [2, 3])
  assert.deepEqual(await inParallel([], 4, async n => n), [])
})
