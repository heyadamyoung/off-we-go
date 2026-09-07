import assert from 'node:assert/strict'
import test from 'node:test'
import {
  durationLabel,
  isVideoFile,
  posterSize,
  posterTime,
  videoMetadata,
  videoMimeFor,
  videoStill,
  withVideoMime,
} from '../src/mobile-videos-core.ts'
import { photoUploadMetadata } from '../src/mobile-photos-core.ts'

const file = (name, type, { lastModified = 0 } = {}) =>
  new File([new Uint8Array([0, 1, 2, 3])], name, { type, lastModified })

test('a film is recognised by its type, and by its name when the picker lies', () => {
  assert.equal(isVideoFile(file('IMG_1.mp4', 'video/mp4')), true)
  assert.equal(isVideoFile(file('IMG_2.MOV', 'video/quicktime')), true)
  // Android hands over a perfectly good mp4 with no usable type at all.
  assert.equal(isVideoFile(file('IMG_3.mp4', 'application/octet-stream')), true)
  assert.equal(isVideoFile(file('IMG_4.jpg', 'image/jpeg')), false)
  assert.equal(isVideoFile(file('notes.pdf', 'application/pdf')), false)
  assert.equal(isVideoFile(null), false)
})

test('a mistyped film is re-labelled so the server can name it, and no other is touched', () => {
  const mistyped = file('holiday.mp4', 'application/octet-stream')
  const corrected = withVideoMime(mistyped)
  assert.equal(corrected.type, 'video/mp4')
  assert.equal(corrected.name, 'holiday.mp4')

  const already = file('holiday.mov', 'video/quicktime')
  assert.equal(withVideoMime(already), already, 'a correct file is not copied for nothing')
  const photo = file('holiday.jpg', 'image/jpeg')
  assert.equal(withVideoMime(photo), photo)

  assert.equal(videoMimeFor(file('clip.webm', '')), 'video/webm')
  assert.equal(videoMimeFor(file('clip.3gp', '')), 'video/3gpp')
})

test('the poster is drawn past the opening blur, and never larger than it needs to be', () => {
  // A second in, where the phone has stopped being raised.
  assert.equal(posterTime(30), 1)
  // Shorter than that, its middle rather than a frame that does not exist.
  assert.equal(posterTime(0.6), 0.3)
  assert.equal(posterTime(Number.NaN), 0)

  assert.deepEqual(posterSize(3840, 2160), { width: 1280, height: 720 })
  assert.deepEqual(posterSize(640, 480), { width: 640, height: 480 }, 'never enlarged')
  assert.deepEqual(posterSize(0, 0), { width: 0, height: 0 })
})

test('a film with no capture time is dated by when the phone wrote it', () => {
  const written = Date.UTC(2027, 5, 4, 13, 20)
  assert.deepEqual(videoMetadata(file('a.mp4', 'video/mp4', { lastModified: written })), {
    takenAt: new Date(written).toISOString(),
  })

  // A real capture time from the picker always wins over the file stamp.
  const known = file('b.mp4', 'video/mp4', { lastModified: written })
  Object.defineProperty(known, 'offwegoMetadata', {
    value: { takenAt: '2027-01-01T00:00:00.000Z' },
  })
  assert.equal(videoMetadata(known).takenAt, '2027-01-01T00:00:00.000Z')

  assert.equal(videoMetadata(file('c.mp4', 'video/mp4', { lastModified: 0 })), null)
})

test('a length reads the way a camera roll writes it', () => {
  assert.equal(durationLabel(12_500), '0:12')
  assert.equal(durationLabel(67_000), '1:07')
  assert.equal(durationLabel(3_723_000), '1:02:03')
  assert.equal(durationLabel(null), null)
  assert.equal(durationLabel(-1), null)
})

/* A decoder made of plain objects: enough surface for the still to drive, so
   the drawing can be tested without a codec in the room. */
function fakeVideo({ duration = 20, width = 1920, height = 1080, fails = false } = {}) {
  const video = {
    duration,
    videoWidth: width,
    videoHeight: height,
    currentTime: 0,
    onloadedmetadata: null,
    onloadeddata: null,
    onseeked: null,
    onerror: null,
    load() {},
  }
  /* A decoder's real order: metadata, then the first frame, and `seeked` only
     when the position actually moved — which is the whole point of the
     no-duration case below. */
  Object.defineProperty(video, 'src', {
    set(value) {
      if (!value) return
      queueMicrotask(() => {
        if (fails) return video.onerror?.()
        const before = video.currentTime
        video.onloadedmetadata?.()
        queueMicrotask(() => {
          video.onloadeddata?.()
          if (video.currentTime !== before) queueMicrotask(() => video.onseeked?.())
        })
      })
    },
    get() {
      return ''
    },
    configurable: true,
  })
  return video
}

const fakeCanvas = blob => (width, height) => ({
  width,
  height,
  getContext: () => ({ drawImage() {} }),
  toBlob: done => done(blob),
})

test('the opening frame becomes a JPEG to send beside the film, with its length', async () => {
  const still = await videoStill(file('IMG_9.mp4', 'video/mp4', { lastModified: 42 }), {
    createVideo: () => fakeVideo({ duration: 12.5 }),
    createCanvas: fakeCanvas(new Blob(['jpeg'], { type: 'image/jpeg' })),
  })
  assert.equal(still.durationMs, 12_500)
  assert.equal(still.width, 1920)
  assert.equal(still.poster.name, 'IMG_9.poster.jpg')
  assert.equal(still.poster.type, 'image/jpeg')
  assert.equal(still.poster.lastModified, 42)
})

test('a film with no seekable length is drawn from the frame it already has', async () => {
  /* A video recorded rather than saved — the shape a MediaRecorder produces —
     reports Infinity for its length, so there is nothing to seek to. Asking
     for the position it already sits at fires no `seeked` event at all, and
     waiting for one is how the upload sheet hangs for eight seconds. */
  const recorded = await videoStill(file('recorded.webm', 'video/webm'), {
    createVideo: () => fakeVideo({ duration: Number.POSITIVE_INFINITY }),
    createCanvas: fakeCanvas(new Blob(['jpeg'], { type: 'image/jpeg' })),
    timeoutMs: 50,
  })
  assert.ok(recorded.poster, 'a film with no length still deserves a picture')
  assert.equal(recorded.durationMs, null)

  // Shorter than the blur window: its middle, which is a real seek.
  const brief = await videoStill(file('brief.mp4', 'video/mp4'), {
    createVideo: () => fakeVideo({ duration: 0.8 }),
    createCanvas: fakeCanvas(new Blob(['jpeg'], { type: 'image/jpeg' })),
    timeoutMs: 50,
  })
  assert.ok(brief.poster)
  assert.equal(brief.durationMs, 800)
})

test('a codec this browser does not have costs the poster, never the upload', async () => {
  const refused = await videoStill(file('IMG_8.mkv', 'video/x-matroska'), {
    createVideo: () => fakeVideo({ fails: true }),
    createCanvas: fakeCanvas(new Blob(['jpeg'])),
  })
  assert.deepEqual(refused, { poster: null, durationMs: null, width: null, height: null })

  // A canvas that will not hand over bytes still yields the length, which is
  // worth having: the grid can say 0:12 under the play mark.
  const noBlob = await videoStill(file('IMG_7.mp4', 'video/mp4'), {
    createVideo: () => fakeVideo({ duration: 3 }),
    createCanvas: fakeCanvas(null),
  })
  assert.equal(noBlob.poster, null)
  assert.equal(noBlob.durationMs, 3000)

  // A decoder that answers nothing at all must not hold the sheet for ever.
  const hung = await videoStill(file('IMG_6.mp4', 'video/mp4'), {
    createVideo: () => ({ load() {}, src: '' }),
    createCanvas: fakeCanvas(null),
    timeoutMs: 20,
  })
  assert.equal(hung.durationMs, null)
})

test('only a film carries a poster and a length into the upload', () => {
  const poster = file('a.poster.jpg', 'image/jpeg')
  const film = photoUploadMetadata(
    { file: file('a.mp4', 'video/mp4'), poster, durationMs: 8000, stopId: null },
    { by: 'Ada', nextSequence: 3 },
  )
  assert.equal(film.kind, 'video')
  assert.equal(film.poster, poster)
  assert.equal(film.durationMs, 8000)

  const photo = photoUploadMetadata(
    { file: file('a.jpg', 'image/jpeg'), poster, durationMs: 8000, stopId: null },
    { by: 'Ada', nextSequence: 3 },
  )
  assert.equal(photo.kind, undefined)
  assert.equal(photo.poster, undefined)
  assert.equal(photo.durationMs, undefined)
})
