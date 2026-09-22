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

import { identify, sameSite } from './identity.js'
import { readFiles } from './commons.js'
import { readEntity } from './wikidata.js'
import { fileBehind, readNearby, readSummary, trimToCard } from './wikipedia.js'
import { attributionFor } from './licenses.js'

/* Bumped when the shape of what we fetch changes, so old rows re-run.
 *
 * 2  the picture gate stopped asking its question in the wrong order. The
 *    corroboration that unlocks a photograph — Wikidata's official website
 *    agreeing with ours — was read *inside* the gate it was evidence for, so
 *    no place could ever be let through by it. Production held four pictures
 *    across two thousand and fifty-two enriched places because of that.
 *
 *    The fix only helps places enriched after it, and a place that came back
 *    `ready` is never looked at again — five hundred and fifty-one of them
 *    have their words, have no picture, and would have kept none for ever.
 *    This number is the only thing that reaches them: every row whose
 *    pipeline is not this one is queued again, which is exactly what it is
 *    for. They keep what they have while they wait, because the rewrite is
 *    one transaction. */
export const ENRICH_PIPELINE = 2

/** Wikidata's own one-line description, when there is no article. */
export const WIKIDATA_LICENSE = 'CC0'

export const READY = 'ready'
export const BARREN = 'barren'

/**
 * @param {{id: number, name: string, lat: number, lng: number,
 *          category?: string, website?: string|null}} place
 * @param {{near: Function, entity: Function, summary: Function,
 *          files: Function}} sources
 * @param {{languages?: string[], signal?: AbortSignal}} [options]
 */
export async function enrichPlace(place, sources, options = {}) {
  const languages = options.languages ?? ['en']
  const lang = languages[0] || 'en'
  const links = []

  /* 1. Which article is about this place.
   *
   * This was three hops: find the OpenStreetMap object here, read its
   * `wikidata` tag, ask Wikidata which article that is. OSM contributed
   * nothing we did not already hold — not the name, not the category, not
   * the position — and cost a planet extract, a second spatial index, a
   * loader nobody had run, and a fallback to a volunteer API for everything
   * the extract was missing, which was everywhere.
   *
   * The article is the thing we actually want. Ask for it directly. */
  const candidates = readNearby(await sources.near({ ...place, lang }, options), { lang })
  const found = identify(place, candidates)
  if (!found) return { status: BARREN, reason: 'no Wikipedia article is about here', links: [] }

  const article = found.object.article
  links.push({
    kind: 'wikipedia',
    ref: found.ref,
    score: found.score,
    method: found.method,
    confirmedBy: found.confirmedBy,
  })

  /* 2. What it says, and — in the same answer — which Wikidata item it is
        and what its lead picture is. One request for three things the old
        chain spent three on. */
  const body = await sources.summary(article, options)
  const summary = readSummary(body)
  if (!summary) {
    return { status: BARREN, reason: `the article ${article.title} says nothing usable`, links }
  }
  const description = {
    text: trimToCard(summary.text),
    lang: summary.lang,
    source: 'Wikipedia',
    sourceUrl: summary.sourceUrl,
    license: summary.license,
  }

  const wikidataId = typeof body?.wikibase_item === 'string' ? body.wikibase_item : null
  if (wikidataId) {
    links.push({ kind: 'wikidata', ref: wikidataId, score: found.score, method: found.method })
  }

  /* 3. Pictures, but only where the chain that led here is strong enough. A
        wrong sentence reads oddly; a wrong photograph is a different
        building and nobody can tell by looking.
   *
   * The article's own lead image first — it is the picture an editor chose
   * to illustrate this subject, so it is the most likely to be right — and
   * then whatever Wikidata names, which is usually the same file and
   * sometimes a category with more. Both go through Commons for the licence
   * and the author, because a picture without them may not be shown. */
  let images = []
  /* Wikidata first, then the picture decision — and that order is the fix for
   * four pictures across eight hundred and fifty-two places.
   *
   * `mayPicture` wants either a name match strong enough to stand alone or a
   * website that agrees. Both of those were calibrated when the candidates
   * came from OpenStreetMap, where an object carries `tags.website` and is
   * named the way Overture names things. They come from Wikipedia geosearch
   * now, and an article carries no website at all — so the website half of the
   * gate became dead code the day the chain changed, leaving a bare
   * name-similarity threshold of 0.9 against article titles. "National
   * Galleries of Scotland" against "National Gallery of Scotland" does not
   * clear that, and should not have to.
   *
   * The corroboration that would clear it was already being fetched — the
   * official site Wikidata records — and was being read *inside* the gate, so
   * a place whose website agrees with Wikidata's could never earn a picture,
   * because earning one was the precondition for looking. That is the bug: the
   * evidence was downstream of the decision it was evidence for.
   *
   * So the entity is read first, its websites are compared, and a place the
   * open web independently agrees with may have its picture. The asymmetry the
   * gate exists for is untouched — a wrong sentence reads oddly, a wrong
   * photograph is a different building — this only stops us throwing away the
   * one third party that had never heard of either of us. */
  const entity = wikidataId ? readEntity(await sources.entity(wikidataId, options)) : null
  if (!found.confirmedBy && place.website && entity?.websites?.length) {
    if (entity.websites.some(site => sameSite(place.website, site))) {
      links[0].confirmedBy = 'website'
    }
  }
  const mayPicture = found.mayPicture || links[0]?.confirmedBy === 'website'
  if (mayPicture) {
    const wanted = []
    const lead = fileBehind(summary.thumbnail)
    if (lead) wanted.push(lead)

    if (entity?.image && !wanted.includes(`File:${entity.image}`)) {
      wanted.push(`File:${entity.image}`)
    }
    const category = entity?.commonsCategory ? `Category:${entity.commonsCategory}` : null

    if (wanted.length || category) {
      images = readFiles(await sources.files({ files: wanted, category }, options))
    }
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
