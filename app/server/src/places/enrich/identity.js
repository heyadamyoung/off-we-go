/**
 * Deciding which Wikipedia article is about this place.
 *
 * The whole enrichment chain hangs off this one decision, so it is worth
 * saying why it is the only uncertain step.
 *
 * This file described OpenStreetMap until #229, which cut that hop out, and
 * the description outliving the code is most of why the bug below took so
 * long to find. It said the website was "the strongest evidence available in
 * open data and the reason this pipeline works at all" — and the candidates
 * stopped carrying websites the day they started coming from Wikipedia. A
 * comment that names a signal the code no longer receives will hide anything.
 *
 * What is actually true now. Candidates come from Wikipedia's geosearch: an
 * article title, and where the article says its subject is. That is two
 * signals where OSM gave three, and the two behave differently:
 *
 *   the name      Not a name — a *title*. Wikipedia writes "Campbell House
 *                 Museum (Toronto)" because another article shares the name,
 *                 and "The Georgian House, Edinburgh" in the house style for
 *                 places. Neither bracket is part of what the building is
 *                 called. Both sides are stripped before comparing; see
 *                 `subjectOf`.
 *   how close     Surveyed on our side, editorial on theirs — an article's
 *                 coordinate is where somebody put a pin, so tens of metres
 *                 is normal and means nothing is wrong.
 *   the category  Absent. An article has no category, which matters more
 *                 than it sounds: `categoryAgreement` returns 0.5 for a
 *                 missing side, so the blended match score can never exceed
 *                 0.900 for this chain. Any threshold at 0.9 is a threshold
 *                 only a perfect name at zero metres can meet, and that is
 *                 exactly the bug PICTURE_NAME replaced.
 *
 *   corroboration A match the open web then agrees with — our website and
 *                 the one Wikidata records for the article's subject — is a
 *                 different kind of true from one nothing else supports.
 *                 Recorded rather than folded into the score, because it
 *                 changes what we are willing to do with the match, not how
 *                 likely it is.
 *
 * And a chain is only ever as strong as its weakest hop, so a match made on
 * name and distance alone has to be a strong one before it may put a
 * photograph on the map. It may carry a description on less: a wrong sentence
 * is cheap to be wrong about and obviously wrong when it is. A picture of the
 * wrong building is not obviously wrong, and is the failure people notice.
 */

import { ACCEPT, bestMatch, matchScore } from '../resolve.js'
import { subjectOf } from './wikipedia.js'

/* What a name-and-distance match has to be before it may carry a picture.
 *
 * This was one number — `score >= 0.9` against the blended match score — and
 * it was arithmetically unreachable. The score is
 *
 *     0.5·name + 0.3·proximity + 0.2·category
 *
 * and a Wikipedia article has no category, so `categoryAgreement` returns its
 * "one side is missing" value of 0.5 and that term contributes a fixed 0.1
 * instead of a possible 0.2. The most any candidate from this chain can score
 * is therefore 0.900 — and only at zero metres, because proximity decays from
 * the first metre. Measured, with a character-perfect name:
 *
 *     0m → 0.900    12m → 0.882    30m → 0.855    120m → 0.720
 *
 * So the gate admitted a perfect name at a distance of nothing, and refused
 * everything else. Production: four pictures across two thousand places.
 *
 * The bug is the reuse. That score was built for Overture against
 * OpenStreetMap, where all three signals exist; applied to Overture against
 * an encyclopedia article, one of them is structurally absent and its absence
 * eats exactly the margin the threshold sits on.
 *
 * So the rule is stated in the evidence this chain actually has: how alike the
 * names are, and how far apart they are. Stricter than the bar for merging two
 * records into one place (0.92 within 120 m) — which is a more consequential
 * act than showing a photograph — so nothing has been loosened by being made
 * reachable. */
export const PICTURE_NAME = 0.94
export const PICTURE_METRES = 80

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

  /* Compared bare against bare.
   *
   * `readNearby` already strips Wikipedia's own bookkeeping from the title —
   * the "(Toronto)" that is there because another article shares the name.
   * Our names carry the same device for their own reasons: Overture holds
   * "The Georgian House (National Trust for Scotland)", where the bracket
   * names the operator rather than the building. Stripping one side and not
   * the other is the same mistake mirrored, and measurably so:
   *
   *   "The Georgian House (National Trust for Scotland)"
   *     against "The Georgian House, Edinburgh"     0.50 → 1.00
   *
   * For the comparison only. Everything downstream keeps the name we hold,
   * because that is the name on the map and the one somebody typed. */
  const subject = { ...place, name: subjectOf(place.name) }

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
      score: matchScore(subject, byWebsite[0]).score,
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
  const best = bestMatch(subject, pool)
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
    mayPicture:
      confirmedBy === BY_WEBSITE ||
      (best.scored.name >= PICTURE_NAME && best.scored.distance <= PICTURE_METRES),
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
