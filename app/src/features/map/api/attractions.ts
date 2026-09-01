import { ask } from '../../../shared/api/wikipedia-client'
import {
  NOT_A_PHOTO, NOT_A_PLACE, NOT_SOMEWHERE_YOU_GO, tidy,
} from '../../../shared/lib/place-format'

const CELL_DEG = 0.12                       // ~13 km of latitude, so 10 km circles overlap
const lngStepAt = lat => CELL_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180))

export function cellsCovering({ west, south, east, north }: any, { limit = 12, centre }: any = {}) {
  const cells: Array<{ key: string; lat: number; lng: number }> = []
  const row0 = Math.floor(south / CELL_DEG), row1 = Math.floor(north / CELL_DEG)
  for (let row = row0; row <= row1 && cells.length < 4000; row++) {
    const lat = (row + 0.5) * CELL_DEG
    const step = lngStepAt(lat)
    for (let col = Math.floor(west / step); col <= Math.floor(east / step); col++) {
      cells.push({ key: row + '_' + col, lat, lng: (col + 0.5) * step })
    }
  }
  if (centre) {
    cells.sort((a, b) =>
      ((a.lat - centre[1]) ** 2 + (a.lng - centre[0]) ** 2) -
      ((b.lat - centre[1]) ** 2 + (b.lng - centre[0]) ** 2))
  }
  return cells.slice(0, limit)
}

/* What the pin is, which decides its colour and whether it survives a wide
   zoom. Read off Wikipedia's one-line description, which for a place is
   reliably of the form "castle in Highland, Scotland". */
const KINDS: Array<[string, RegExp]> = [
  ['castle',   /castle|fortress|fort\b|citadel|palace|stronghold|tower house|country house|stately home|manor|chateau/i],
  ['museum',   /museum|gallery|exhibition|library|archive|visitor centre|visitor center/i],
  ['worship',  /cathedral|abbey|priory|minster|monastery|convent|church|chapel|kirk|synagogue|mosque|temple|shrine/i],
  ['outdoors', /national park|country park|park\b|garden|forest|wood|glen|loch|lake|reservoir|falls|waterfall|beach|bay\b|island|isle of|mountain|munro|hill|peak|summit|cave|nature reserve|protected area|moor|cliff|coast|dune|gorge|valley/i],
  ['history',  /monument|memorial|standing stone|stone circle|cairn|broch|ruins|battlefield|archaeological|burial|henge|roman|historic site|historic house|cemetery|graveyard|crypt|tomb|city walls|listed building/i],
  ['culture',  /theatre|theater|concert hall|opera house|cinema|arts centre|arts center|stadium|arena|square|plein|piazza|market square/i],
  ['food',     /distillery|brewery|winery|restaurant|market|food hall|pub\b|inn\b/i],
  ['fun',      /zoo|aquarium|theme park|amusement|observatory|planetarium|lighthouse|windmill|smock mill|tower mill|watermill|bridge|pier|viewpoint|funicular|cable car|pleasure/i],
  // Water is real scenery but there is a great deal of it: kept, and kept off
  // the map until you are close enough to care which burn it is.
  ['water',    /river|stream|burn\b|canal|gracht|estuary|firth|sound\b|strait/i],
]
const kindOf = text => (KINDS.find(([, re]) => re.test(text)) || ['place'])[0]

// Worth a pin even when the whole country is on screen.
const HEADLINE = new Set(['castle', 'museum', 'outdoors', 'history', 'fun'])

/* Things geotagged like places that are not places to go. Settlements are the
   big one: every village in Scotland has an article, and a map peppered with
   hamlets tells you nothing about where to spend an afternoon. */
const IS_A_SETTLEMENT =
  /^(the )?(capital |former |small |large |market |port |county |cathedral |coastal |fishing |mining |new |old )*(city|town|village|hamlet|burgh|settlement|community|suburb)(\s+(in|of|and|near|on)\b|,|$)/i

const NOT_AN_ATTRACTION = new RegExp([
  // administrative and residential
  'village', 'hamlet', 'human settlement', 'civil parish', 'parish', 'council area',
  'electoral', 'ward', 'constituency', 'suburb', 'neighbou?rhood', 'district',
  'locality', 'county', 'region of', 'area of', 'townland', 'arrondissement',
  'housing estate', 'residential',
  // getting about, rather than arriving
  'railway station', 'metro station', 'train station', 'bus station', 'tram stop',
  'railway line', 'bus route', 'road', 'street', 'thoroughfare', 'roundabout',
  'motorway', 'junction', 'airport', 'airfield', 'ferry terminal', 'car park',
  // buildings named only as buildings
  'municipal building', 'judicial building', 'office building', 'apartment building',
  'commercial building', 'residential building', 'warehouse', 'skyscraper',
  'shopping mall', 'shopping centre', 'retail park', 'industrial estate',
  'business park', 'petrol station', 'quarry', 'landfill', 'wind farm',
  'power station', 'water tower', 'telephone exchange',
  // organisations and things that are not places at all
  'school', 'academy', 'college', 'university', 'hospital', 'company', 'society',
  'charity', 'trust\b', 'association', 'institute', 'football club', 'f\.c\.',
  'rowing club', 'golf club', 'sports club', 'newspaper', 'band', 'political party',
  'submarine', 'shipwreck', 'lifeboat station', 'surname', 'given name',
  'painting', 'novel', 'album', 'song',
].join('|'), 'i')

/* One decision about one article, so the map, the seeder and the tidy-up pass
   can never drift apart. Everything is judged on Wikipedia's one-line
   description, which for a place is reliably of the form "castle in Highland,
   Scotland" — and never on the article prose, which mentions the borough. */
export function classify(description) {
  const d = (description || '').trim()
  if (!d) return { skip: true, kind: 'place' }
  if (NOT_AN_ATTRACTION.test(d)) return { skip: true, kind: 'place' }
  if (NOT_A_PLACE.test(d)) return { skip: true, kind: 'place' }
  if (NOT_SOMEWHERE_YOU_GO.test(d)) return { skip: true, kind: 'place' }
  if (IS_A_SETTLEMENT.test(d)) return { skip: true, kind: 'place' }
  return { skip: false, kind: kindOf(d) }
}

// A lead image that is a logo, a locator map or a coat of arms is worse than
// none: it looks like a photograph on a card and tells you nothing.
export function photoOrNothing(file) {
  if (!file) return null
  return NOT_A_PHOTO.test(file.replace(/^File:/, '')) ? null : file
}

export function attractionThumb(file, width = 480) {
  if (!file) return null
  return 'https://commons.wikimedia.org/wiki/Special:FilePath/' +
         encodeURIComponent(file.replace(/^File:/, '')) + '?width=' + width
}

const STORE_PREFIX = 'wf-attr-'
const STORE_CAP = 150                       // cells kept before the oldest go

function readCell(key) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeCell(key, items) {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(items))
    const seen = JSON.parse(localStorage.getItem(STORE_PREFIX + 'index') || '[]')
      .filter(k => k !== key)
    seen.push(key)
    while (seen.length > STORE_CAP) {
      try { localStorage.removeItem(STORE_PREFIX + seen.shift()) } catch { /* gone already */ }
    }
    localStorage.setItem(STORE_PREFIX + 'index', JSON.stringify(seen))
  } catch {
    // Quota, or private browsing. The layer still works, it just refetches.
    try { localStorage.removeItem(STORE_PREFIX + 'index') } catch { /* nothing to do */ }
  }
}

const liveCells = new Map()

export async function attractionsInCell(cell: any, signal?: AbortSignal) {
  if (liveCells.has(cell.key)) return liveCells.get(cell.key)
  const stored = readCell(cell.key)
  if (stored) { liveCells.set(cell.key, stored); return stored }

  const json = await ask({
    generator: 'geosearch',
    ggscoord: cell.lat + '|' + cell.lng,
    ggsradius: '10000',
    ggslimit: '500',
    prop: 'coordinates|description|pageprops',
    ppprop: 'page_image_free',
    // Every prop here has its own quiet page cap, and coordinates is the
    // meanest of them: ten, by default, out of five hundred articles. Without
    // this the layer silently drew a handful of pins and looked simply broken.
    colimit: 'max',
  }, signal)

  const items = Object.values<any>(json.query?.pages || {})
    .filter(p => p.coordinates?.length && p.description)
    .filter(p => !classify(p.description).skip)
    /* A place you are already standing in is not somewhere to go: "Edinburgh"
       described as the capital city earns a pin in the middle of Edinburgh,
       which is no use to anyone. Anchored to the start of the description so
       the City Observatory and the City Chambers keep theirs. */
    .map(p => ({
      id: p.pageid,
      n: p.title.replace(/\s*\([^)]*\)\s*$/, ''),
      d: p.description.slice(0, 90),
      k: classify(p.description).kind,
      // Filtered here too, not only in the live search: the Van Gogh Museum's
      // lead image is its logo, and a seeded logo is a logo on the map for ever.
      f: photoOrNothing(p.pageprops?.page_image_free),
      x: +p.coordinates[0].lon.toFixed(5),
      y: +p.coordinates[0].lat.toFixed(5),
    }))
    .filter(p => p.k !== 'place' || p.f)      // unclassifiable and pictureless is noise

  liveCells.set(cell.key, items)
  writeCell(cell.key, items)
  return items
}

export const isHeadline = kind => HEADLINE.has(kind)

// Everything a pin's card wants that the map layer did not need to carry.
export async function articleSummary(pageId: string | number, signal?: AbortSignal) {
  const json = await ask({
    pageids: String(pageId), prop: 'extracts|info|pageimages', inprop: 'url',
    exintro: '1', explaintext: '1', exsentences: '3',
    piprop: 'thumbnail', pithumbsize: '800',
  }, signal)
  const page = Object.values<any>(json.query?.pages || {})[0]
  if (!page) return null
  return {
    note: tidy(page.extract),
    image: page.thumbnail?.source || null,
    source: page.fullurl || null,
  }
}

/* The opening lines for a batch of articles, for the seeder's second pass.

   Twenty at a time because TextExtracts returns nothing above that — silently,
   as ever, which is why the number is here rather than a hopeful larger one. */
export async function extractsFor(pageIds: Array<string | number>, signal?: AbortSignal) {
  const out = new Map()
  for (let i = 0; i < pageIds.length; i += 20) {
    const batch = pageIds.slice(i, i + 20)
    const json = await ask({
      pageids: batch.join('|'), prop: 'extracts',
      exintro: '1', explaintext: '1', exsentences: '3', exlimit: 'max',
    }, signal)
    for (const page of Object.values<any>(json.query?.pages || {})) {
      out.set(page.pageid, tidy(page.extract))
    }
  }
  return out
}
