/* Deciding when two records are the same place.
 *
 * Overture and Foursquare both describe the world and neither knows about the
 * other, so the same café arrives twice: at slightly different coordinates,
 * under slightly different names, in differently-worded categories. Merging
 * them wrongly is worse than not merging — two "Café Zoom" pins forty metres
 * apart is untidy, but one pin carrying the other's phone number is a lie
 * somebody rings.
 *
 * So the rule is conservative, deterministic and written down. Three signals,
 * each scored 0..1, combined with fixed weights:
 *
 *   how close       a hard gate at MATCH_METRES, then a linear decay inside it
 *   how alike       Dice coefficient over character trigrams of folded names
 *   what kind       our own category: the same, related, or contradictory
 *
 * Nothing merges below ACCEPT. Above it, the highest score wins, and ties
 * break on the upstream id so the same two inputs always produce the same
 * output whatever order they arrive in — a merge that depends on iteration
 * order is a merge nobody can reproduce when it goes wrong.
 *
 * Everything here is pure. The heuristics are the thing most likely to need
 * tuning as coverage grows, and tuning is only safe when the tests can state
 * the old behaviour exactly.
 */

import { relatedCategories } from './taxonomy.js'

/** Beyond this, two records are different places whatever they are called. */
export const MATCH_METRES = 200
/** A score at or above this merges. */
export const ACCEPT = 0.72
/** Names this alike, this close, merge whatever the category says: a museum
    filed as a shop is a miscategorised museum, not a second building. */
export const STRONG_NAME = 0.92
export const STRONG_NAME_METRES = 120

const WEIGHT = { name: 0.5, distance: 0.3, category: 0.2 }

const EARTH_METRES = 6_371_008.8
const radians = degrees => (degrees * Math.PI) / 180

/** Great-circle distance. The places layer never asks about distances where
    the difference between a sphere and an ellipsoid could change an answer. */
export function metresBetween(a, b) {
  const lat1 = radians(a.lat)
  const lat2 = radians(b.lat)
  const dLat = lat2 - lat1
  const dLng = radians(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_METRES * Math.asin(Math.min(1, Math.sqrt(h)))
}

/* Punctuation, case and accents differ between sources for the same shopfront;
   the words do not. Folding is deliberately shallow — it does not stem, drop
   articles or translate — because every clever normalisation eventually folds
   two genuinely different places onto one another, and this runs unattended
   over seventy million rows. */
const MARKS = /[̀-ͯ]/g
const NOT_WORDS = /[^\p{L}\p{N}]+/gu

export function foldName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(NOT_WORDS, ' ')
    .trim()
}

/** Character trigrams of a folded name, padded so short names still have any.
    Padding matters: "Bo" has no trigrams at all otherwise, and every two-letter
    bar in Lisbon would match every other one at similarity zero. */
export function trigrams(folded) {
  const padded = `  ${folded} `
  const out = new Set()
  for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3))
  return out
}

/** Dice coefficient: twice the shared trigrams over the total. Symmetric, 0..1,
    and the same measure pg_trgm uses, so search and merge agree about
    likeness. */
export function nameSimilarity(a, b) {
  const first = foldName(a)
  const second = foldName(b)
  if (!first || !second) return 0
  if (first === second) return 1
  const left = trigrams(first)
  const right = trigrams(second)
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

/** 1 when the two categories are the same, a half when they are neighbours in
    the taxonomy (a bar that one source calls a restaurant), 0 when they
    contradict. Unknown on either side is not evidence either way. */
export function categoryAgreement(a, b) {
  if (!a || !b || a === 'other' || b === 'other') return 0.5
  if (a === b) return 1
  return relatedCategories(a, b) ? 0.5 : 0
}

/**
 * How alike two records are, and why. Returns the parts as well as the score
 * so a merge can be explained after the fact.
 *
 * @param {{name: string, lat: number, lng: number, category?: string}} subject
 * @param {{name: string, lat: number, lng: number, category?: string}} other
 */
export function matchScore(subject, other) {
  const distance = metresBetween(subject, other)
  const name = nameSimilarity(subject.name, other.name)
  const category = categoryAgreement(subject.category, other.category)
  /* Outside the gate there is no score to give: the answer is "different
     place", not "a poor match". */
  if (distance > MATCH_METRES) {
    return { score: 0, distance, name, category, gated: true }
  }
  const proximity = 1 - distance / MATCH_METRES
  const score = WEIGHT.name * name + WEIGHT.distance * proximity + WEIGHT.category * category
  return { score, distance, name, category, gated: false }
}

/** Whether a scored pair merges. Two doors to the same rule so the strong-name
    shortcut is stated once. */
export function merges(scored) {
  if (scored.gated) return false
  if (scored.name >= STRONG_NAME && scored.distance <= STRONG_NAME_METRES) return true
  return scored.score >= ACCEPT
}

/**
 * The record in `candidates` that `subject` is the same place as, or null.
 *
 * Deterministic: the best score wins; an exact tie goes to the smaller
 * upstream id, so re-running an ingest over the same release cannot shuffle
 * which of two equally-good candidates a place merged into.
 *
 * @param {object} subject
 * @param {object[]} candidates  records already held, near enough to consider
 * @returns {{match: object, scored: object}|null}
 */
export function bestMatch(subject, candidates) {
  let best = null
  for (const candidate of candidates || []) {
    const scored = matchScore(subject, candidate)
    if (!merges(scored)) continue
    if (
      !best ||
      scored.score > best.scored.score ||
      (scored.score === best.scored.score &&
        String(candidate.upstreamId ?? candidate.id ?? '') <
          String(best.match.upstreamId ?? best.match.id ?? ''))
    ) {
      best = { match: candidate, scored }
    }
  }
  return best
}

/* Which source wins a field when several have one.
 *
 * Not "the most confident record wins everything": a low-confidence record
 * with a phone number still knows the phone number, and taking a blank from
 * the confident one loses information for no reason. So it is per field, and
 * the order is by the source's own confidence in that record, with a filled
 * value always beating an empty one. Ties go to the source listed first in
 * `order`, which the caller sets from the README's merge rules. */
export const MERGED_FIELDS = [
  'name',
  'category',
  'address',
  'website',
  'phone',
  'hours',
  'operating',
]

export function mergeFields(records, order = ['overture', 'fsq', 'osm']) {
  const rank = new Map(order.map((source, at) => [source, at]))
  const sorted = [...records].sort((a, b) => {
    const byConfidence = (b.confidence ?? 0) - (a.confidence ?? 0)
    if (byConfidence !== 0) return byConfidence
    return (rank.get(a.source) ?? 99) - (rank.get(b.source) ?? 99)
  })
  const merged = {}
  /** Which source supplied each field, for place_sources.fields. */
  const credit = new Map(records.map(record => [record.source, []]))
  for (const field of MERGED_FIELDS) {
    for (const record of sorted) {
      const value = record[field]
      const empty =
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      if (empty) continue
      merged[field] = value
      credit.get(record.source)?.push(field)
      break
    }
  }
  /* Alternate names are the one field that gathers rather than competes: every
     name any source knows is worth searching by. */
  const names = new Set()
  for (const record of sorted) {
    for (const name of record.alternateNames || []) if (name) names.add(name)
    if (record.name && record.name !== merged.name) names.add(record.name)
  }
  merged.alternateNames = [...names].sort()
  /* The position is the most confident source's, not an average: averaging two
     coordinates puts the pin in the road between them. */
  const located = sorted.find(record => Number.isFinite(record.lat) && Number.isFinite(record.lng))
  merged.lat = located?.lat ?? null
  merged.lng = located?.lng ?? null
  return { merged, credit: Object.fromEntries(credit) }
}
