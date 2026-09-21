/**
 * A paragraph about a place, from the article about it.
 *
 * Wikipedia's REST summary endpoint gives the lead extract already stripped
 * of markup, which is exactly the shape wanted and saves us parsing wikitext.
 * Text is CC BY-SA 4.0: storable, quotable, and it obliges us to say where it
 * came from. licenses.js holds the gate; this module's job is to refuse
 * anything that is not an article about a thing.
 *
 * Disambiguation pages are the trap. "Victoria" resolves to a list of forty
 * Victorias, whose extract reads like a sentence and is about nothing. The
 * API marks them, and so do redirects to list articles, and both are refused
 * rather than stored as a description.
 */

export const WIKIPEDIA_LICENSE = 'CC BY-SA 4.0'

/**
 * `list=geosearch` results, as candidates identity.js can weigh.
 *
 * The shape is the one the matcher already takes — an id, a name, a
 * position — so the same scoring that used to choose between OpenStreetMap
 * objects now chooses between articles, unchanged. An article has no
 * website, so the website arm of the matcher simply does not fire and the
 * name-and-distance arm decides, which is what it was written for.
 *
 * The id is `lang:Title` rather than the page id, because the title is what
 * every other call in this pipeline takes and a page id would have to be
 * translated back at each one. It is stable enough for a stored link: a
 * renamed article leaves a redirect, and the summary endpoint follows it.
 */
export function readNearby(body, { lang = 'en' } = {}) {
  const found = body?.query?.geosearch
  if (!Array.isArray(found)) return []
  return found
    .filter(one => one && typeof one.title === 'string')
    .map(one => ({
      id: `${lang}:${one.title}`,
      name: one.title,
      lat: Number(one.lat),
      lng: Number(one.lon),
      /* What `summary` and the link both want, carried rather than re-split
         out of the id at three call sites. */
      article: { lang, title: one.title },
    }))
    .filter(one => Number.isFinite(one.lat) && Number.isFinite(one.lng))
}

/**
 * The Commons file behind an article's lead image.
 *
 * The summary response gives a URL, not a file name, and a URL is not enough
 * to show a picture: Commons holds the licence and the author, and both have
 * to be on screen beside it. Every upload URL carries the file name as its
 * last path segment — thumbnails as `.../thumb/a/ab/Name.jpg/1280px-Name.jpg`
 * and originals as `.../a/ab/Name.jpg` — so the name comes back out of it
 * and `imageinfo` is asked for the rest.
 *
 * Returns null rather than guessing when the URL is not one of those, which
 * is the honest answer: no file name, no licence, no picture.
 */
export function fileBehind(thumbnail) {
  const source = typeof thumbnail?.source === 'string' ? thumbnail.source : ''
  if (!/^https:\/\/upload\.wikimedia\.org\//.test(source)) return null
  const parts = source.split('/').filter(Boolean)
  const thumbAt = parts.indexOf('thumb')
  /* Under `thumb`, the real file name is the segment before the rendered
     size; otherwise it is the last one. */
  const name = thumbAt >= 0 ? parts[parts.length - 2] : parts[parts.length - 1]
  if (!name || !/\.[a-z0-9]{2,5}$/i.test(name)) return null
  return `File:${decodeURIComponent(name)}`
}

/** The least text worth showing. Below this it is a stub's first clause. */
export const LEAST_WORTH_SAYING = 60

/**
 * @param {object} summary a `page/summary/{title}` response
 * @returns {{text: string, lang: string, sourceUrl: string|null,
 *            license: string, thumbnail: object|null}|null}
 */
export function readSummary(summary) {
  if (!summary || typeof summary !== 'object') return null
  /* `standard` is an article. `disambiguation` is a list of things with the
     same name and describes none of them; `no-extract` has nothing to give. */
  if (summary.type && summary.type !== 'standard') return null
  const text = typeof summary.extract === 'string' ? summary.extract.trim() : ''
  if (text.length < LEAST_WORTH_SAYING) return null
  /* A lead that opens by saying it is a list is a list, whatever `type`
     claimed — the API marks these inconsistently across languages. */
  if (/^(this (article|page) is a |list of )/i.test(text)) return null
  return {
    text,
    lang: typeof summary.lang === 'string' ? summary.lang : 'en',
    sourceUrl: summary.content_urls?.desktop?.page ?? null,
    license: WIKIPEDIA_LICENSE,
    thumbnail: summary.originalimage ?? summary.thumbnail ?? null,
  }
}

/**
 * The first sentences, up to a length, ending on a sentence.
 *
 * A card is not an article. Cutting mid-word looks broken; cutting at the
 * last full stop that fits reads as though it were written that way.
 */
export function trimToCard(text, most = 400) {
  const whole = String(text ?? '').trim()
  if (whole.length <= most) return whole
  const cut = whole.slice(0, most)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return stop > most * 0.4 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`
}
