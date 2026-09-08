import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_BUCKET_SECONDS,
  DEFAULT_CACHE_SECONDS,
  linkExpiry,
  mediaCacheControl,
  mediaKindFor,
} from '../src/media-cache.js'

const DAY = 24 * 60 * 60
const HOUR = 60 * 60

test('everybody asking in the same window is handed the same link', () => {
  /* The whole point. Two people opening a trip a second apart used to get two
     different URLs for one photograph, which is a cache key each and a hit
     rate of exactly zero however good the cache in front of us was. */
  const first = linkExpiry(1_000_000, DAY, HOUR)
  assert.equal(first, linkExpiry(1_000_000 + 1, DAY, HOUR))
  assert.equal(first, linkExpiry(1_000_000 + 60, DAY, HOUR))
  assert.equal(first % HOUR, 0, 'rounded to the boundary itself')

  /* And the size of the win, measured rather than asserted: a day of people
     opening the same trip second by second used to be eighty-six thousand
     distinct URLs for one photograph. It is now one per window. */
  const overADay = new Set()
  for (let second = 0; second < DAY; second++) {
    overADay.add(linkExpiry(1_000_000 + second, DAY, HOUR))
  }
  assert.equal(overADay.size, DAY / HOUR + 1, `${overADay.size} distinct links in a day`)

  const unbucketed = new Set()
  for (let second = 0; second < 1000; second++) {
    unbucketed.add(linkExpiry(1_000_000 + second, DAY, 0))
  }
  assert.equal(unbucketed.size, 1000, 'which is what it used to be, one per second')
})

test('a link is never shorter-lived than it was promised to be', () => {
  /* Rounding up, never down. Rounding down would quietly hand somebody a link
     that dies before the day it was meant to last. */
  for (const now of [0, 1, 999, 1_000_000, 1_699_999_999]) {
    const expires = linkExpiry(now, DAY, HOUR)
    assert.ok(expires >= now + DAY, `${expires} < ${now + DAY}`)
    assert.ok(expires < now + DAY + HOUR, 'and not much longer than promised')
  }
})

test('a window of nothing puts the clock back, exactly as it was', () => {
  // The escape hatch: a deployment that would rather have unique links.
  assert.equal(linkExpiry(1_000_000, DAY, 0), 1_000_000 + DAY)
  assert.equal(linkExpiry(1_000_000, DAY, 1), 1_000_000 + DAY)
  assert.notEqual(linkExpiry(1_000_000, DAY, 0), linkExpiry(1_000_001, DAY, 0))
})

test('a fractional clock still lands on a whole second', () => {
  // Date.now()/1000 is not an integer, and a signature is over the text.
  const expires = linkExpiry(1_000_000.4567, DAY, HOUR)
  assert.equal(expires, Math.floor(expires))
})

test('what is at a path decides what may be done with it', () => {
  assert.equal(mediaKindFor('trip-id/abc.jpg'), 'immutable')
  assert.equal(mediaKindFor('trip-id/abc.hls/0/seg00001.ts'), 'immutable')
  assert.equal(mediaKindFor('trip-id/abc.hls/master.m3u8'), 'playlist')
  /* The one thing stored at a stable path, so that replacing a face does not
     leave the old one on the volume as unreferenced personal data. */
  assert.equal(mediaKindFor('profiles/some-user.jpg'), 'mutable')
})

const control = (storagePath, extra = {}) =>
  mediaCacheControl({
    storagePath,
    now: 1_000_000,
    expires: 1_000_000 + DAY,
    maxSeconds: DEFAULT_CACHE_SECONDS,
    bucketSeconds: DEFAULT_BUCKET_SECONDS,
    ...extra,
  })

test('a photograph may be held by a shared cache, and not revalidated', () => {
  const header = control('trip-id/abc.jpg')
  /* `public` is what `private` was refusing. It is correct here because the
     signature in the URL is the authorisation: an edge that does not have the
     URL cannot construct it, and one that does is holding bytes for somebody
     already entitled to them. */
  assert.match(header, /^public,/)
  assert.match(header, /immutable/)
  assert.match(header, /max-age=3600/)
})

test('a cached copy never outlives the link that granted it', () => {
  /* An edge holding bytes past their signature would be quietly extending a
     grant we had already decided should end. */
  const nearly = control('trip-id/abc.jpg', { expires: 1_000_000 + 120 })
  assert.match(nearly, /max-age=120/)
  const done = control('trip-id/abc.jpg', { expires: 1_000_000 })
  assert.doesNotMatch(done, /public/)
})

test('a cached copy never outlives the promise that deletion means deletion', () => {
  /* The link lasts a day so an app left open keeps drawing. A cached copy
     lasting a day would mean a photograph somebody deleted going on being
     served by an edge for the rest of it, which is a different promise and a
     more important one. */
  const header = control('trip-id/abc.jpg', { expires: 1_000_000 + DAY })
  const age = Number(/max-age=(\d+)/.exec(header)[1])
  assert.ok(age <= DEFAULT_CACHE_SECONDS, `${age} is longer than we promise to forget in`)
  assert.ok(age < DAY)
})

test('an avatar is never held by a shared cache, because it changes', () => {
  const header = control('profiles/somebody.jpg')
  assert.match(header, /^private,/)
  /* Short, too: this is the one path whose bytes are replaced in place, and a
     changed profile picture that stays the old one for an hour reads as the
     change not having worked. */
  const age = Number(/max-age=(\d+)/.exec(header)[1])
  assert.ok(age <= 300, `${age} is a long time to show somebody the wrong face`)
  assert.doesNotMatch(header, /immutable/)
})

test('a playlist is shareable only for as long as its links are identical', () => {
  const header = control('trip-id/abc.hls/master.m3u8')
  assert.match(header, /^public,/)
  const age = Number(/max-age=(\d+)/.exec(header)[1])
  /* One window. Past that the body differs, and a shared copy would hand
     somebody another reader's signatures — links to a film they can already
     read, but not ones minted for them or expiring when we said. */
  assert.ok(age <= DEFAULT_BUCKET_SECONDS, `${age} outlives the window it is identical in`)
  assert.doesNotMatch(header, /immutable/, 'a playlist is rewritten on every read')
})

test('with no window, a playlist is not shared at all', () => {
  /* Unique links mean a unique body per reader, so there is nothing to share
     and a shared copy would be somebody else's signatures. */
  const header = control('trip-id/abc.hls/master.m3u8', { bucketSeconds: 0 })
  assert.equal(header, 'private, no-store')
})

test('an expired link is not something to cache at all', () => {
  for (const path of ['t/a.jpg', 't/a.hls/master.m3u8', 'profiles/a.jpg']) {
    const header = control(path, { expires: 999_000 })
    assert.doesNotMatch(header, /public/, `${path} was offered to a shared cache`)
  }
})
