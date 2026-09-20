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
