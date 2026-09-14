/* A small picture to look at, so a phone is never holding thirty large ones.

   Reported as the app dying on a selection of thirty or more. Nothing was
   wrong with the sending: it was the looking. The sheet drew every chosen
   photograph at its own size — a dozen megapixels each — and a browser
   decodes what it draws, whatever size the tile is. Thirty hundred-pixel
   tiles therefore cost thirty full-size bitmaps, better than a gigabyte of
   them, all alive at once because they are all on screen. Then the upload bar
   drew the same thirty again at nine and thirty.

   So each file is decoded once, when it is chosen, drawn down to a tile-sized
   JPEG, and the full-size bitmap is closed before the next one is opened. One
   at a time, for the same reason the films already are: a handful of 4K
   decodes running together is how a phone's tab runs out of memory in the
   middle of choosing. Everything downstream looks at the small one.

   A browser that will not decode gets null rather than an exception, and the
   sheet falls back to drawing the file itself — which is the old behaviour,
   and was never the problem for one or two. */

/** Wide enough for a retina tile in the grid, small enough to forget about. */
export const THUMB_EDGE = 320

/** The tile's size, keeping the picture's own shape. Same rule as a poster. */
export function thumbSize(width: number, height: number, edge: number = THUMB_EDGE) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 }
  const scale = Math.min(1, edge / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

interface Decoded {
  width: number
  height: number
  close?: () => void
}

export interface ThumbOptions {
  /** Injected so this can be tested without a decoder in the room. */
  decode?: (blob: Blob) => Promise<Decoded>
  /** Injected the same way; a real canvas needs a document to come from. */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement
  edge?: number
}

export async function photoThumbnail(
  file: Blob,
  { decode, createCanvas, edge = THUMB_EDGE }: ThumbOptions = {},
): Promise<Blob | null> {
  const decoder =
    decode ||
    (typeof createImageBitmap === 'function'
      ? (blob: Blob) => createImageBitmap(blob) as Promise<Decoded>
      : null)
  if (!decoder) return null
  let decoded: Decoded | null = null
  try {
    decoded = await decoder(file)
    const { width, height } = thumbSize(decoded.width, decoded.height, edge)
    if (!width || !height) return null
    const canvas = createCanvas
      ? createCanvas(width, height)
      : typeof document === 'undefined'
        ? null
        : Object.assign(document.createElement('canvas'), { width, height })
    const context = canvas?.getContext('2d')
    if (!canvas || !context || typeof canvas.toBlob !== 'function') return null
    context.drawImage(decoded as unknown as CanvasImageSource, 0, 0, width, height)
    return await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.72)
    })
  } catch {
    // A format this browser cannot open is not an error worth stopping for.
    return null
  } finally {
    // The whole point: the big one goes before the next one is opened.
    decoded?.close?.()
  }
}
