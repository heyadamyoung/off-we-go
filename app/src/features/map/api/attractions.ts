import { ask, type WikiQueryResponse } from '../../../shared/api/wikipedia-client'
import { NOT_A_PHOTO, tidy } from '../../../shared/lib/place-format'
import type { AttractionPoi, Coordinates } from '../../../shared/model/types'

const CELL_DEG = 0.12 // ~13 km of latitude, so 10 km circles overlap
const lngStepAt = (lat: number) => CELL_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180))

export interface AttractionCell {
  key: string
  lat: number
  lng: number
}

export function cellsCovering(
  { west, south, east, north }: { west: number; south: number; east: number; north: number },
  { limit = 12, centre }: { limit?: number; centre?: Coordinates } = {},
) {
  const cells: AttractionCell[] = []
  const row0 = Math.floor(south / CELL_DEG),
    row1 = Math.floor(north / CELL_DEG)
  for (let row = row0; row <= row1 && cells.length < 4000; row++) {
    const lat = (row + 0.5) * CELL_DEG
    const step = lngStepAt(lat)
    for (let col = Math.floor(west / step); col <= Math.floor(east / step); col++) {
      cells.push({ key: row + '_' + col, lat, lng: (col + 0.5) * step })
    }
  }
  if (centre) {
    cells.sort(
      (a, b) =>
        (a.lat - centre[1]) ** 2 +
        (a.lng - centre[0]) ** 2 -
        ((b.lat - centre[1]) ** 2 + (b.lng - centre[0]) ** 2),
    )
  }
  return cells.slice(0, limit)
}

/* What the pin is, which decides its colour and whether it survives a wide
   zoom. Read off Wikipedia's one-line description, which for a place is
   reliably of the form "castle in Highland, Scotland". */
const KINDS: Array<[string, RegExp]> = [
  [
    'castle',
    /castle|fortress|fort\b|citadel|palace|stronghold|tower house|country house|stately home|manor|chateau/i,
  ],
  ['museum', /museum|gallery|exhibition|library|archive|visitor centre|visitor center/i],
  [
    'worship',
    /cathedral|abbey|priory|minster|monastery|convent|church|chapel|kirk|synagogue|mosque|temple|shrine/i,
  ],
  [
    'outdoors',
    /national park|country park|park\b|garden|forest|wood|glen|loch|lake|reservoir|falls|waterfall|beach|bay\b|island|isle of|mountain|munro|hill|peak|summit|cave|nature reserve|protected area|moor|cliff|coast|dune|gorge|valley/i,
  ],
  [
    'history',
    /monument|memorial|standing stone|stone circle|cairn|broch|ruins|battlefield|archaeological|burial|henge|roman|historic site|historic house|cemetery|graveyard|crypt|tomb|city walls|listed building/i,
  ],
  [
    'culture',
    /theatre|theater|concert hall|opera house|cinema|arts centre|arts center|stadium|arena|square|plein|piazza|market square/i,
  ],
  ['food', /distillery|brewery|winery|restaurant|market|food hall|pub\b|inn\b/i],
  // Airports carry their own indoor maps, which makes them somewhere to go.
  ['transit', /\bairport\b|\bairfield\b|luchthaven/i],
  [
    'fun',
    /zoo|aquarium|theme park|amusement|observatory|planetarium|lighthouse|windmill|smock mill|tower mill|watermill|bridge|pier|viewpoint|funicular|cable car|pleasure/i,
  ],
  // Water is real scenery but there is a great deal of it: kept, and kept off
  // the map until you are close enough to care which burn it is.
  ['water', /river|stream|burn\b|canal|gracht|estuary|firth|sound\b|strait/i],
]
const kindOf = (text: string) => (KINDS.find(([, re]) => re.test(text)) || ['place'])[0]

// Worth a pin even when the whole country is on screen.
const HEADLINE = new Set(['castle', 'museum', 'outdoors', 'history', 'fun', 'transit'])

/* No editorial filter, by the owner's explicit decision (2026-09-03): every
   geotagged article the search returns earns a dot, villages and roads
   included. The kind is a label for the card and the pin colour, never a
   gatekeeper. The old blocklists live on in the sights feature, which is a
   shortlist and still wants curating; this layer is the map itself. */
export function classify(description: string | null | undefined) {
  return { kind: kindOf((description || '').trim()) }
}

// A lead image that is a logo, a locator map or a coat of arms is worse than
// none: it looks like a photograph on a card and tells you nothing.
export function photoOrNothing(file: string | null | undefined) {
  if (!file) return null
  return NOT_A_PHOTO.test(file.replace(/^File:/, '')) ? null : file
}

export function attractionThumb(file: string | null | undefined, width = 480) {
  if (!file) return null
  return (
    'https://commons.wikimedia.org/wiki/Special:FilePath/' +
    encodeURIComponent(file.replace(/^File:/, '')) +
    '?width=' +
    width
  )
}

/* The 2 is the cache policy version. Cells never expire, so a browser that
   walked a region under the old editorial filter would show its thinned-out
   cells for ever; bumping the prefix orphans them, and the sweep below clears
   them out rather than leaving dead weight against the storage quota. */
const STORE_PREFIX = 'wf-attr2-'
const STORE_CAP = 150 // cells kept before the oldest go
try {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('wf-attr-')) localStorage.removeItem(key)
  }
} catch {
  // No storage (node, private browsing): nothing stale to sweep either.
}

function readCell(key: string): AttractionPoi[] | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key)
    return raw ? (JSON.parse(raw) as AttractionPoi[]) : null
  } catch {
    return null
  }
}

function writeCell(key: string, items: AttractionPoi[]) {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(items))
    const seen = (
      JSON.parse(localStorage.getItem(STORE_PREFIX + 'index') || '[]') as string[]
    ).filter(k => k !== key)
    seen.push(key)
    while (seen.length > STORE_CAP) {
      try {
        localStorage.removeItem(STORE_PREFIX + seen.shift())
      } catch {
        /* gone already */
      }
    }
    localStorage.setItem(STORE_PREFIX + 'index', JSON.stringify(seen))
  } catch {
    // Quota, or private browsing. The layer still works, it just refetches.
    try {
      localStorage.removeItem(STORE_PREFIX + 'index')
    } catch {
      /* nothing to do */
    }
  }
}

const liveCells = new Map<string, AttractionPoi[]>()

export async function attractionsInCell(cell: AttractionCell, signal?: AbortSignal) {
  if (liveCells.has(cell.key)) return liveCells.get(cell.key)!
  const stored = readCell(cell.key)
  if (stored) {
    liveCells.set(cell.key, stored)
    return stored
  }

  const json = await ask<WikiQueryResponse>(
    {
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
    },
    signal,
  )

  const items: AttractionPoi[] = Object.values(json.query?.pages || {})
    .filter(p => p.coordinates?.length)
    .map(p => ({
      id: p.pageid,
      n: p.title.replace(/\s*\([^)]*\)\s*$/, ''),
      d: (p.description || '').slice(0, 90),
      k: classify(p.description).kind,
      // Filtered here too, not only in the live search: the Van Gogh Museum's
      // lead image is its logo, and a seeded logo is a logo on the map for ever.
      f: photoOrNothing(p.pageprops?.page_image_free),
      x: +p.coordinates![0].lon.toFixed(5),
      y: +p.coordinates![0].lat.toFixed(5),
    }))

  liveCells.set(cell.key, items)
  writeCell(cell.key, items)
  return items
}

export const isHeadline = (kind: string) => HEADLINE.has(kind)

// Everything a pin's card wants that the map layer did not need to carry.
export async function articleSummary(pageId: string | number, signal?: AbortSignal) {
  const json = await ask<WikiQueryResponse>(
    {
      pageids: String(pageId),
      prop: 'extracts|info|pageimages',
      inprop: 'url',
      exintro: '1',
      explaintext: '1',
      exsentences: '3',
      piprop: 'thumbnail',
      pithumbsize: '800',
    },
    signal,
  )
  const page = Object.values(json.query?.pages || {})[0]
  if (!page) return null
  return {
    note: tidy(page.extract || ''),
    image: page.thumbnail?.source || null,
    source: typeof page.fullurl === 'string' ? page.fullurl : null,
  }
}

/* The opening lines for a batch of articles, for the seeder's second pass.

   Twenty at a time because TextExtracts returns nothing above that — silently,
   as ever, which is why the number is here rather than a hopeful larger one. */
export async function extractsFor(pageIds: Array<string | number>, signal?: AbortSignal) {
  const out = new Map<number, string>()
  for (let i = 0; i < pageIds.length; i += 20) {
    const batch = pageIds.slice(i, i + 20)
    const json = await ask<WikiQueryResponse>(
      {
        pageids: batch.join('|'),
        prop: 'extracts',
        exintro: '1',
        explaintext: '1',
        exsentences: '3',
        exlimit: 'max',
      },
      signal,
    )
    for (const page of Object.values(json.query?.pages || {})) {
      out.set(page.pageid, tidy(page.extract || ''))
    }
  }
  return out
}
