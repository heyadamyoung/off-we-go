/* Which copy of a photograph to draw, and what to look at while the better
 * one is still coming.
 *
 * The server has made two of every picture since uploads began — a display
 * copy 2048 across and a small one 480 across — and sends a link to each. The
 * app was drawing the display copy everywhere: in a grid of sixty tiles, on a
 * map marker forty pixels wide, in the little strip along the bottom of the
 * viewer. Ten times the bytes for a picture nobody can see the detail of, and
 * all of it over the same phone connection the photograph somebody IS looking
 * at has to come down. That is the whole reason a swipe looked like it was
 * fetching: it was — behind sixty thumbnails that were each a megapixel.
 *
 * So: small boxes get the small copy. And a big box that has no picture yet
 * borrows the small copy if that one is already on the screen somewhere,
 * which is what makes the next photograph appear the instant you swipe to it
 * rather than a second later. It sharpens when the real one lands; that swap
 * is invisible, because the two are the same photograph.
 */

export interface MediaCopies {
  /** The one to look at. */
  src?: string | null
  /** The small one, when the server made it. Older rows have none. */
  thumbSrc?: string | null
}

/** Boxes no bigger than this are drawn from the small copy. */
export const SMALL_BOX = 640

/**
 * The copy a box this size should end up showing.
 *
 * Measured against the longest side asked for, and generous about it: the
 * small copy is 480 across, so a 640 box still has more pixels than it needs
 * on the phones this is for. Falls back rather than returning nothing — a row
 * with only one of the two is normal, both before thumbnails existed and for
 * a film's poster frame.
 */
export function copyFor(copies: MediaCopies, box: number, small = SMALL_BOX): string | null {
  const { src, thumbSrc } = copies
  if (thumbSrc && box <= small) return thumbSrc
  return src || thumbSrc || null
}

export interface Drawn {
  /** What goes in the element now. */
  show: string
  /** The better one, to fetch quietly and swap to when it lands. */
  better?: string
}

/**
 * What to draw right now for a box this size.
 *
 * `seen` answers whether a URL has already been loaded in this tab, which is
 * the only thing that makes standing in worth doing: a small copy that is
 * itself a fetch away would paint no sooner than the real one and cost an
 * extra request. Having come down for the grid, it is free and instant.
 */
export function drawn(
  copies: MediaCopies,
  box: number,
  seen: (url: string) => boolean,
  small = SMALL_BOX,
): Drawn | null {
  const want = copyFor(copies, box, small)
  if (!want) return null
  if (seen(want)) return { show: want }
  const stand = copies.thumbSrc
  if (stand && stand !== want && seen(stand)) return { show: stand, better: want }
  return { show: want }
}
