import assert from 'node:assert/strict'
import test from 'node:test'
import { isOwnPhoto, keepPhoto, photoKey, recallPhoto } from '../src/offline-photos-core.ts'

const MEDIA = 'https://offwego.example/api/media/trips/t1/p1.jpg?expires=1&signature=abc'
const OUTSIDE = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Rijksmuseum.jpg'

/* The slice of the Cache API the module uses, with insertion order preserved
   the way the real one preserves it. */
const photoStore = () => {
  const held = new Map()
  return {
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
  }
}

const bytes = (size = 1024, status = 200) => new Response('x'.repeat(size), { status })

const counting = (response = () => bytes()) => {
  const calls = []
  return {
    calls,
    fetch: async url => {
      calls.push(url)
      return response(url)
    },
  }
}

test('a photograph that was looked at is kept, and comes back as bytes', async () => {
  const store = photoStore()

  assert.equal(await keepPhoto(store, MEDIA, counting().fetch), true)
  const blob = await recallPhoto(store, MEDIA)

  assert.equal(blob?.size, 1024)
})

test('somebody else pictures are not ours to keep', async () => {
  const store = photoStore()
  const net = counting()

  assert.equal(await keepPhoto(store, OUTSIDE, net.fetch), false)
  assert.equal(net.calls.length, 0, 'and are not even requested a second time')
  assert.equal(store.held.size, 0)
})

test('a photograph already held is not fetched again', async () => {
  const store = photoStore()
  const net = counting()

  await keepPhoto(store, MEDIA, net.fetch)
  await keepPhoto(store, MEDIA, net.fetch)

  assert.equal(net.calls.length, 1)
})

test('a full-size original is passed over rather than filling the cache', async () => {
  const store = photoStore()

  const kept = await keepPhoto(store, MEDIA, counting(() => bytes(2_500_000)).fetch)

  assert.equal(kept, false)
  assert.equal(store.held.size, 0)
})

test('a photograph the server will not serve is not cached as if it were one', async () => {
  const store = photoStore()

  assert.equal(await keepPhoto(store, MEDIA, counting(() => bytes(20, 403)).fetch), false)
  assert.equal(store.held.size, 0)
})

test('being offline while caching costs nothing but the copy', async () => {
  const store = photoStore()
  const failing = async () => {
    throw new TypeError('Failed to fetch')
  }

  assert.equal(await keepPhoto(store, MEDIA, failing), false)
})

test('past two hundred photographs the ones seen longest ago are let go', async () => {
  const store = photoStore()
  const net = counting()
  // Distinct photographs are distinct paths; the query is only the signature.
  const nth = index =>
    `https://offwego.example/api/media/trips/t1/p${index}.jpg?expires=1&signature=a`
  for (let index = 0; index < 205; index++) await keepPhoto(store, nth(index), net.fetch)

  assert.equal(store.held.size, 200)
  assert.equal(await recallPhoto(store, nth(0)), null)
  assert.ok(await recallPhoto(store, nth(204)))
})

test('a photograph we never kept simply is not there', async () => {
  assert.equal(await recallPhoto(photoStore(), MEDIA), null)
})

test('a store that throws reads as nothing held rather than breaking the page', async () => {
  const broken = {
    async match() {
      throw new Error('InvalidStateError')
    },
    async put() {},
    async keys() {
      return []
    },
    async delete() {
      return false
    },
  }

  assert.equal(await recallPhoto(broken, MEDIA), null)
  assert.equal(await keepPhoto(broken, MEDIA, counting().fetch), false)
})

test('our own media is told apart from everything else by its path', () => {
  assert.equal(isOwnPhoto(MEDIA), true)
  assert.equal(isOwnPhoto(OUTSIDE), false)
  assert.equal(isOwnPhoto('https://images.unsplash.com/photo-123'), false)
})

/* A media link is signed and expires within the hour, so the same photograph
   arrives under a new URL every time the trip reloads. */
test('the same photograph under a freshly signed link is the one already held', async () => {
  const store = photoStore()
  const net = counting()
  await keepPhoto(store, MEDIA, net.fetch)

  const resigned = MEDIA.replace('expires=1&signature=abc', 'expires=999&signature=zzz')
  assert.equal(await keepPhoto(store, resigned, net.fetch), false, 'not fetched a second time')
  assert.equal(net.calls.length, 1)
  assert.ok(await recallPhoto(store, resigned), 'and still recalled offline')
})

test('a photograph is filed under its path, never its signature', () => {
  assert.equal(photoKey(MEDIA), '/api/media/trips/t1/p1.jpg')
  assert.equal(photoKey(MEDIA), photoKey(MEDIA.replace('abc', 'different')))
})

test('a full-size original is passed over even when the size is not declared', async () => {
  const store = photoStore()

  const kept = await keepPhoto(store, MEDIA, counting(() => bytes(2_500_000)).fetch)

  assert.equal(kept, false)
  assert.equal(store.held.size, 0)
})
