/* Putting places in the order a traveller wants them.
 *
 * Open data is complete in the sense that it has everything, and uneven in the
 * sense that it has everything. Within four hundred metres of a hotel in
 * Amsterdam there are, truthfully, more nail salons than museums. Ranking is
 * the whole difference between "sights nearby" and "the nearest 20 rows".
 *
 * Three factors, multiplied rather than added, because each can veto: a
 * launderette at ten metres should still lose to the Rijksmuseum at eight
 * hundred, and no amount of closeness should raise a record nobody is
 * confident exists.
 *
 *   what kind it is   a fixed weight per category — but only when the caller
 *                     did not ask for a category. "Show me cafés" must not
 *                     then rank cafés by how sight-like they are.
 *   how far           exponential decay scaled to the radius asked for
 *   how sure          the merged confidence, as a demotion not a veto
 *
 * And a floor, below which a record is not shown at all rather than shown
 * last. Suppression is honest where ranking is not: a 0.2-confidence row is
 * usually a duplicate, a closed shop or a geocoding artefact, and burying it
 * at the bottom of a list still puts it on a map.
 *
 * Everything here is pure, and every constant is named and justified, because
 * these are the numbers somebody will want to argue with in six months.
 */

/* Measured over a 98,097-row sample of Overture 2026-08-19.0: mean confidence
   0.665, and the long tail below 0.3 is duplicates and defunct records. The
   floor sits under that tail, not through the middle of it. */
export const CONFIDENCE_FLOOR = 0.3

/* How sight-like each of our categories is. Used only when the caller has not
   named a category: it is the answer to "what is worth seeing near here",
   which is a question about kind, not about distance. */
export const CATEGORY_WEIGHT = Object.freeze({
  sights: 1,
  viewpoint: 1,
  museum: 0.95,
  historic: 0.9,
  gallery: 0.9,
  nature: 0.85,
  beach: 0.85,
  entertainment: 0.7,
  religious: 0.65,
  market: 0.65,
  food: 0.6,
  cafe: 0.55,
  bar: 0.5,
  lodging: 0.35,
  shopping: 0.35,
  sport: 0.3,
  transit: 0.3,
  services: 0.15,
  health: 0.15,
  other: 0.1,
})

/** A category nobody weighted is not therefore worthless; it is unknown. */
export const weightOf = category => CATEGORY_WEIGHT[category] ?? CATEGORY_WEIGHT.other

/* Distance decays over two thirds of the radius asked for, so the shape of the
   ranking is the same whether somebody asked about 400 metres or 5 km.

   The exact fraction is the whole balance of this file and was set by the case
   in the comment above: a launderette at ten metres must lose to the
   Rijksmuseum at eight hundred. Decaying over a third of the radius made the
   launderette win (0.137 against 0.081) — near enough beat anything, and
   "sights nearby" became "whatever is underfoot". Over two thirds the museum
   wins 0.268 to 0.139, while a café fifty metres away still beats a museum
   nine hundred metres away, which is the other case that has to keep working. */
export const DECAY_FRACTION = 1.5

export function distanceDecay(metres, radius) {
  const length = Math.max(1, radius / DECAY_FRACTION)
  return Math.exp(-Math.max(0, metres) / length)
}

/* Confidence demotes, never vetoes — the floor already did the vetoing. A
   record we are half sure of keeps 70% of its score. */
export const confidenceFactor = confidence => 0.4 + 0.6 * Math.min(1, Math.max(0, confidence ?? 0))

/**
 * One place's score for a nearby query.
 * @param {{category: string, metres: number, confidence: number}} place
 * @param {{radius: number, category?: string|null}} query
 */
export function nearbyScore(place, query) {
  const kind = query?.category ? 1 : weightOf(place.category)
  return (
    kind * distanceDecay(place.metres, query?.radius ?? 1000) * confidenceFactor(place.confidence)
  )
}

/**
 * Rank a page of candidates. The caller has already done the spatial work in
 * the database; this decides the order and what is worth showing.
 *
 * Stable: equal scores keep the order the database gave, which is by distance,
 * so a tie reads as "these two are the same distance away" rather than as
 * whatever the sort happened to do.
 */
export function rankNearby(places, query) {
  const floor = query?.floor ?? CONFIDENCE_FLOOR
  return (places || [])
    .filter(place => (place.confidence ?? 0) >= floor)
    .map((place, at) => ({ place, at, score: nearbyScore(place, query) }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map(entry => ({ ...entry.place, score: entry.score }))
}

/* Sparse country.
 *
 * A village in rural Saskatchewan has four places within a kilometre and two
 * of them are grain elevators. Returning nothing is the one answer that is
 * certainly wrong — the traveller is standing there, so something is there.
 *
 * So the query widens in documented steps rather than by guesswork: the radius
 * grows and the floor drops, in that order of preference, because a real place
 * further away beats a doubtful one underfoot. The ladder stops at 50 km,
 * past which "nearby" has stopped meaning anything and the honest answer is a
 * short list with the distances shown.
 */
export const WIDENING = Object.freeze([
  { radius: 1, floor: 1 },
  { radius: 3, floor: 1 },
  { radius: 8, floor: 0.75 },
  { radius: 25, floor: 0.5 },
])
export const MAX_RADIUS_METRES = 50_000
/** Fewer than this and the next rung is tried. */
export const ENOUGH = 8

/**
 * The next radius and floor to try, or null when the ladder is spent.
 * @param {number} found   how many survived the last attempt
 * @param {number} attempt zero-based rung just tried
 * @param {{radius: number, floor: number}} base
 */
export function widen(found, attempt, base) {
  if (found >= ENOUGH) return null
  const next = WIDENING[attempt + 1]
  if (!next) return null
  const radius = Math.min(base.radius * next.radius, MAX_RADIUS_METRES)
  if (radius <= base.radius * WIDENING[attempt].radius) return null
  return { radius, floor: Math.max(0, base.floor * next.floor) }
}

/* ---- typeahead ------------------------------------------------------- */

/* A search ranks on likeness first and everything else second: somebody
   typing "rijks" wants the Rijksmuseum whether it is near them or not, and a
   café called "Rijk" three streets away is not a better answer for being
   close. Geography biases, it does not decide. */
export const NEAR_BIAS_METRES = 30_000

/* What a search score is made of, and why each part is there.
 *
 * Trigram similarity alone is a length penalty dressed as a relevance score.
 * Dice over trigrams divides by the size of both names, so for the query
 * "heineken" a bar called "Heineken Bar" scores 0.82 and the Heineken
 * Experience — the thing a traveller in Amsterdam is actually looking for —
 * scores 0.60, purely for having a longer name. Measured on the real
 * 2026-08-19.0 data for Amsterdam: the top five for "heineken" were four
 * bars and an office, one of them eleven kilometres away, and the museum was
 * nowhere. The same defect hid Amsterdam Centraal behind Bar Centraal.
 *
 * So `contains` asks the other question — how much of what was *typed* is in
 * this name — which is one for both, and the length penalty stops deciding.
 * And `kind` lets the category weigh in, gently: somebody typing a name
 * usually means the landmark rather than the bar named after it. Similarity
 * keeps the largest single share because it is what catches a misspelling,
 * which is the whole reason for fuzzy matching at all.
 *
 * The weights are tuned against real queries and pinned by tests. */
/* Two of the categories answer the two questions very differently.
 *
 * CATEGORY_WEIGHT is "how worth seeing is this", which is the right question
 * for a list of what is near you, and there a railway station is not a sight.
 * A search asks something else: what did somebody mean by this name. Stations,
 * airports and hotels are precisely the things travellers type by name —
 * "Amsterdam Centraal", "Gare du Nord", "Hotel Okura" — and at the nearby
 * weight of 0.3 the station lost to a bar named after it. Everything else
 * answers both questions the same way and is not repeated here. */
export const SEARCH_KIND = Object.freeze({ transit: 0.8, lodging: 0.7 })
const searchWeightOf = category => SEARCH_KIND[category] ?? weightOf(category)

export const SEARCH_WEIGHT = Object.freeze({
  similarity: 0.4,
  contains: 0.35,
  position: 0.15,
  kind: 0.3,
  near: 0.15,
  confidence: 0.1,
})

/**
 * @param {{similarity: number, confidence: number, metres?: number|null, name: string, category?: string}} row
 * @param {string} query
 */
export function searchScore(row, query) {
  const folded = String(query ?? '')
    .trim()
    .toLowerCase()
  const name = String(row.name ?? '').toLowerCase()
  /* At the front of the name, or merely somewhere in it. "Van Gogh Museum"
     and "Museum Van Gogh" are both answers to "van gogh"; the first is the
     better one. */
  const position = name.startsWith(folded) ? 1 : name.includes(folded) ? 0.4 : 0
  const contains = folded && name.includes(folded) ? 1 : 0
  const near =
    Number.isFinite(row.metres) && row.metres !== null
      ? Math.exp(-row.metres / NEAR_BIAS_METRES)
      : 0
  return (
    SEARCH_WEIGHT.similarity * (row.similarity ?? 0) +
    SEARCH_WEIGHT.contains * contains +
    SEARCH_WEIGHT.position * position +
    SEARCH_WEIGHT.kind * searchWeightOf(row.category) +
    SEARCH_WEIGHT.near * near +
    SEARCH_WEIGHT.confidence * confidenceFactor(row.confidence)
  )
}

export function rankSearch(rows, query) {
  return (rows || [])
    .map((row, at) => ({ row, at, score: searchScore(row, query) }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map(entry => ({ ...entry.row, score: entry.score }))
}
