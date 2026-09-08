import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  alreadyPlayable,
  posterFrame,
  probe,
  scaleFilter,
  toPlayableMp4,
} from '../src/transcode.js'

const ffmpegHere = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' })
const skip = ffmpegHere.status === 0 ? false : 'ffmpeg is not installed on this machine'

/** A real film, made here: colour bars and a tone, in whatever shape is asked. */
function film(path, { seconds = 1, size = '320x240', video = 'libx264', audio = 'aac' } = {}) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=${size}:rate=15:duration=${seconds}`,
      ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`] : []),
      '-c:v',
      video,
      ...(audio ? ['-c:a', audio] : ['-an']),
      '-pix_fmt',
      'yuv420p',
      path,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, `could not build the fixture: ${result.stderr}`)
  return path
}

test('what a file actually contains is read from the bytes, not the name', { skip }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'offwego-probe-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const facts = await probe(film(join(dir, 'clip.mp4'), { seconds: 1, size: '640x480' }))
  assert.equal(facts.videoCodec, 'h264')
  assert.equal(facts.audioCodec, 'aac')
  assert.equal(facts.width, 640)
  assert.equal(facts.height, 480)
  assert.ok(facts.durationMs >= 900 && facts.durationMs <= 1200, `got ${facts.durationMs}ms`)
  assert.match(facts.container, /mp4/)
})

test('a film already playable everywhere is left exactly as it was filmed', { skip }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'offwego-keep-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const mp4 = await probe(film(join(dir, 'fine.mp4')))
  assert.equal(alreadyPlayable(mp4), true, 'h264+aac in mp4 needs no conversion')

  /* The case the whole feature exists for: an iPhone's HEVC. Chrome and
     Android decline it, so it has to be converted however well it plays on
     the phone that filmed it. */
  assert.equal(
    alreadyPlayable({
      videoCodec: 'hevc',
      audioCodec: 'aac',
      container: 'mov,mp4,m4a',
      rotation: 0,
    }),
    false,
  )
  // Same codecs, but a container browsers refuse to open.
  assert.equal(
    alreadyPlayable({ videoCodec: 'h264', audioCodec: 'aac', container: 'avi', rotation: 0 }),
    false,
  )
  // A rotation tag is what naive players drop, showing the film on its side.
  assert.equal(
    alreadyPlayable({ videoCodec: 'h264', audioCodec: 'aac', container: 'mp4', rotation: 90 }),
    false,
  )
  // Audio nobody can decode is still a reason to convert.
  assert.equal(
    alreadyPlayable({ videoCodec: 'h264', audioCodec: 'pcm_s16le', container: 'mp4', rotation: 0 }),
    false,
  )
})

test('a film only one make of phone can play becomes one they all can', { skip }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'offwego-convert-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  /* mpeg4 in an avi stands in for the HEVC-in-mov case: a real file, in a
     shape no browser will play, that ffmpeg on this machine can produce. */
  const source = film(join(dir, 'phone.avi'), { seconds: 1, video: 'mpeg4', audio: 'ac3' })
  const before = await probe(source)
  assert.equal(alreadyPlayable(before), false)

  const target = join(dir, 'out.mp4')
  const after = await toPlayableMp4({ source, target, facts: before })

  assert.equal(after.videoCodec, 'h264')
  assert.equal(after.audioCodec, 'aac')
  assert.match(after.container, /mp4/)
  assert.ok(after.bytes > 0)
  assert.equal(alreadyPlayable(after), true, 'the point of the exercise')
})

test('an oversized film is brought down to something a phone can decode', { skip }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'offwego-scale-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  // 4K lands as 1080p; the long edge is what is capped, whichever it is.
  assert.equal(scaleFilter(3840, 2160), 'scale=1920:-2')
  assert.equal(scaleFilter(2160, 3840), 'scale=-2:1920')
  assert.equal(scaleFilter(1280, 720), null, 'already small enough to leave alone')
  assert.equal(scaleFilter(0, 0), null)

  const source = film(join(dir, 'big.mp4'), { seconds: 1, size: '2560x1440', video: 'mpeg4' })
  const after = await toPlayableMp4({ source, target: join(dir, 'small.mp4') })
  assert.equal(after.width, 1920)
  assert.equal(after.height, 1080, 'and the aspect ratio survives, evenly')
})

test('the poster is drawn on the server, for films no phone could decode', { skip }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'offwego-poster-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const source = film(join(dir, 'clip.mp4'), { seconds: 2 })
  const poster = join(dir, 'poster.jpg')
  await posterFrame({ source, target: poster, durationMs: 2000 })
  assert.ok((await stat(poster)).size > 0)

  /* A clip shorter than the frame we would rather have: seeking past the end
     yields nothing, so the ask has to be clamped inside the film. */
  const brief = film(join(dir, 'brief.mp4'), { seconds: 1 })
  const second = join(dir, 'brief.jpg')
  await posterFrame({ source: brief, target: second, atMs: 5000, durationMs: 1000 })
  assert.ok((await stat(second)).size > 0, 'a one-second clip still gives up a frame')
})

test('a file that is not a film at all fails loudly, with ffmpeg’s own words', {
  skip,
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'offwego-bad-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { writeFile } = await import('node:fs/promises')
  const notAFilm = join(dir, 'nope.mp4')
  await writeFile(notAFilm, 'this is not a video')

  await assert.rejects(probe(notAFilm), error => {
    /* The diagnosis has to survive the throw: without the tail of stderr a
       conversion failure is just "it didn't work", which is unanswerable at
       three in the morning. */
    assert.ok(String(error.stderr || '').length > 0, 'ffprobe said why and we kept it')
    return true
  })
})
