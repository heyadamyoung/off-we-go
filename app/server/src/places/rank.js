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

/* And a third question: what deserves a pin on a map with no centre to it.
 *
 * Here the category weight is the whole ranking — there is no distance to a
 * box — so what is wrong with the table shows. `sights` is the catch-all for
 * anything attraction-shaped, and at the top weight it beat every museum in
 * Amsterdam with canal bridges: measured, the best eight in the city centre
 * were LAB111, CREA and six bridges. A bridge is honestly a sight; it is not
 * what somebody zooming out to a city wants a dot for.
 *
 * So on a map the named kinds go first and the catch-all sits under them. It
 * is not a claim that bridges do not matter, only that a promise beats a
 * shrug when there is room for three hundred pins and the city has forty
 * thousand places. */
export const VIEW_KIND = Object.freeze({ sights: 0.6, services: 0.05, other: 0.05 })
export const viewWeightOf = category => VIEW_KIND[category] ?? weightOf(category)

/** The weights a map's viewport query ranks by, as one frozen table — the
    database does that ordering, so it needs the numbers rather than the
    function. store.js builds a CASE from exactly this. */
export const VIEW_WEIGHT = Object.freeze(
  Object.fromEntries(Object.keys(CATEGORY_WEIGHT).map(kind => [kind, viewWeightOf(kind)])),
)
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

/* ---- what shows at which zoom ----------------------------------------- */

/* A map is not a list, and this is the part that was missing.
 *
 * The layer shipped with one bit per place — `big`, meaning "survives a zoom
 * out" — and below zoom 11 the big ones drew and above it everything did. So
 * a city at zoom 12 drew three hundred dots at once, every one of them the
 * same size and the same grey, and the honest description of the result was
 * the one it got: a cluster of dots.
 *
 * Every map that does this well gives each place a zoom it earns its way onto
 * the screen at, and there are many tiers rather than two. A cathedral is
 * visible from across the city; a launderette is visible when you are in its
 * street. Nothing is removed — a place with a late zoom is not a place we are
 * hiding, it is a place you have not zoomed to yet.
 *
 * The tiers below are the category's answer. They are spaced to the way a
 * person zooms: 11 is a whole city, 13 a district, 15 a few streets, 17 the
 * pavement you are standing on. Deliberately not derived from CATEGORY_WEIGHT
 * by arithmetic, because the weight answers "how worth seeing is this" and
 * this answers "from how far away is this worth drawing", and they come apart:
 * a railway station is not a sight and is visible from a long way off; a
 * viewpoint is a sight and is pointless until you are near it.
 */
export const MARK_ZOOM = Object.freeze({
  /* Across a city. What a stranger would say they came to see. */
  museum: 11.5,
  historic: 12,
  gallery: 12.5,
  nature: 12,
  beach: 12,
  /* Across a district. Big enough to plan an afternoon around. */
  viewpoint: 13,
  entertainment: 13.5,
  religious: 13.5,
  transit: 13.5,
  market: 14,
  /* The catch-all sits here rather than with the museums. `sights` is
     whatever was attraction-shaped and unnameable — in Amsterdam it is mostly
     canal bridges, measured — and a bridge is honestly a sight without being
     what somebody zooming to a city wants a dot for. */
  sights: 14,
  /* A few streets. Things you choose once you are in the neighbourhood. */
  lodging: 14.5,
  food: 15,
  sport: 15,
  cafe: 15.5,
  bar: 15.5,
  health: 16,
  shopping: 16,
  /* The pavement. Real, and nobody plans around them. */
  services: 16.5,
  other: 17,
})

/** The zoom a whole category starts drawing at. */
export const markZoomOf = category => MARK_ZOOM[category] ?? MARK_ZOOM.other

/* How much later a place we are unsure of has to wait.
 *
 * Confidence already decides whether a record is shown at all (CONFIDENCE_FLOOR)
 * and how it sorts. On a map it can do something better than either: a
 * half-certain museum is still probably a museum, so it draws — just not from
 * across the city, where a wrong dot is most of what you can see. A full zoom
 * level at the floor, nothing at all at total confidence. */
export const CONFIDENCE_DELAY = 1

/**
 * The zoom at which one place earns its dot.
 *
 * @param {{category?: string, confidence?: number}} place
 * @returns {number} a map zoom, one decimal place
 */
export function markZoom(place) {
  const base = markZoomOf(place?.category)
  const sure = Math.min(1, Math.max(0, Number(place?.confidence ?? 0)))
  /* Rounded, because this rides on every pin of every viewport and two
     records of the same kind and similar confidence should share a tier
     rather than differ in the third decimal. */
  return Math.round((base + CONFIDENCE_DELAY * (1 - sure)) * 10) / 10
}

/**
 * Which place wins when two want the same piece of screen.
 *
 * A collision has to be settled by something, and "whichever the database
 * returned first" is how a café ends up hiding the cathedral behind it. The
 * map's own category weighting decides, demoted by confidence — the same
 * order the pins were chosen in, so what survives a crowded street is what
 * would have been at the top of the list for it.
 *
 * Larger is more important. Kept as a 0..1000 integer because it travels as a
 * GeoJSON property and is read by a sort expression, and floats in feature
 * properties are where "equal" stops meaning equal.
 */
export function markRank(place) {
  const kind = viewWeightOf(place?.category)
  const sure = confidenceFactor(place?.confidence)
  return Math.round(kind * sure * 1000)
}
