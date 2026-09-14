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
