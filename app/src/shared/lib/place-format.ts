const MAX_RADIUS = 10000        // the API refuses more

// Roughly how far across the viewport is, so a search covers what you can see.
export function radiusForView(zoom, lat, widthPx = 1200) {
  const metresPerPx = 40075016.686 * Math.cos((lat * Math.PI) / 180) / (256 * Math.pow(2, zoom))
  return Math.round(Math.min(MAX_RADIUS, Math.max(250, (metresPerPx * widthPx) / 2)))
}

// Wikipedia's one-line description is a decent guide to which pin to draw.
const ICON_HINTS: Array<[RegExp, string]> = [
  [/museum|gallery|exhibit/i, 'museum'],
  [/park|garden|forest|wood/i, 'walk'],
  [/restaurant|cafe|café|market|food|brewery|bar\b/i, 'food'],
  [/hotel|hostel|inn\b|accommodation/i, 'bed'],
  [/airport|station|terminal|railway/i, 'plane'],
  [/canal|harbour|harbor|port|river|bridge|boat|ship/i, 'boat'],
]
const iconFor = (text: string) => (ICON_HINTS.find(([re]) => re.test(text || '')) || [null, 'pin'])[1]

/* Geosearch returns every geotagged article, which near a city centre means
   mostly streets, neighbourhoods and administrative areas — accurate, useless.
   These three rules turn the raw list into somewhere you might actually go. */

// Not destinations, however near they are.
const NOT_A_PLACE =
  /\b(neighbou?rhood|district|borough|quarter|street|straat|road|avenue|lane|suburb|ward|census|municipality|administrative|locality|postal|constituency|list of)\b/i

/* Pictures that are not pictures of the place: locator maps, flags, arms.
   Matched against the file name with separators either side, and never against
   the whole url — "map" is a substring of "Amsterdam", which quietly stripped
   the photograph off half the results in a Dutch city. */
const NOT_A_PHOTO =
  /(?:^|[_\-\s])(map|maps|kaart|flag|vlag|locator|wapen|coa|coat|arms|seal|logo|blank|icon)(?:[_\-\s.]|$)/i
const fileNameOf = (url: string) => {
  try { return decodeURIComponent((url.split('/').pop() || '').split('?')[0]) }
  catch { return url }
}

/* Not somewhere you go, however precisely it is geotagged: the works *inside*
   a museum carry the museum's coordinates, so a search around the Rijksmuseum
   comes back with a stack of paintings sitting on the same pin. Monuments and
   public sculpture stay — you can walk to those. */
const NOT_SOMEWHERE_YOU_GO =
  /(painting|drawing|etching|engraving|altarpiece|triptych|tapestry|watercolour|illuminated manuscript|novel by|poem by|album by|song by|sonata|symphony|species of|genus of|asteroid)/i

// Worth surfacing first.
const IS_A_DESTINATION =
  /\b(museum|gallery|park|garden|church|cathedral|basilica|synagogue|mosque|temple|castle|palace|monument|memorial|tower|bridge|market|square|theatre|theater|zoo|aquarium|stadium|restaurant|cafe|café|brewery|library|station|harbou?r|windmill|statue|house|hall)\b/i

/* Wikipedia's opening sentence carries asides no traveller wants: the Dutch
   spelling, the English gloss, and a full IPA pronunciation. On a card that is
   three lines tall they crowd out what the place actually is. */
const ASIDE = /\s*\((?:Dutch|English|French|German|Latin|Italian|Spanish|abbreviated|lit\.|pronounced|IPA)[^()]*\)/gi
const NESTED_ASIDE = /\s*\([^()]*(?:pronunciation|pronounced|\[[^\]]*\])[^()]*\)/gi

function tidy(text: string) {
  return (text || '')
    .replace(NESTED_ASIDE, '')
    .replace(ASIDE, '')
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export {
  IS_A_DESTINATION, MAX_RADIUS, NOT_A_PHOTO, NOT_A_PLACE,
  NOT_SOMEWHERE_YOU_GO, fileNameOf, iconFor, tidy,
}
