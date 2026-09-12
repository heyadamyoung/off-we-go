/* Handing one photograph to somebody who is not on the trip.
 *
 * There is no such thing as an Instagram share link — no URL you can open that
 * pre-fills a post, the way a tweet intent does. What every app that offers
 * "share to Instagram" actually does is hand the picture to the operating
 * system's share sheet, where Instagram appears as a target because it is
 * installed. The same sheet is Messages, WhatsApp, Mail and AirDrop, so one
 * implementation is the whole list rather than one integration per app.
 *
 * What differs is what a browser will let us put in it, so the decision is a
 * ladder rather than a branch, and it is here where it can be argued with
 * rather than discovered on somebody's phone.
 */

export type ShareWay =
  /** The picture itself in the sheet: Instagram gets an image to post. */
  | 'files'
  /** A link in the sheet: the reader taps through to the photograph. */
  | 'link'
  /** No sheet at all — put the link on the clipboard and say so. */
  | 'clipboard'

export interface ShareAbility {
  /** navigator.share exists at all. */
  sheet?: boolean
  /** …and will accept this particular file. */
  files?: boolean
  /** navigator.clipboard can be written to. */
  clipboard?: boolean
}

/**
 * The best way to share, given what this browser admits to.
 *
 * Files first, because a picture in the sheet is what makes Instagram — and
 * every other app that posts images rather than links — actually work. A link
 * is the fallback, and the clipboard is the fallback's fallback: a desktop
 * browser with no share sheet can still get the link to somebody, it just
 * cannot open the sheet to do it.
 */
export function shareWay(can: ShareAbility): ShareWay | null {
  if (can.sheet && can.files) return 'files'
  if (can.sheet) return 'link'
  if (can.clipboard) return 'clipboard'
  return null
}

/**
 * What goes in the sheet beside the picture.
 *
 * The caption if there is one, and the link either way — a picture with no
 * link is a picture somebody has to ask about, and a link with no words is a
 * message that reads like spam.
 */
export function shareNote(caption: string | null | undefined, url: string): string {
  const line = String(caption ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return line ? `${line}\n${url}` : url
}

/** What to tell somebody once it has gone, which depends on how it went. */
export function shareOutcome(way: ShareWay | null): string {
  if (way === 'clipboard') return 'Link copied'
  if (way) return 'Shared'
  return 'Sharing is not available in this browser'
}

/** A filename a share sheet will show without embarrassing anybody. */
export function shareFilename(caption: string | null | undefined, video = false): string {
  const stem =
    String(caption ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'off-we-go'
  return `${stem}.${video ? 'mp4' : 'jpg'}`
}
