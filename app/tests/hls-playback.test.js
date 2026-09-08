import assert from 'node:assert/strict'
import test from 'node:test'
import { browserPowers, playbackPlan } from '../src/hls-playback-core.ts'

const film = {
  src: 'https://off.we/api/media/t/a.converted.mp4?signature=x',
  hlsSrc: 'https://off.we/api/media/t/a.converted.hls/master.m3u8?signature=x',
  mime: 'video/mp4',
}

const safari = { nativeHls: true, mediaSource: true, canPlayFile: true }
const iphone = { nativeHls: true, mediaSource: false, canPlayFile: true }
const chrome = { nativeHls: false, mediaSource: true, canPlayFile: true }
const ancient = { nativeHls: false, mediaSource: false, canPlayFile: true }

test('a browser that does HLS itself is given the playlist, not a script player', () => {
  /* Native first even where hls.js would run: on a Mac the built-in decodes
     in hardware, and on an iPhone media source does not exist at all, so a
     script player would have nothing to feed. */
  assert.equal(playbackPlan(film, safari).via, 'native-hls')
  assert.equal(playbackPlan(film, iphone).via, 'native-hls')
  assert.equal(playbackPlan(film, safari).src, film.hlsSrc)
})

test('a browser with media source gets the script player', () => {
  const plan = playbackPlan(film, chrome)
  assert.equal(plan.via, 'hls.js')
  assert.equal(plan.src, film.hlsSrc)
})

test('everything else still gets the single file, exactly as before', () => {
  const plan = playbackPlan(film, ancient)
  assert.equal(plan.via, 'file')
  assert.equal(plan.src, film.src)
})

test('a film with no renditions yet is played as the file it already is', () => {
  /* The ladder is built behind the upload, so for a minute or two after
     somebody films something there is only the one file. That is not a
     failure and must not read as one. */
  const fresh = { ...film, hlsSrc: null }
  for (const powers of [safari, iphone, chrome, ancient]) {
    const plan = playbackPlan(fresh, powers)
    assert.equal(plan.via, 'file')
    assert.equal(plan.src, film.src)
  }
})

test('dropping the stream is how a fallback is asked for', () => {
  /* There is no second function that decides where to fall back to. The
     caller asks again without the stream, and this decides afresh — one place
     that knows what a browser can play rather than two that must agree. */
  const failed = { ...film, hlsSrc: null }
  assert.equal(playbackPlan(film, chrome).via, 'hls.js')
  assert.equal(playbackPlan(failed, chrome).via, 'file')
})

test('a film this browser can neither stream nor decode is not pretended to play', () => {
  const hevc = { src: 'https://off.we/x.mov', hlsSrc: null, mime: 'video/quicktime' }
  const plan = playbackPlan(hevc, { ...chrome, canPlayFile: false })
  assert.equal(plan.via, 'none')
  /* A black rectangle with a scrubber that never moves is worse than saying
     what happened, which is what the caller does with this. */
  assert.equal(plan.src, '')
})

test('a film with nothing stored at all is nothing to play', () => {
  assert.equal(playbackPlan({}, safari).via, 'none')
  assert.equal(playbackPlan({ src: '', hlsSrc: '' }, safari).via, 'none')
})

test('a stream is preferred even when the file would also play', () => {
  /* The whole point: somebody walking out of hotel wifi drops to a smaller
     picture instead of stopping. Picking the file because it happens to be
     decodable would throw that away silently. */
  assert.equal(playbackPlan(film, chrome).via, 'hls.js')
  assert.notEqual(playbackPlan(film, chrome).src, film.src)
})

test('what a browser can do is asked of it, not guessed from its name', () => {
  const said = types => type => (types.includes(type) ? 'probably' : '')

  const apple = browserPowers(said(['application/vnd.apple.mpegurl']), 'video/mp4')
  assert.equal(apple.nativeHls, true)

  // Older Safari answers to the x- spelling; either yes means it plays.
  const older = browserPowers(said(['application/x-mpegURL']), 'video/mp4')
  assert.equal(older.nativeHls, true)

  const none = browserPowers(said([]), 'video/mp4')
  assert.equal(none.nativeHls, false)
  assert.equal(none.canPlayFile, false, 'an empty answer is the browser saying no')

  // No type to ask about is a maybe, not a no: refusing to try is worse.
  assert.equal(browserPowers(said([]), null).canPlayFile, true)
})

test('a probe that throws is a maybe rather than a crash', () => {
  const powers = browserPowers(() => {
    throw new Error('this webview has opinions')
  }, 'video/mp4')
  assert.equal(powers.nativeHls, false)
  assert.equal(powers.canPlayFile, false)
})
