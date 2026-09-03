import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchTile,
  protocolUrl,
  prune,
  rewriteTileJson,
  upstreamUrl,
} from '../src/offline-tiles-core.ts'

const TILE = 'https://tiles.openfreemap.org/planet/1/2/3.pbf'

const tileStore = () => {
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

const bytes = (body = 'tile-bytes', status = 200) => new Response(body, { status })
const dead = message => async () => {
  throw new TypeError(message)
}

test('a basemap request under our scheme maps to and from the real one', () => {
  assert.equal(protocolUrl(TILE), 'offwego://tiles.openfreemap.org/planet/1/2/3.pbf')
  assert.equal(upstreamUrl(protocolUrl(TILE)), TILE)
  // Only the scheme is touched; a path that happens to say https is left alone.
  assert.equal(protocolUrl('https://a/b?to=https://c'), 'offwego://a/b?to=https://c')
})

test('a tile index has its tiles brought under the scheme, or they bypass us', () => {
  const rewritten = rewriteTileJson({ tilejson: '3.0.0', tiles: [TILE], maxzoom: 14 })

  assert.deepEqual(rewritten.tiles, ['offwego://tiles.openfreemap.org/planet/1/2/3.pbf'])
  assert.equal(rewritten.maxzoom, 14, 'the rest of the document is untouched')
})

test('a document that is not a tile index passes straight through', () => {
  assert.deepEqual(rewriteTileJson({ hello: 'world' }), { hello: 'world' })
  assert.equal(rewriteTileJson(null), null)
  assert.equal(rewriteTileJson('not json'), 'not json')
})

test('a tile fetched online is returned and a copy is kept', async () => {
  const store = tileStore()

  const response = await fetchTile(store, async () => bytes(), TILE)

  assert.equal(await response.text(), 'tile-bytes')
  assert.ok(store.held.has(TILE), 'and the copy outlives the request')
})

test('with the network gone the copy is what the map draws', async () => {
  const store = tileStore()
  await fetchTile(store, async () => bytes('amsterdam'), TILE)

  const offline = await fetchTile(store, dead('Failed to fetch'), TILE)

  assert.equal(await offline.text(), 'amsterdam')
})

test('a tile never looked at is simply not there when the network goes', async () => {
  assert.equal(await fetchTile(tileStore(), dead('Failed to fetch'), TILE), null)
})

test('a basemap that answers with an error is not cached as though it were a tile', async () => {
  const store = tileStore()

  const response = await fetchTile(store, async () => bytes('nope', 502), TILE)

  assert.equal(response, null)
  assert.equal(store.held.size, 0)
})

test('a request the map cancelled is not answered from the cache behind it', async () => {
  const store = tileStore()
  await fetchTile(store, async () => bytes(), TILE)
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    () => fetchTile(store, dead('aborted'), TILE, controller.signal),
    /aborted/,
    'a cancelled tile is the map moving on, not a map that failed',
  )
})

test('without a store the map still draws, it just keeps nothing', async () => {
  const response = await fetchTile(null, async () => bytes(), TILE)

  assert.equal(await response.text(), 'tile-bytes')
  assert.equal(await fetchTile(null, dead('Failed to fetch'), TILE), null)
})

test('past its limit the tiles looked at longest ago are let go', async () => {
  const store = tileStore()
  for (let index = 0; index < 10; index++) store.held.set(`${TILE}?n=${index}`, bytes())

  await prune(store, 4)

  assert.equal(store.held.size, 4)
  assert.equal(store.held.has(`${TILE}?n=0`), false)
  assert.equal(store.held.has(`${TILE}?n=9`), true)
})

test('a store that will not list itself is left alone rather than emptied', async () => {
  const broken = {
    async match() {
      return undefined
    },
    async put() {},
    async keys() {
      throw new Error('InvalidStateError')
    },
    async delete() {
      return true
    },
  }

  await prune(broken, 1)
})
