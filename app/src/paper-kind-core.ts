/* What a document gets drawn as, and how big.
 *
 * The viewer used to ask `mime.includes('pdf')` and, when that was false and
 * the mime was not an image, give up: "this one is a file — it opens in its
 * own viewer", over a black screen, with the filename repeated as a link out
 * of the app. A ticket is very often a PDF, so the commonest document in the
 * app got the screen that does nothing.
 */

export type PaperKind = 'image' | 'pdf' | 'file'

/* A canvas this app will ask a phone for. Chrome gives up somewhere past
   16 megapixels and hands back a blank one rather than an error, which on this
   screen is indistinguishable from a document that would not load. */
export const MAX_PAGE_PIXELS = 4_000_000
/* Past this there is nothing left to see: the page is already sharper than the
   glass. A stamp-sized page blown up 30x is only a bigger blur. */
export const MAX_PAGE_SCALE = 4

const PDF_TYPE = /(^|\/)(x-)?pdf$/i
const PDF_NAME = /\.pdf$/i

/**
 * An image, a PDF, or something we can only hand over.
 *
 * The type is asked first and the name second, because plenty of real
 * attachments arrive as application/octet-stream — or as nothing at all — with
 * the answer sitting in the filename. Being wrong here costs somebody their
 * document at a desk, and a name is better evidence than no evidence.
 */
export function paperKind(mime?: string | null, name?: string | null): PaperKind {
  const type = String(mime || '')
    .trim()
    .toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (PDF_TYPE.test(type)) return 'pdf'
  if (PDF_NAME.test(String(name || '').trim())) return 'pdf'
  return 'file'
}

/**
 * How far to magnify a page so it fills the sheet on this screen.
 *
 * Drawn at the device's own pixel density, because anything less is a soft
 * barcode and a scanner that beeps twice — then held under two ceilings, one
 * for what a browser will allocate and one for what an eye can use.
 */
export function pageScale(
  page: { width: number; height: number },
  sheetWidth: number,
  ratio = 1,
  maxPixels = MAX_PAGE_PIXELS,
): number {
  const width = Number(page?.width)
  const height = Number(page?.height)
  const across = Number(sheetWidth) * (Number(ratio) || 1)
  /* A page that will not say how big it is still has to draw. 1 is the PDF's
     own idea of its size, which is at least a document-shaped thing. */
  if (!(width > 0) || !(height > 0) || !(across > 0)) return 1

  const fit = Math.min(across / width, MAX_PAGE_SCALE)
  const budget = Math.sqrt(maxPixels / (width * height))
  return Math.min(fit, budget)
}
