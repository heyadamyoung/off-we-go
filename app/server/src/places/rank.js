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
 * How a place earns its zoom here is not a table. It is where it comes in
 * its own neighbourhood.
 *
 * The first version of this was a table: museum 11.5, café 15.5, and so on
 * down. It reads well and it is wrong, and wrong in a way that produced both
 * of the complaints it was meant to answer. The same rule ran in central
 * Amsterdam and on the Isle of Skye. Amsterdam has a hundred and sixty-eight
 * thousand places in its square, so everything qualified and a per-tile cap
 * threw away whatever did not fit, arbitrarily — a cluster of dots. Skye has
 * thirteen hundred, two thirds of them places to stay and errands, which the
 * table does not let on screen until zoom 14.5 and 16.5 — an empty island.
 * One rule, two opposite failures, because the rule never looked at how much
 * was around.
 *
 * So a place's zoom is a property of the place: EARLIEST_ZOOM below, one
 * number per category, and that is the whole rule. A museum is drawn from
 * 11, a cafe from 14, a launderette from 16, in Amsterdam and in Regina and
 * on Skye alike. At a zoom you get every place whose kind belongs there,
 * however many that is.
 *
 * It was a ranking for a while, and the ranking was the mistake. For each
 * zoom the places in each tile square were put in order of what they are
 * worth and the best two dozen earned that zoom — which is what a tiler does,
 * tippecanoe calls it dropping the densest as needed, and it reads well on a
 * screen. What it also does is make a place's zoom depend on its neighbours:
 * an identical museum appeared at 12 in Regina and 15 in Amsterdam, and "the
 * zoom decides what is drawn" was not true. The crowd decided; the zoom only
 * set how big the crowd could be.
 *
 * Crowding is a rendering question and it is answered where rendering
 * happens. This is how the map that does not flicker does it too: the data
 * carries a prominence per feature, the tile ships generously, and the
 * renderer places labels greedily by priority and drops the ones that will
 * not fit on the glass this frame. Ours does exactly that — the dots are a
 * circle layer, which never collides, so every place is a dot; the names are
 * a symbol layer whose `symbol-sort-key` is this file's markRank, so when two
 * names want the same pixels the better one keeps them and the other waits
 * for a zoom where there is room. Nothing is lost and nothing is decided
 * permanently at write time.
 *
 * What the one-number-per-row buys is unchanged and is the part that matters:
 * a tile is `label_zoom <= z` with no cap, so a mark that has appeared can
 * never disappear as you zoom further in. Monotonic by construction rather
 * than by luck. See places/store.js assignLabelZoom, which is now a plain
 * UPDATE rather than six zooms of window function — the densest degree on
 * Earth was 18.2 seconds under the old rule, which is why the backfill never
 * finished.
 *
 * What the category still decides is the ordering — CATEGORY_WEIGHT, below,
 * times confidence. A museum beats a café for a place in the square. It no
 * longer decides from how far away anything is drawn, because that was never
 * a fact about the category; it was a guess about the density.
 */

/** Zooms that thin themselves, and the one that does not.
 *
 * 11 is a whole city and 16 a few streets. 17 is the pavement, where every
 * place left over lands: a square there is three hundred metres across, and
 * somebody zoomed that far in is asking for everything rather than for a
 * selection of it. Marks below 11 are not drawn at all, so nothing is
 * computed for them. */
export const LABEL_ZOOMS = Object.freeze({ from: 11, to: 16, floor: 17 })

/**
 * How many marks a tile square may carry before the deepest zoom.
 *
 * This is the whole of the thinning, and it went missing for three releases.
 * Without it the rule was the category table below and nothing else — and
 * eleven of the twenty categories sit at zoom 11, so a city from far out drew
 * every museum, viewpoint, historic site, market and transit stop it held. A
 * carpet of dots, reported as one, twice.
 *
 * Twenty-four is what a square can carry and still read as a map. A tile is
 * 512 device pixels on a phone, so two dozen marks is one per hundred pixels
 * square — about what Google shows at the same zoom, and enough that four or
 * six tiles on screen give a hundred-odd dots rather than a texture.
 *
 * It applies from LABEL_ZOOMS.from to LABEL_ZOOMS.to and nowhere else. At the
 * floor there is no budget and no contest: every place that never won a slot
 * lands there, the tile pyramid stops there, and the tile route caps nothing,
 * so the closest zoom shows everything on the street. That is deliberate and
 * it is the point — the ranking decides what you see from far away, and when
 * you are standing on top of it there is nothing left to decide.
 */
export const MARKS_PER_TILE = 24

/**
 * The furthest away a kind of place may ever be drawn from.
 *
 * Density alone is not enough, and the case that proved it is small enough to
 * hold in your head. The demo map has twenty-two places in Amsterdam and a
 * budget of twenty-four a square, so every one of them fit at zoom 11 and the
 * algorithm was right: there was room. It put a café called Winkel 43 on the
 * map from across the city, beside the Rijksmuseum, because nothing was
 * competing with it.
 *
 * That is wrong, and it is wrong for a reason density cannot see. A café is
 * not a city-scale landmark. It does not become one by being the only café in
 * an empty county, and on the Isle of Skye — 1,329 places, two thirds of them
 * guest houses and errands — pure density would have promoted a bed and
 * breakfast to the zoom you use to look at a whole island.
 *
 * So the two rules do different jobs, and neither does the other's:
 *
 *   the category   says how prominent a kind of place may ever be. A ceiling,
 *                  not a position. It is the answer to "could you reasonably
 *                  see this from here", which is a fact about the kind.
 *   the density    picks which of the places allowed at this zoom actually
 *                  get the slots, by what they are worth. That is the answer
 *                  to "of the things that could be here, which few".
 *
 * This is not the table that #189 deleted coming back. That table set the
 * zoom exactly — café 15.5, always — so Skye showed nothing until you were
 * standing on it. This only stops a kind rising above its station; a café on
 * Skye still earns 14 where it used to be refused until 15.5, and Skye's
 * landscape and historic places still earn 11 because there is room and they
 * are the kind of thing you look at an island for.
 */
export const EARLIEST_ZOOM = Object.freeze({
  /* Things you plan a day around and can see from across a city. */
  sights: 11,
  viewpoint: 11,
  museum: 11,
  historic: 11,
  gallery: 11,
  nature: 11,
  beach: 11,
  /* A destination is a destination. Oude Kerk is the oldest building in
     Amsterdam and Albert Cuyp is the reason people go to De Pijp; a station
     is what a traveller navigates a city by. All of them allowed at 11 — and
     in a city, allowed is not the same as drawn: eleven thousand of them
     compete for two dozen slots a square, and what they are worth decides. */
  entertainment: 11,
  religious: 11,
  market: 11,
  transit: 11,
  /* Somewhere you go on purpose, rarely a skyline. */
  sport: 12,
  lodging: 13,
  /* Places you choose once you are in the neighbourhood. Nobody picks a
     café from twenty kilometres away. */
  food: 14,
  cafe: 14,
  bar: 14,
  shopping: 14,
  /* An errand. You are looking for one when you are already outside it. */
  services: 16,
  health: 16,
  other: 16,
})

/* Bumped whenever anything above changes how a zoom is decided. The worker
   keeps a copy of the last version it ran and redoes the whole pass when they
   differ, because a stored number gives no hint of the rule that made it.
   3 was EARLIEST_ZOOM alone, which drew every museum in a city from orbit.
   4 puts the ranking back in front of it: a kind may not rise above its
   station, and among the kinds allowed at a zoom the best two dozen a square
   get the slots. */
export const ZOOM_POLICY = 4

/** The zoom this kind of place is drawn from. Not a ceiling on a ranking:
    the whole rule. */
export const earliestFor = category => EARLIEST_ZOOM[category] ?? EARLIEST_ZOOM.other

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
