import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_PAPERS, keepPapers, papersOf, recallPaper } from '../src/offline-papers-core.ts'

/* The papers, kept before anybody asks for them.
 *
 * This is the opposite policy to the photographs next door, and deliberately.
 * A picture is kept because somebody looked at it: downloading a whole trip's
 * worth on the chance would spend a traveller's data guessing at what they
 * might want. A document is kept because nobody has looked at it yet — the
 * entire case is standing at a desk with no signal needing the one you did not
 * think to open on the aeroplane.
 *
 * And its own cache, not a corner of the photographs': scrolling a gallery
 * must never be able to evict a boarding pass.
 */

const store = (held = new Map()) => ({
  held,
  async match(url) {
    return held.get(url)
  },
  async put(url, response) {
    held.set(url, response)
  },
  async keys() {
    return [...held.keys()].map(url => ({ url }))
  },
  async delete(url) {
    return held.delete(url)
  },
})

const answering = (bytes = 'PDF', ok = true) => ({
  ok,
  clone: () => ({ blob: async () => ({ size: bytes.length }) }),
  blob: async () => ({ size: bytes.length, text: async () => bytes }),
})

const paper = (id, name, at = `/api/media/${id}.pdf`) => ({ id, name, src: at })

test('the papers of a trip are every document on it, wherever they hang', () => {
  /* A boarding pass is on a flight and a hotel booking is on a stop, and
     somebody at a desk does not know or care which. */
  const trip = {
    stops: [
      { id: 's1', documents: [paper('d1', 'Hotel booking')] },
      { id: 's2', documents: [] },
      { id: 's3' },
    ],
    segments: [{ id: 'g1', documents: [paper('d2', 'Boarding pass')] }],
  }
  assert.deepEqual(
    papersOf(trip).map(p => p.id),
    ['d1', 'd2'],
  )
})

test('the same document reached two ways is one document', () => {
  const shared = paper('d1', 'Ferry ticket')
  const trip = {
    stops: [{ id: 's1', documents: [shared] }],
    segments: [{ id: 'g1', documents: [shared] }],
  }
  assert.equal(papersOf(trip).length, 1)
})

test('an empty trip has no papers rather than throwing', () => {
  assert.deepEqual(papersOf({}), [])
  assert.deepEqual(papersOf({ stops: null, segments: undefined }), [])
})

test('a document with nowhere to fetch it from is not a paper', () => {
  const trip = { stops: [{ id: 's1', documents: [{ id: 'd1', name: 'Nothing', src: '' }] }] }
  assert.deepEqual(papersOf(trip), [])
})

test('every paper is fetched, not only the ones somebody opened', () => {
  /* The whole difference from the photographs. */
  const asked = []
  const kept = store()
  return keepPapers(kept, [paper('d1', 'A'), paper('d2', 'B')], async url => {
    asked.push(url)
    return answering()
  }).then(count => {
    assert.equal(count, 2)
    assert.deepEqual(asked, ['/api/media/d1.pdf', '/api/media/d2.pdf'])
  })
})

test('a paper already held is not fetched a second time', () => {
  const kept = store(new Map([['/api/media/d1.pdf', answering()]]))
  let asked = 0
  return keepPapers(kept, [paper('d1', 'A')], async () => {
    asked += 1
    return answering()
  }).then(count => {
    assert.equal(asked, 0)
    assert.equal(count, 0)
  })
})

test('links expire, so a paper is filed under its path and not its signature', () => {
  /* Media links are signed and last about an hour, so the same document
     arrives under a different URL every load. Keyed whole, nothing would ever
     be found again. */
  const kept = store()
  return keepPapers(kept, [paper('d1', 'A', '/api/media/d1.pdf?sig=abc&exp=1')], async () =>
    answering(),
  )
    .then(() => recallPaper(kept, '/api/media/d1.pdf?sig=zzz&exp=9'))
    .then(blob => assert.ok(blob, 'the same document under a fresh signature was not found'))
})

test('something the server will not hand over is not kept', () => {
  const kept = store()
  return keepPapers(kept, [paper('d1', 'A')], async () => answering('', false)).then(count => {
    assert.equal(count, 0)
    assert.equal(kept.held.size, 0)
  })
})

test('a fetch that throws loses that paper and not the rest', () => {
  /* One document behind a dead link must not stop the boarding pass being
     kept. */
  const kept = store()
  return keepPapers(kept, [paper('d1', 'A'), paper('d2', 'B')], async url => {
    if (url.includes('d1')) throw new Error('offline')
    return answering()
  }).then(count => {
    assert.equal(count, 1)
    assert.ok(kept.held.has('/api/media/d2.pdf'))
  })
})

test('the oldest go once there are too many, and never before', () => {
  const kept = store()
  const many = Array.from({ length: MAX_PAPERS + 3 }, (_, nth) => paper(`d${nth}`, `Paper ${nth}`))
  return keepPapers(kept, many, async () => answering()).then(() => {
    assert.equal(kept.held.size, MAX_PAPERS)
    assert.ok(!kept.held.has('/api/media/d0.pdf'), 'the first one in was the first one out')
    assert.ok(kept.held.has(`/api/media/d${MAX_PAPERS + 2}.pdf`))
  })
})

test('only our own media is ours to keep a copy of', () => {
  const kept = store()
  return keepPapers(
    kept,
    [{ id: 'd1', name: 'Someone else’s', src: 'https://example.invalid/thing.pdf' }],
    async () => answering(),
  ).then(count => assert.equal(count, 0))
})

test('nothing held comes back as nothing, not as a throw', async () => {
  assert.equal(await recallPaper(store(), '/api/media/missing.pdf'), null)
})
