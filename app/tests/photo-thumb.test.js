import assert from 'node:assert/strict'
import test from 'node:test'
import { photoThumbnail, THUMB_EDGE, thumbSize } from '../src/photo-thumb-core.ts'

/* The app died on a selection of thirty or more, and it was the looking
   rather than the sending: a browser decodes what it draws at the size the
   file is, not at the size of the tile, so thirty hundred-pixel tiles cost
   thirty full-size bitmaps. */

const drawnCanvas = (width, height, { blob = new Blob(['jpeg']) } = {}) => {
  const drew = []
  return {
    width,
    height,
    drew,
    getContext: () => ({
      drawImage: (...args) => drew.push(args),
    }),
    toBlob: done => done(blob),
  }
}

test('a tile keeps the picture shape and is measured on its long edge', () => {
  assert.deepEqual(thumbSize(4000, 3000), { width: 320, height: 240 })
  assert.deepEqual(thumbSize(3000, 4000), { width: 240, height: 320 })
})

test('a picture already smaller than a tile is left alone rather than blown up', () => {
  assert.deepEqual(thumbSize(120, 90), { width: 120, height: 90 })
})

test('nonsense dimensions make no tile at all', () => {
  for (const [w, h] of [
    [0, 100],
    [100, 0],
    [Number.NaN, 100],
    [-10, -10],
  ])
    assert.deepEqual(thumbSize(w, h), { width: 0, height: 0 })
})

test('a thumbnail is drawn at the reduced size, not at the picture size', async () => {
  let canvas = null
  const blob = await photoThumbnail(new Blob(['big']), {
    decode: async () => ({ width: 4032, height: 3024, close() {} }),
    createCanvas: (width, height) => {
      canvas = drawnCanvas(width, height)
      return canvas
    },
  })

  assert.ok(blob, 'a tile came back')
  assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 320, height: 240 })
  assert.deepEqual(canvas.drew[0].slice(1), [0, 0, 320, 240])
})

test('the full-size bitmap is closed, which is the whole point', async () => {
  /* One at a time and let go of, or thirty of them are alive together and the
     tab is gone before anything has been sent. */
  let closed = 0
  await photoThumbnail(new Blob(['big']), {
    decode: async () => ({
      width: 4032,
      height: 3024,
      close() {
        closed += 1
      },
    }),
    createCanvas: (width, height) => drawnCanvas(width, height),
  })
  assert.equal(closed, 1)
})

test('the bitmap is closed even when nothing can be drawn with it', async () => {
  let closed = 0
  const decoded = {
    width: 4032,
    height: 3024,
    close() {
      closed += 1
    },
  }
  const thumb = await photoThumbnail(new Blob(['big']), {
    decode: async () => decoded,
    createCanvas: () => {
      throw new Error('no canvas today')
    },
  })
  assert.equal(thumb, null)
  assert.equal(closed, 1)
})

test('a file the browser will not open gives back nothing, not an exception', async () => {
  const thumb = await photoThumbnail(new Blob(['not a picture']), {
    decode: async () => {
      throw new Error('unsupported')
    },
    createCanvas: (width, height) => drawnCanvas(width, height),
  })
  assert.equal(thumb, null)
})

test('a browser with no decoder at all is a browser that draws the file itself', async () => {
  // Which is the old behaviour, and was never the problem for one or two.
  assert.equal(await photoThumbnail(new Blob(['picture'])), null)
})

test('a picture with no usable size makes no tile', async () => {
  const thumb = await photoThumbnail(new Blob(['empty']), {
    decode: async () => ({ width: 0, height: 0 }),
    createCanvas: (width, height) => drawnCanvas(width, height),
  })
  assert.equal(thumb, null)
})

test('the tile edge is one number, so the sheet and the bar agree', () => {
  assert.equal(THUMB_EDGE, 320)
  assert.equal(Math.max(...Object.values(thumbSize(9000, 100))), THUMB_EDGE)
})

/* ---- when a HEIC becomes a JPEG ------------------------------------------

   Thirty photographs off an iPhone used to be thirty HEIC decodes and thirty
   JPEG encodes, in WebAssembly, back to back, with every result held — all of
   it after the Add button and before the first request went out, which is
   exactly where "it crashes during the upload" came from. */

const photos = await import('../src/mobile-photos-core.ts')

const heicFile = (name = 'IMG_0001.HEIC') =>
  Object.assign(new File([new Uint8Array([0, 0, 0, 24])], name, { type: 'image/heic' }))

const converter = () => {
  let converted = 0
  return {
    converted: () => converted,
    isHeic: async () => true,
    convertHeic: async () => {
      converted += 1
      return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
    },
  }
}

test('reading a selection reads the header and converts nothing', async () => {
  const many = Array.from({ length: 30 }, (_, index) => heicFile(`IMG_${index}.HEIC`))
  const read = await photos.readPhotoFiles(many, { parseExif: async () => ({}) })

  assert.equal(read.length, 30)
  // Still HEIC, every one of them: nothing has been decoded yet.
  assert.deepEqual([...new Set(read.map(file => file.type))], ['image/heic'])
})

test('a HEIC is turned into a JPEG when it is sent, one file at a time', async () => {
  const heic = converter()
  const ready = await photos.readyToSend(heicFile(), heic)

  assert.equal(heic.converted(), 1)
  assert.equal(ready.type, 'image/jpeg')
  assert.equal(ready.name, 'IMG_0001.jpg')
})

test('anything that is not a HEIC is handed straight back, untouched', async () => {
  const heic = converter()
  const jpeg = new File([new Uint8Array([0xff, 0xd8])], 'holiday.jpg', { type: 'image/jpeg' })
  assert.equal(await photos.readyToSend(jpeg, heic), jpeg)
  assert.equal(heic.converted(), 0, 'it opened a decoder for a JPEG')
})

test('a conversion that fails sends the original rather than sending nothing', async () => {
  /* The server refusing one photograph with a message a person can read beats
     the app quietly dropping it. */
  const file = heicFile()
  const back = await photos.readyToSend(file, {
    isHeic: async () => true,
    convertHeic: async () => {
      throw new Error('out of memory')
    },
  })
  assert.equal(back, file)
})

test('the metadata read off the original survives the conversion', async () => {
  const file = heicFile()
  Object.defineProperty(file, 'offwegoMetadata', {
    value: { lat: 57.6, lng: -5.4, takenAt: '2026-09-14T09:00:00.000Z' },
    enumerable: false,
    configurable: true,
  })
  const ready = await photos.readyToSend(file, converter())
  assert.deepEqual(ready.offwegoMetadata, {
    lat: 57.6,
    lng: -5.4,
    takenAt: '2026-09-14T09:00:00.000Z',
  })
})
