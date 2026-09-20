/* How a place is drawn on the map: which colour, how big, and which one wins
 * when two want the same piece of screen.
 *
 * The layer shipped deliberately monochrome, and the reasoning was sound at
 * the time — a category rainbow across hundreds of dots reads as content and
 * drowns the amber that means "your trip". What that reasoning missed is that
 * the problem was never the colour, it was the count: everything drew from
 * zoom 11, all the same size, none of it decluttering, and against three
 * hundred identical grey dots amber has nothing to stand out from either.
 *
 * With the server deciding a zoom per place (places/rank.js) the count is
 * right, and colour can do its real job — telling you, without reading a
 * word, that this street has three cafés and a museum on it.
 *
 * Eight families, not twenty. A legend nobody is given has to be learnable by
 * accident, and twenty colours is not learnable by accident: green is
 * outdoors, orange is food, blue is getting around, and that much is guessable
 * on sight. The twenty categories still exist and still decide the zoom and
 * the ranking; this is only what they look like.
 *
 * Everything here is pure arithmetic over a category string. The rasteriser
 * at the bottom builds its pixels by hand rather than through a canvas, so
 * the marks are identical on every device, and so this file can be tested
 * without a browser.
 */

/** The eight colour families, and what belongs to each. */
export const MARK_FAMILIES = [
  'culture',
  'outdoors',
  'food',
  'drink',
  'shopping',
  'lodging',
  'transit',
  'everyday',
] as const

export type MarkFamily = (typeof MARK_FAMILIES)[number]

const FAMILY_OF: Record<string, MarkFamily> = {
  sights: 'culture',
  viewpoint: 'outdoors',
  museum: 'culture',
  gallery: 'culture',
  historic: 'culture',
  religious: 'culture',
  entertainment: 'culture',
  nature: 'outdoors',
  beach: 'outdoors',
  sport: 'outdoors',
  food: 'food',
  cafe: 'food',
  bar: 'drink',
  market: 'shopping',
  shopping: 'shopping',
  lodging: 'lodging',
  transit: 'transit',
  services: 'everyday',
  health: 'everyday',
  other: 'everyday',
}

/** Which family a category is drawn in. Anything unknown is everyday, which
    is the quietest of them — an unrecognised category should recede, not
    shout in a colour it has not earned. */
export const familyOf = (category: string): MarkFamily => FAMILY_OF[String(category)] ?? 'everyday'

/* The colours.
 *
 * Chosen to stay apart from each other and from the two colours this map has
 * already spent: amber is the trip and is never used here, and the route's
 * blue is darker and heavier than the transit mark. Each family has a light
 * and a dark value because the basemap has two themes and a colour that reads
 * on paper-white is mud on near-black.
 *
 * They are also chosen to survive the common colour-blindness: the pairs most
 * often confused — the culture purple against the drink red, the outdoors
 * green against the food orange — differ in lightness as well as in hue, so
 * they are still two different marks in greyscale. */
export const MARK_COLOURS: Record<MarkFamily, { light: string; dark: string }> = {
  culture: { light: '#8E4EC6', dark: '#B98BE8' },
  outdoors: { light: '#1E8E3E', dark: '#4CC470' },
  food: { light: '#D6620B', dark: '#F0913F' },
  drink: { light: '#C5221F', dark: '#F07B76' },
  shopping: { light: '#0F7B8A', dark: '#45BECF' },
  lodging: { light: '#C0157E', dark: '#F075BC' },
  transit: { light: '#3B5BDB', dark: '#7C93F5' },
  everyday: { light: '#6E7887', dark: '#98A2B3' },
}

/** Which of the two sets of values a theme name asks for.
 *
 * Anything that is not the light map is the dark one, which is the same
 * reading every other layer in use-map-layers takes of the same string. The
 * theme arrives as a bare string from the props, and a map that refuses to
 * draw because it was handed a theme name nobody has defined yet is worse
 * than one that draws in the dark palette. */
const shade = (theme: string): 'light' | 'dark' => (theme === 'light' ? 'light' : 'dark')

/** The colour one category is drawn in, for a theme. */
export const markColour = (category: string, theme: string): string =>
  MARK_COLOURS[familyOf(category)][shade(theme)]

/* ---- what the map layer reads ----------------------------------------- */

/** The GeoJSON property the pin's category travels in — see the map layer's
    featureFor, which uses short keys because they ride on every feature of
    every viewport. */
export const CATEGORY_KEY = 'k'

/** The property the server's per-place zoom travels in. */
export const MIN_ZOOM_KEY = 'minzoom'

/** And its importance, for deciding which label survives a crowded street. */
export const RANK_KEY = 'rank'

/**
 * The colour of a mark, as a MapLibre expression over the feature's category.
 *
 * Built rather than written out, so the twenty categories cannot drift from
 * the eight families: add a category to FAMILY_OF and it is coloured here,
 * with no second list to remember. Grouped per family rather than one branch
 * per category, because `match` takes a list of labels per branch and twenty
 * branches is twenty string comparisons on every dot of every frame.
 */
export function markColourExpression(theme: string): unknown[] {
  const grouped = new Map<MarkFamily, string[]>()
  for (const [category, family] of Object.entries(FAMILY_OF)) {
    /* The fallback family needs no branch of its own: anything that does not
       match lands on it anyway, including categories this build has never
       heard of. */
    if (family === 'everyday') continue
    const held = grouped.get(family)
    if (held) held.push(category)
    else grouped.set(family, [category])
  }
  const branches: unknown[] = []
  for (const family of MARK_FAMILIES) {
    const categories = grouped.get(family)
    if (categories?.length) branches.push(categories, MARK_COLOURS[family][shade(theme)])
  }
  return ['match', ['get', CATEGORY_KEY], ...branches, MARK_COLOURS.everyday[shade(theme)]]
}
