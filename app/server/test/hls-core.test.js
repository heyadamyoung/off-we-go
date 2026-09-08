import test from 'node:test'
import assert from 'node:assert/strict'
import {
  displaySize,
  hlsDirectory,
  playlistReferences,
  renditionLadder,
  resolveUri,
  rungScale,
  signPlaylist,
  videoKbps,
} from '../src/hls.js'

const sizes = ladder => ladder.map(rung => `${rung.width}x${rung.height}`)
const rates = ladder => ladder.map(rung => rung.videoKbps)

test('a film is published at the sizes it was filmed at, and no larger', () => {
  const phone = renditionLadder({ width: 1920, height: 1080, videoKbps: 10_000 })
  assert.deepEqual(sizes(phone), ['1920x1080', '1280x720', '854x480', '640x360'])

  /* A 4K film is not published at 4K. Past 1080 the extra pixels are not
     visible on the thing people watch trips on and are somebody's data
     allowance instead. */
  const big = renditionLadder({ width: 3840, height: 2160, videoKbps: 40_000 })
  assert.equal(big[0].height, 1080)

  // And nothing is ever upscaled: that is minutes of CPU for the same picture.
  const small = renditionLadder({ width: 640, height: 360, videoKbps: 1200 })
  assert.deepEqual(sizes(small), ['640x360'])
  const middling = renditionLadder({ width: 854, height: 480, videoKbps: 2000 })
  assert.deepEqual(sizes(middling), ['854x480', '640x360'])
})

test('a film filmed in portrait is published in portrait', () => {
  const native = renditionLadder({ width: 1080, height: 1920, videoKbps: 12_000 })
  assert.deepEqual(sizes(native), ['1080x1920', '720x1280', '480x854', '360x640'])

  /* A phone filming upright writes landscape frames plus a quarter turn, and
     anything that reads the frames without the tag builds a ladder of films
     lying on their side. */
  const tagged = renditionLadder({ width: 1920, height: 1080, rotation: -90, videoKbps: 12_000 })
  assert.deepEqual(sizes(tagged), sizes(native))
  assert.deepEqual(rates(tagged), rates(native))
})

test('the top rung is the film itself, not the nearest label under it', () => {
  const odd = renditionLadder({ width: 1600, height: 900, videoKbps: 6000 })
  assert.equal(odd[0].height, 900, 'somebody who filmed at 900 should be watching 900')
  assert.deepEqual(sizes(odd).slice(1), ['1280x720', '854x480', '640x360'])
})

test('a ladder never spends more bits than the film was filmed with', () => {
  const thin = renditionLadder({ width: 1920, height: 1080, videoKbps: 1500 })
  assert.ok(
    thin[0].videoKbps <= 1500 * 1.2,
    `re-encoding a 1.5 Mbit film at ${thin[0].videoKbps} would store its artefacts in higher fidelity`,
  )
  // Still a ladder, though: the rungs fall away from each other as they should.
  for (let index = 1; index < thin.length; index++) {
    assert.ok(thin[index].videoKbps < thin[index - 1].videoKbps)
  }
})

test('rungs a player could not choose between are not published', () => {
  /* A film shot at a very low bitrate has every size pressed against the same
     floor. Publishing three renditions that cost the same is three encodes,
     three times the storage, and one decision the player still cannot make. */
  const starved = renditionLadder({ width: 1280, height: 720, videoKbps: 220 })
  assert.equal(starved.length, 1, `expected one rung, got ${rates(starved).join(', ')}`)
  assert.equal(starved[0].height, 720, 'and it is the film, at its own size')

  const healthy = renditionLadder({ width: 1280, height: 720, videoKbps: 4000 })
  assert.ok(healthy.length > 1)
  for (let index = 1; index < healthy.length; index++) {
    assert.ok(
      healthy[index].videoKbps <= healthy[index - 1].videoKbps * 0.75,
      'every rung is meaningfully cheaper than the one above it',
    )
  }
})

test('the rungs are named for the directories ffmpeg will actually write', () => {
  /* ffmpeg substitutes %v with the variant index. A name of anything else and
     the encoder writes one tree while the upload looks in another — which
     fails as an empty stream rather than as an error. */
  const ladder = renditionLadder({ width: 1920, height: 1080, videoKbps: 9000 })
  assert.deepEqual(
    ladder.map(rung => rung.name),
    ['0', '1', '2', '3'],
  )
})

test('every rung has even dimensions, which H.264 cannot do without', () => {
  for (const source of [
    { width: 1921, height: 1081, videoKbps: 9000 },
    { width: 1023, height: 767, videoKbps: 4000 },
    { width: 641, height: 361, videoKbps: 1500 },
  ]) {
    for (const rung of renditionLadder(source)) {
      assert.equal(rung.width % 2, 0, `${rung.width}x${rung.height} has an odd width`)
      assert.equal(rung.height % 2, 0, `${rung.width}x${rung.height} has an odd height`)
    }
  }
})

test('a file with no video makes no ladder at all', () => {
  assert.deepEqual(renditionLadder({}), [])
  assert.deepEqual(renditionLadder({ width: 0, height: 0 }), [])
  assert.deepEqual(renditionLadder(null), [])
})

test('the scale filter sizes the edge that decides quality', () => {
  assert.equal(rungScale({ width: 1280, height: 720, shortEdge: 720 }), 'scale=-2:720')
  assert.equal(rungScale({ width: 720, height: 1280, shortEdge: 720 }), 'scale=720:-2')
})

test('display size is what the rotation tag says, not what the frames say', () => {
  assert.deepEqual(displaySize({ width: 1920, height: 1080 }), { width: 1920, height: 1080 })
  assert.deepEqual(displaySize({ width: 1920, height: 1080, rotation: 90 }), {
    width: 1080,
    height: 1920,
  })
  assert.deepEqual(displaySize({ width: 1920, height: 1080, rotation: -270 }), {
    width: 1080,
    height: 1920,
  })
  assert.deepEqual(displaySize({ width: 1920, height: 1080, rotation: 180 }), {
    width: 1920,
    height: 1080,
  })
  assert.equal(displaySize({ width: 0, height: 0 }), null)
})

test('bitrate falls with size and stays inside its bounds', () => {
  assert.ok(videoKbps(1080) > videoKbps(720))
  assert.ok(videoKbps(720) > videoKbps(360))
  assert.ok(videoKbps(100_000) <= 5000, 'never more than the ceiling')
  assert.ok(videoKbps(1) >= 250, 'never so little that it is unwatchable')
})

/* ---- playlists -------------------------------------------------------- */

const MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=3000800,RESOLUTION=1280x720
0/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1005400,RESOLUTION=640x360
1/index.m3u8
`

const link = path => `https://example.test/api/media/${path}?signature=abc`

test('every link in a playlist comes out signed, and nothing else changes', () => {
  const signed = signPlaylist(MASTER, 'trip/film.hls/', link)
  assert.match(signed, /#EXT-X-STREAM-INF:BANDWIDTH=3000800,RESOLUTION=1280x720/)
  assert.match(signed, /^https:\/\/example\.test\/api\/media\/trip\/film\.hls\/0\/index\.m3u8\?/m)
  assert.match(signed, /^https:\/\/example\.test\/api\/media\/trip\/film\.hls\/1\/index\.m3u8\?/m)
  /* Players do not carry a playlist's query string down to what it names —
     neither hls.js nor Safari — so a relative name left in here is every
     segment refused and a film that simply never starts. */
  assert.doesNotMatch(signed, /^0\/index\.m3u8$/m)
})

test('a link inside a tag is signed too, not just a bare line', () => {
  const withMap = `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",URI="audio/index.m3u8"
#EXTINF:4.000,
seg00000.ts
`
  const signed = signPlaylist(withMap, 'trip/film.hls/0/', link)
  assert.match(signed, /URI="https:\/\/example\.test\/api\/media\/trip\/film\.hls\/0\/init\.mp4\?/)
  assert.match(
    signed,
    /URI="https:\/\/example\.test\/api\/media\/trip\/film\.hls\/0\/audio\/index\.m3u8\?/,
  )
  assert.match(signed, /^https:\/\/example\.test\/api\/media\/trip\/film\.hls\/0\/seg00000\.ts\?/m)
})

test('a playlist cannot be made to point outside its own film', () => {
  assert.equal(resolveUri('trip/film.hls/0/', 'seg1.ts'), 'trip/film.hls/0/seg1.ts')
  assert.equal(resolveUri('trip/film.hls/0/', '../1/seg1.ts'), 'trip/film.hls/1/seg1.ts')
  /* Climbing out of the media root is a bug or an attack, never a URI: these
     files are ones this server wrote. */
  assert.equal(resolveUri('trip/', '../../etc/passwd'), null)
  assert.equal(resolveUri('trip/', '/etc/passwd'), null)
  assert.equal(resolveUri('trip/', 'https://elsewhere.test/x.ts'), null)
  assert.equal(resolveUri('trip/', '//elsewhere.test/x.ts'), null)
  assert.equal(resolveUri('trip/', ''), null)

  // And one that escapes is left exactly as it was rather than signed.
  const hostile = signPlaylist('#EXTM3U\n../../../etc/passwd\n', 'trip/film.hls/', link)
  assert.match(hostile, /^\.\.\/\.\.\/\.\.\/etc\/passwd$/m)
})

test('a playlist names everything it depends on, for the sweep', () => {
  assert.deepEqual(playlistReferences(MASTER, 'trip/film.hls/'), [
    'trip/film.hls/0/index.m3u8',
    'trip/film.hls/1/index.m3u8',
  ])
})

test('a stream lives beside the film it came from', () => {
  assert.equal(hlsDirectory('trip/abc.converted.mp4'), 'trip/abc.converted.hls')
  assert.equal(hlsDirectory('trip/abc.mov'), 'trip/abc.hls')
  // A name with no extension still gets one directory rather than none.
  assert.equal(hlsDirectory('trip/abc'), 'trip/abc.hls')
})
