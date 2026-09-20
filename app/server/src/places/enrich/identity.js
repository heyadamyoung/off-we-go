/**
 * Deciding which OpenStreetMap object is this place.
 *
 * The whole enrichment chain hangs off this one decision, so it is worth
 * saying why it is the only uncertain step.
 *
 * We could match our places to Wikidata directly. We should not. Wikidata is
 * a graph of everything — a place, the company that owns it, the film it
 * appeared in and the architect who built it are all items with names, and
 * some of them carry coordinates. Matching a café to it by name and distance
 * is guessing against a much larger and less spatially disciplined haystack.
 *
 * OpenStreetMap is the better target for exactly the reason it is worse data
 * in every other respect: it is edited by people who stand in the street. Its
 * objects are the things themselves, its coordinates are surveyed, and — the
 * point — its editors have already done the Wikidata matching for us and
 * written it on the object as `wikidata=*`. So we make one fuzzy match here,
 * and every hop after it is a link a human declared. One uncertain step
 * buying a curated chain beats four uncertain steps.
 *
 * It also leaves an audit trail. An OSM object has a stable id we write into
 * place_links, so a wrong picture is traced back to a specific decision and
 * re-checked, rather than re-guessed from scratch on the next run.
 *
 * Three signals, in order of how much they are worth:
 *
 *   the website      If both sides name an official website and the hosts
 *                    agree, that is not a similarity, it is the same
 *                    organisation saying where it lives. Measured on the
 *                    Paris degree, 79.2% of our places carry one. This is
 *                    the strongest evidence available in open data and it
 *                    is the reason this pipeline works at all.
 *   name and place   places/resolve.js, unchanged: trigrams over folded
 *                    names, distance decay inside 200m, category agreement.
 *                    Already tested, already tuned, already shipping.
 *   corroboration    A match made on name and distance that the website
 *                    then agrees with is a different kind of true from one
 *                    nothing else supports. Recorded rather than folded
 *                    into the score, because it changes what we are willing
 *                    to do with the match, not how likely it is.
 *
 * And a chain is only ever as strong as its weakest hop, so a match made on
 * name and distance alone is not allowed to put a photograph on the map. It
 * may carry a description, which is cheap to be wrong about and obviously
 * wrong when it is. A picture of the wrong building is not obviously wrong
 * and is the failure people would actually notice.
 */

import { ACCEPT, bestMatch, matchScore } from '../resolve.js'

/** Above this, a name-and-distance match may carry a picture on its own. */
export const PICTURE_SCORE = 0.9

/** How the match was made. */
export const BY_WEBSITE = 'website'
export const BY_NAME_AND_PLACE = 'name+geo'
export const DECLARED = 'declared'

/**
 * The host a URL points at, lowercased, with a leading `www.` removed.
 *
 * Deliberately the whole host rather than a registrable domain. Working out
 * that `bbc.co.uk` is registrable and `co.uk` is not needs a public suffix
 * list, and getting it wrong in the permissive direction is how every place
 * in Britain matches every other place in Britain. Comparing whole hosts
 * costs us `shop.example.com` vs `example.com`, which `sameSite` handles
 * separately and explicitly.
 */
export function hostOf(url) {
  if (typeof url !== 'string' || !url.trim()) return null
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    return host || null
  } catch {
    return null
  }
}

/**
 * Whether two URLs name the same site.
 *
 * Equal hosts, or one a subdomain of the other — `example.com` and
 * `visit.example.com` are the same organisation, and an OSM editor writing
 * the booking subdomain while Overture has the front page is the normal case
 * rather than the exception. A shared suffix that is not a label boundary
 * (`notexample.com` under `example.com`) is not a match.
 */
export function sameSite(a, b) {
  const left = hostOf(a)
  const right = hostOf(b)
  if (!left || !right) return false
  if (left === right) return true
  return left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

/**
 * The OSM object this place is, or null.
 *
 * @param {{name: string, lat: number, lng: number, category?: string,
 *          website?: string|null}} place ours
 * @param {Array<{id: string, name: string, lat: number, lng: number,
 *                category?: string, tags?: object}>} candidates from Overpass
 * @returns {{ref: string, score: number|null, method: string,
 *            confirmedBy: string|null, mayPicture: boolean,
 *            object: object}|null}
 */
export function identify(place, candidates) {
  const near = Array.isArray(candidates) ? candidates : []
  if (!near.length) return null

  /* The website first, and on its own terms: an agreeing host is enough
     without the name being alike, because a shop that has rebranded still
     has its own site and is the same shop. Distance still gates it — the
     candidates were fetched from a box around the place — so this cannot
     reach across a city. */
  const byWebsite = place.website
    ? near.filter(candidate =>
        sameSite(place.website, candidate.tags?.website ?? candidate.website),
      )
    : []
  if (byWebsite.length === 1) {
    return {
      ref: byWebsite[0].id,
      score: matchScore(place, byWebsite[0]).score,
      method: BY_WEBSITE,
      confirmedBy: null,
      mayPicture: true,
      object: byWebsite[0],
    }
  }

  /* Several candidates share the site — a museum and its café, a chain's two
     branches on one street. The website has told us which organisation but
     not which object, so fall through to the name, restricted to those. */
  const pool = byWebsite.length > 1 ? byWebsite : near
  const best = bestMatch(place, pool)
  if (!best) return null

  const confirmedBy =
    place.website && sameSite(place.website, best.match.tags?.website ?? best.match.website)
      ? BY_WEBSITE
      : null

  return {
    ref: best.match.id,
    score: best.scored.score,
    method: BY_NAME_AND_PLACE,
    confirmedBy,
    /* A picture needs either corroboration or a name match strong enough to
       stand alone. The cost of being wrong is asymmetric: a wrong sentence
       reads oddly, a wrong photograph is a different building. */
    mayPicture: confirmedBy === BY_WEBSITE || best.scored.score >= PICTURE_SCORE,
    object: best.match,
  }
}

/** The identifiers an OSM object declares, which are not ours to score. */
export function declaredBy(tags = {}) {
  const links = []
  const wikidata = typeof tags.wikidata === 'string' ? tags.wikidata.trim() : ''
  if (/^Q\d+$/.test(wikidata)) {
    links.push({ kind: 'wikidata', ref: wikidata, method: DECLARED, score: null })
  }
  /* `wikipedia=en:Edinburgh Castle` — a language prefix and a title. */
  const wikipedia = typeof tags.wikipedia === 'string' ? tags.wikipedia.trim() : ''
  if (/^[a-z-]{2,12}:.+/i.test(wikipedia)) {
    links.push({ kind: 'wikipedia', ref: wikipedia, method: DECLARED, score: null })
  }
  const commons = typeof tags.wikimedia_commons === 'string' ? tags.wikimedia_commons.trim() : ''
  if (commons) {
    links.push({ kind: 'commons', ref: commons, method: DECLARED, score: null })
  }
  return links
}

/** Exported so the queue and the tests agree on what "good enough" means. */
export const MATCHES = ACCEPT
