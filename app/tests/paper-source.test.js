import assert from 'node:assert/strict'
import test from 'node:test'
import { openPaper } from '../src/paper-source-core.ts'

/* Reading the copy we already have.
 *
 * keepPapers has been filling a cache since documents went in the offline pack,
 * and until now nothing had ever read it. recallPaper was exported and tested;
 * no screen called it. The service worker does not intercept the media route
 * either, so every document — a boarding pass included — was fetched fresh over
 * the network the moment somebody opened it.
 *
 * Which means the cache worked everywhere except the one place it was built
 * for: a check-in desk with no signal. The bytes were on the phone and the app
 * asked the network for them anyway.
 */

const held = (map = new Map()) => ({
  async match(url) {
    return map.get(url)
  },
  async put(url, response) {
    map.set(url, response)
  },
  async keys() {
    return [...map.keys()].map(url => ({ url }))
  },
  async delete(url) {
    return map.delete(url)
  },
})

/* A signed link, which is how every document arrives: the signature and expiry
   differ on each load, and the cache is keyed on what is left. */
const signed = (name, sig) => `/api/media/${name}?sig=${sig}&exp=${sig}0`

const cached = bytes => ({ blob: async () => ({ size: bytes.length, bytes }) })

const lab = () => {
  const made = []
  const dropped = []
  return {
    made,
    dropped,
    make: blob => {
      const url = `blob:${made.length}`
      made.push({ url, blob })
      return url
    },
    drop: url => dropped.push(url),
  }
}

test('a paper we already hold is read from the cache, not the network', async () => {
  const store = held(new Map([['/api/media/pass.png', cached('PNG')]]))
  const { make, drop } = lab()
  const open = await openPaper(signed('pass.png', 'abc'), store, make, drop)
  assert.equal(open.held, true, 'went to the network for bytes already on the phone')
  assert.match(open.url, /^blob:/)
})

test('a paper we do not hold still opens, over the network', async () => {
  const link = signed('visa.pdf', 'xyz')
  const kit = lab()
  const open = await openPaper(link, held(), kit.make, kit.drop)
  assert.equal(open.url, link)
  assert.equal(open.held, false)
  assert.deepEqual(kit.made, [])
})

test('the object url is let go, and only once', async () => {
  /* Twice is a revoke of somebody else's url once the counter has moved on,
     and never is a blob the page holds until it is reloaded. */
  const store = held(new Map([['/api/media/pass.png', cached('PNG')]]))
  const kit = lab()
  const open = await openPaper(signed('pass.png', 'abc'), store, kit.make, kit.drop)
  open.release()
  open.release()
  assert.deepEqual(kit.dropped, [open.url])
})

test('releasing a network url revokes nothing', async () => {
  const kit = lab()
  const open = await openPaper(signed('visa.pdf', 'xyz'), held(), kit.make, kit.drop)
  open.release()
  assert.deepEqual(kit.dropped, [])
})

test('no cache at all is not an error, it is the network', async () => {
  /* A webview without the Cache API, or a page served insecurely. The feature
     is simply not there; the document still opens. */
  const link = signed('pass.png', 'abc')
  const kit = lab()
  const open = await openPaper(link, null, kit.make, kit.drop)
  assert.equal(open.url, link)
  assert.equal(open.held, false)
})

test('a cache that throws falls back to the network rather than to nothing', async () => {
  const angry = {
    async match() {
      throw new Error('quota')
    },
    async put() {},
    async keys() {
      return []
    },
    async delete() {
      return false
    },
  }
  const link = signed('pass.png', 'abc')
  const kit = lab()
  const open = await openPaper(link, angry, kit.make, kit.drop)
  assert.equal(open.url, link)
  assert.equal(open.held, false)
})

test('something that is not ours is never looked for in our cache', async () => {
  /* An external link has no signed key to strip and was never kept. */
  let asked = 0
  const watched = {
    async match() {
      asked += 1
      return undefined
    },
    async put() {},
    async keys() {
      return []
    },
    async delete() {
      return false
    },
  }
  const kit = lab()
  const open = await openPaper('https://example.test/ticket.pdf', watched, kit.make, kit.drop)
  assert.equal(asked, 0)
  assert.equal(open.held, false)
})
