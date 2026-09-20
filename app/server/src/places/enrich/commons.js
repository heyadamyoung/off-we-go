/**
 * Photographs from Wikimedia Commons, and only the ones we may show.
 *
 * "It is on Commons" is not a licence. Commons hosts non-free logos under
 * fair-use rationales, files uploaded with no licence at all and awaiting
 * deletion, files whose licence template a bot has flagged as disputed, and
 * a long tail of NC and ND licences that forbid exactly what we would be
 * doing. It also hosts millions of freely licensed photographs, which is why
 * we are here.
 *
 * The API tells us which is which, in `extmetadata`, and this module reads it
 * rather than assuming. The gate is licenses.js and it is closed by default:
 * a file whose licence we cannot identify is not stored, not shown, not
 * cached. That loses us some pictures we were probably entitled to, and the
 * alternative is publishing somebody's photograph without the right to, at a
 * rate of thousands an hour, unattended.
 *
 * Two further refusals that are about being useful rather than lawful:
 *
 *   not a photograph   Commons is full of maps, coats of arms, floor plans
 *                      and scanned documents. A category for a castle will
 *                      have its coat of arms in it. SVG is the giveaway for
 *                      most, and a filename saying so for the rest.
 *   not a thumbnail    a 180-pixel-wide upload is somebody's icon. A card
 *                      wants something it can fill a screen width with.
 */

import { attributionFor, mayStore } from './licenses.js'

/** Narrower than this and it is an icon, not a photograph of a place. */
export const LEAST_PIXELS = 640

/** How many we keep for one place. The client shows one and may offer more. */
export const MOST_IMAGES = 6

const NOT_A_PHOTOGRAPH =
  /\b(coat[_ ]of[_ ]arms|logo|icon|map|plan|diagram|chart|flag|seal|crest|signature|blason|wappen|karte|locator)\b/i

/** Plain text out of the HTML the API puts in `extmetadata` values. */
export const plain = value =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * One file from an `imageinfo` response, or null if we may not use it.
 *
 * @param {object} page a page object from `query.pages`
 * @returns {{url: string, thumbUrl: string|null, width: number, height: number,
 *            author: string|null, license: string, licenseUrl: string|null,
 *            source: string, sourceUrl: string|null,
 *            attribution: object}|null}
 */
export function readFile(page) {
  const info = page?.imageinfo?.[0]
  if (!info?.url) return null

  const meta = info.extmetadata ?? {}
  const mime = String(info.mime ?? '')
  const title = String(page.title ?? '')

  /* Photographs. A drawing of a building is not a picture of the place, and
     an SVG on Commons is essentially never a photograph. */
  if (!mime.startsWith('image/') || mime === 'image/svg+xml') return null
  if (NOT_A_PHOTOGRAPH.test(title)) return null

  const width = Number(info.width) || 0
  const height = Number(info.height) || 0
  if (width < LEAST_PIXELS) return null

  /* The gate. `LicenseShortName` is the human name ("CC BY-SA 4.0"); a file
     with none, or one we do not recognise, is refused. */
  const license = plain(meta.LicenseShortName?.value) || plain(meta.License?.value)
  if (!mayStore(license)) return null

  /* Commons also carries a machine-readable restriction field, set on files
     that are freely licensed but depict something with its own restriction —
     a trademark, a building under freedom-of-panorama rules that do not
     apply everywhere. We decline those rather than reason about jurisdiction. */
  if (plain(meta.Restrictions?.value)) return null

  const author = plain(meta.Artist?.value) || null
  const attribution = attributionFor({
    author,
    license,
    source: 'Wikimedia Commons',
    sourceUrl: info.descriptionurl ?? null,
  })
  /* Belt and braces: attributionFor runs the same gate, and disagreeing with
     it would mean showing a picture with no notice under it. */
  if (!attribution) return null

  return {
    url: info.url,
    thumbUrl: info.thumburl ?? null,
    width,
    height,
    author,
    license: attribution.license,
    licenseUrl: attribution.licenseUrl,
    source: 'Wikimedia Commons',
    sourceUrl: info.descriptionurl ?? null,
    attribution,
  }
}

/**
 * Every usable file in an `imageinfo` response, best first.
 *
 * Ordered by how well it would fill a card: landscape beats portrait because
 * the card is wider than it is tall, and bigger beats smaller. Deterministic
 * on the title after that, so the same response always yields the same
 * first picture and a re-run does not silently reshuffle what people saw.
 */
export function readFiles(response, most = MOST_IMAGES) {
  const pages = response?.query?.pages
  const list = Array.isArray(pages) ? pages : Object.values(pages ?? {})
  const found = []
  for (const page of list) {
    const file = readFile(page)
    if (file) found.push({ ...file, title: String(page.title ?? '') })
  }
  found.sort((a, b) => {
    const shape = (a.width >= a.height ? 0 : 1) - (b.width >= b.height ? 0 : 1)
    if (shape !== 0) return shape
    const size = b.width * b.height - a.width * a.height
    if (size !== 0) return size
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0
  })
  return found.slice(0, most).map(({ title: _title, ...file }, rank) => ({ ...file, rank }))
}
