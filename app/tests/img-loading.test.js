import assert from 'node:assert/strict'
import test from 'node:test'
import { tileLoading } from '../src/img-loading-core.ts'

test('a tile the window has already placed does not wait to be asked twice', () => {
  /* The bug this exists for. The grid renders only what is nearly on screen,
     and `loading="lazy"` then declines to fetch it until it actually is —
     so a quick scroll builds and destroys tiles that never began to load,
     and each one starts from its shimmer again on the way back. */
  assert.equal(tileLoading({ seen: false, now: true }).loading, 'eager')
})

test('a picture already fetched comes back without a gap', () => {
  /* A new <img> for a URL the browser already has still paints nothing until
     it has decoded again. Asynchronously, that is a frame or two of empty
     tile — which is the photograph blinking out and returning. */
  const back = tileLoading({ seen: true })
  assert.equal(back.decoding, 'sync')
  assert.equal(back.loading, 'eager', 'nothing to be lazy about; the bytes are here')
})

test('nothing is decoded on the spot before it has arrived', () => {
  /* A synchronous decode of bytes that are not there buys nothing and blocks
     the frame it is asked in. */
  for (const state of [{ seen: false }, { seen: false, now: true }, { seen: false, eager: true }]) {
    assert.equal(tileLoading(state).decoding, 'async', JSON.stringify(state))
  }
})

test('an ordinary picture nobody has spoken for is still left to the browser', () => {
  /* Lazy is right for a long page of things that may never be looked at. It is
     only wrong inside something that has already done the deciding. */
  const idle = tileLoading({ seen: false })
  assert.equal(idle.loading, 'lazy')
  assert.equal(idle.decoding, 'async')
})

test('only one picture at a time is more important than the others', () => {
  /* Sixty thumbnails all claiming high priority is the same queue in a
     different order, and it competes with the one full-size picture somebody
     actually opened. */
  assert.equal(tileLoading({ seen: true, eager: true }).fetchPriority, 'high')
  for (const state of [{ seen: true }, { seen: false, now: true }, { seen: true, now: true }]) {
    assert.ok(
      !('fetchPriority' in tileLoading(state)),
      `${JSON.stringify(state)} asked to jump the queue`,
    )
  }
})

test('the one big picture still wins outright', () => {
  const opened = tileLoading({ seen: false, eager: true })
  assert.equal(opened.loading, 'eager')
  assert.equal(opened.fetchPriority, 'high')
})
