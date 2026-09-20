/**
 * One place, enriched: what it is, what it looks like, what to say about it.
 *
 * The chain, and every hop's reason for existing:
 *
 *   place → OSM          the one uncertain step. See identity.js: OSM's
 *                        editors have already matched their objects to
 *                        Wikidata, so one fuzzy match buys a curated chain.
 *   OSM → Wikidata       declared by a human in a `wikidata=*` tag.
 *   Wikidata → article   a sitelink, which is the same statement.
 *   Wikidata → Commons   P18 for one picture, P373 for a whole category.
 *   Commons → files      licence-checked one by one in commons.js.
 *
 * Every source is injected. The decisions are all in this file and the pure
 * modules beside it; the fetching is somebody else's problem and a test's
 * stub. That is not tidiness — it is the only way to state, in a test, what
 * happens when Wikidata has an image but Commons refuses its licence, which
 * is a case that will happen thousands of times and must end with a place
 * that has a description and no picture rather than an exception.
 *
 * Three outcomes, and the middle one is the one people forget:
 *
 *   ready    we found something worth showing
 *   barren   we looked properly and there is genuinely nothing. A café with
 *            no Wikipedia article is not a failure and must never be retried
 *            on a schedule; without this state the queue spends for ever
 *            re-asking about every corner shop on Earth.
 *   failed   something broke. Retried, with the backoff in retry.js, and
 *            never abandoned.
 */

import { declaredBy, identify, sameSite } from './identity.js'
import { readFiles } from './commons.js'
import { articleFor, readEntity } from './wikidata.js'
import { readSummary, trimToCard } from './wikipedia.js'
import { attributionFor } from './licenses.js'

/** Bumped when the shape of what we fetch changes, so old rows re-run. */
export const ENRICH_PIPELINE = 1

/** Wikidata's own one-line description, when there is no article. */
export const WIKIDATA_LICENSE = 'CC0'

export const READY = 'ready'
export const BARREN = 'barren'

/**
 * @param {{id: number, name: string, lat: number, lng: number,
 *          category?: string, website?: string|null}} place
 * @param {{osmNear: Function, entity: Function, summary: Function,
 *          files: Function}} sources
 * @param {{languages?: string[], signal?: AbortSignal}} [options]
 */
export async function enrichPlace(place, sources, options = {}) {
  const languages = options.languages ?? ['en']
  const links = []

  /* 1. Which OSM object is this. */
  const candidates = await sources.osmNear(place, options)
  const found = identify(place, candidates)
  if (!found) return { status: BARREN, reason: 'no OpenStreetMap object matches', links: [] }

  links.push({
    kind: 'osm',
    ref: found.ref,
    score: found.score,
    method: found.method,
    confirmedBy: found.confirmedBy,
  })

  /* 2. What that object says it is. These are declared, not deduced. */
  const tags = found.object.tags ?? {}
  const declared = declaredBy(tags)
  links.push(...declared)

  const wikidataId = declared.find(link => link.kind === 'wikidata')?.ref ?? null
  if (!wikidataId) {
    /* An OSM object with no Wikidata link can still carry a description of
       its own, which is a real tag people fill in for exactly this purpose. */
    const own = typeof tags.description === 'string' ? tags.description.trim() : ''
    if (own.length >= 40) {
      return {
        status: READY,
        links,
        description: {
          text: trimToCard(own),
          lang: 'en',
          source: 'OpenStreetMap',
          sourceUrl: `https://www.openstreetmap.org/${found.ref}`,
          license: 'ODbL-1.0',
        },
        images: [],
      }
    }
    return { status: BARREN, reason: 'the OpenStreetMap object names no Wikidata item', links }
  }

  /* 3. The Wikidata item. */
  const entity = await sources.entity(wikidataId, options)
  const read = readEntity(entity)
  if (!read?.id) return { status: BARREN, reason: `Wikidata has no ${wikidataId}`, links }

  /* The corroboration that costs nothing and is worth a great deal: if
     Wikidata's official website agrees with ours, a match made on name and
     distance has been confirmed by a third party that has never heard of
     either of us. Recorded on the OSM link, since that is the hop it
     vindicates. */
  if (!found.confirmedBy && place.website && read.websites.length) {
    if (read.websites.some(site => sameSite(place.website, site))) {
      links[0].confirmedBy = 'website'
      found.mayPicture = true
    }
  }

  /* 4. Something to say. The article if there is one; Wikidata's own
        one-liner if not, which is thin but true and beats a blank card. */
  let description = null
  const article = articleFor(read, languages)
  if (article) {
    const summary = readSummary(await sources.summary(article, options))
    if (summary) {
      description = {
        text: trimToCard(summary.text),
        lang: summary.lang,
        source: 'Wikipedia',
        sourceUrl: summary.sourceUrl,
        license: summary.license,
      }
    }
  }
  if (!description && read.description) {
    description = {
      text: read.description,
      lang: 'en',
      source: 'Wikidata',
      sourceUrl: `https://www.wikidata.org/wiki/${read.id}`,
      license: WIKIDATA_LICENSE,
    }
  }

  /* 5. Pictures — but only if the chain that led here is strong enough. A
        wrong sentence reads oddly; a wrong photograph is a different
        building and nobody can tell by looking. */
  let images = []
  if (found.mayPicture) {
    const wanted = []
    if (read.image) wanted.push(`File:${read.image}`)
    const category = read.commonsCategory ? `Category:${read.commonsCategory}` : null
    const declaredCommons = declared.find(link => link.kind === 'commons')?.ref ?? null
    images = readFiles(
      await sources.files({ files: wanted, category: category ?? declaredCommons }, options),
    )
  }

  if (!description && !images.length) {
    return { status: BARREN, reason: 'nothing licensed to show', links }
  }
  return { status: READY, links, description, images }
}

/** What the API sends: the notice travels with the picture, always. */
export function shownAs({ description, images }) {
  return {
    description: description
      ? {
          text: description.text,
          source: description.source,
          sourceUrl: description.sourceUrl,
          attribution: attributionFor({
            license: description.license,
            source: description.source,
            sourceUrl: description.sourceUrl,
          }),
        }
      : null,
    images: (images ?? []).map(image => ({
      url: image.url,
      thumbUrl: image.thumbUrl,
      width: image.width,
      height: image.height,
      attribution: attributionFor({
        author: image.author,
        license: image.license,
        source: image.source,
        sourceUrl: image.sourceUrl,
      }),
    })),
  }
}
