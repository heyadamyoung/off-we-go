/* =========================================================================
   Finding places

   Wikipedia's geosearch, which is free, needs no key, allows browser requests,
   and returns a name, a description and a photograph for everything near a
   coordinate — the three things a stop wants and the three things nobody wants
   to type.

   One request per search, not one per place: `generator=geosearch` feeds the
   found pages straight into prop=extracts|pageimages, so twelve places cost a
   single round trip of about 250ms.

   Content is CC BY-SA and images carry their own licences, so every place keeps
   the URL it came from and the app links back to it.
   ========================================================================= */
const API = 'https://en.wikipedia.org/w/api.php'
const MAX_RADIUS = 10000        // the API refuses more

// Roughly how far across the viewport is, so a search covers what you can see.
export function radiusForView(zoom, lat, widthPx = 1200) {
  const metresPerPx = 40075016.686 * Math.cos((lat * Math.PI) / 180) / (256 * Math.pow(2, zoom))
  return Math.round(Math.min(MAX_RADIUS, Math.max(250, (metresPerPx * widthPx) / 2)))
}

// Wikipedia's one-line description is a decent guide to which pin to draw.
const ICON_HINTS = [
  [/museum|gallery|exhibit/i, 'museum'],
  [/park|garden|forest|wood/i, 'walk'],
  [/restaurant|cafe|café|market|food|brewery|bar\b/i, 'food'],
  [/hotel|hostel|inn\b|accommodation/i, 'bed'],
  [/airport|station|terminal|railway/i, 'plane'],
  [/canal|harbour|harbor|port|river|bridge|boat|ship/i, 'boat'],
]
const iconFor = text => (ICON_HINTS.find(([re]) => re.test(text || '')) || [null, 'pin'])[1]

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
const fileNameOf = url => {
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

function tidy(text) {
  return (text || '')
    .replace(NESTED_ASIDE, '')
    .replace(ASIDE, '')
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const metresBetween = (a, b) => {
  const R = 6371000, r = d => (d * Math.PI) / 180
  const dLat = r(b[1] - a[1]), dLng = r(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const cache = new Map()

export async function findNearby({ lng, lat, radius = 1200, limit = 30, signal }) {
  const key = [lng.toFixed(3), lat.toFixed(3), radius, limit].join(':')
  if (cache.has(key)) return cache.get(key)

  const url = API + '?' + new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'geosearch',
    ggscoord: lat + '|' + lng,
    ggsradius: String(Math.min(MAX_RADIUS, Math.round(radius))),
    ggslimit: String(limit),
    prop: 'extracts|pageimages|coordinates|description|info',
    inprop: 'url',
    exintro: '1', explaintext: '1', exsentences: '2',
    piprop: 'thumbnail', pithumbsize: '800',
  })

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error('Could not reach Wikipedia (' + res.status + ')')
  const json = await res.json()

  const places = Object.values(json.query?.pages || {})
    .filter(p => p.coordinates?.length)
    .map(p => {
      const about = (p.description || '') + ' ' + (p.extract || '')
      const image = p.thumbnail?.source || null
      return {
        id: 'wk' + p.pageid,
        pageTitle: p.title,                              // needed to look deeper
        name: p.title.replace(/\s*\([^)]*\)\s*$/, ''),   // "NEMO (museum)" -> "NEMO"
        kind: p.description || '',
        note: tidy(p.extract),
        // A locator map is worse than no picture: it looks like a photograph in
        // the card and tells you nothing.
        image: image && !NOT_A_PHOTO.test(fileNameOf(image)) ? image : null,
        source: p.fullurl || null,
        lng: p.coordinates[0].lon,
        lat: p.coordinates[0].lat,
        icon: iconFor(about),
        metres: Math.round(metresBetween([lng, lat], [p.coordinates[0].lon, p.coordinates[0].lat])),
        destination: IS_A_DESTINATION.test(about),
        skip: NOT_A_PLACE.test(p.description || p.title) ||
              NOT_SOMEWHERE_YOU_GO.test(p.description || ''),
      }
    })
    .filter(p => !p.skip)
    // Places you would visit first, then whatever is nearest.
    .sort((a, b) => (b.destination - a.destination) || (a.metres - b.metres))

  cache.set(key, places)
  return places
}

/* Deciding whether an article is really about a stop.

   Plain containment is not enough: "Schiphol Airport" and "Amsterdam Airport
   Schiphol" are the same place and neither contains the other. So compare the
   distinctive words, ignoring the ones that appear in half of all place names —
   otherwise "Anne Frank House" happily matches "Rembrandt House". */
const STOPWORDS = new Set([
  'the', 'de', 'het', 'van', 'and', 'en', 'of', 'at', 'in', 'op',
  'museum', 'house', 'huis', 'hotel', 'park', 'airport', 'station', 'centre',
  'center', 'gallery', 'church', 'kerk', 'square', 'plein', 'cruise', 'tour',
  'amsterdam', 'city', 'national', 'royal', 'new', 'old',
])
const tokens = s => (s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().split(/[^a-z0-9]+/)
  .filter(w => w.length > 2 && !STOPWORDS.has(w))

export function namesMatch(a, b) {
  const A = tokens(a), B = tokens(b)
  if (!A.length || !B.length) return false
  if (A.some(w => B.includes(w))) return true
  // Also allow one distinctive word inside another, so "Foodhallen" finds
  // "De Hallen". Only for longer words: short fragments match anything.
  return A.some(x => B.some(y =>
    (x.length >= 5 && y.includes(x)) || (y.length >= 5 && x.includes(y))))
}

// The single best match for somewhere you already have — used to fill in a stop
// you placed by hand. Tight radius, because "nearest article" gets silly fast.
export async function describePlace({ lng, lat, name, radius = 250, strict = false }) {
  const near = await findNearby({ lng, lat, radius, limit: 20 })
  if (!near.length) return null
  const matched = name ? near.find(p => namesMatch(p.name, name)) : null
  if (matched) return matched
  // Unattended, a wrong picture is worse than no picture.
  return strict ? null : (name ? near[0] : near[0])
}

/* Fill in the stops that have no picture of their own.

   Runs unattended, so it is strict: a stop only takes a picture from an article
   whose name genuinely matches it. Anything unrecognised keeps its placeholder
   rather than being given a photograph of the building next door. */
export async function enrichStops(stops, { onOne } = {}) {
  const need = stops.filter(s => !s.src && s.name)
  const found = []
  await Promise.all(need.map(async stop => {
    try {
      const pl = await describePlace({
        lng: stop.lng, lat: stop.lat, name: stop.name, radius: 400, strict: true,
      })
      if (!pl) return
      const image = pl.image || (pl.pageTitle ? await imageForPage(pl.pageTitle).catch(() => null) : null)
      if (!image) return
      const patch = {
        id: stop.id, src: image, sourceUrl: pl.source || null,
        note: (stop.note || '').trim() ? undefined : pl.note || undefined,
      }
      found.push(patch)
      onOne?.(patch)
    } catch { /* one failure must not stop the rest */ }
  }))
  return found
}

/* Some articles lead with a logo rather than a photograph — the Van Gogh
   Museum is one — so the picture filter above correctly rejects it and leaves
   the place with nothing to show. Falling back to the first usable image in the
   article body costs two more requests, so it is done on demand, at the moment
   somebody actually adds that place, rather than for every search result.

   What comes back is not always the building: a museum often yields its most
   famous work. For a trip card that is a fair substitute, and it is always
   replaceable by one of your own photos. */
export async function imageForPage(pageTitle, signal) {
  if (!pageTitle) return null
  const list = await fetch(API + '?' + new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    titles: pageTitle, prop: 'images', imlimit: '25',
  }), { signal }).then(r => r.json()).catch(() => null)
  if (!list) return null

  const file = Object.values(list.query?.pages || {})
    .flatMap(p => p.images || [])
    .map(im => im.title)
    .find(t => /\.(jpe?g|png)$/i.test(t) && !NOT_A_PHOTO.test(t.replace(/^File:/, '')))
  if (!file) return null

  const info = await fetch(API + '?' + new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    titles: file, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '800',
  }), { signal }).then(r => r.json()).catch(() => null)

  return Object.values(info?.query?.pages || {})[0]?.imageinfo?.[0]?.thumburl || null
}


/* =========================================================================
   Listing the sights in an area

   The obvious version of this — one geosearch, take what comes back — is
   wrong, and measurably so. Geosearch returns the *nearest* articles, and near
   the middle of Amsterdam the forty nearest are canals, squats and side
   streets: the Rijksmuseum is only the sixty-ninth. Filtering that list cannot
   recover what the limit already threw away.

   So cast the net wide and rank it afterwards, by how many people read the
   article. Popularity is the closest free stand-in for "worth going to", and
   it needs no taste of my own encoded in a keyword list.

     1. geosearch, 500 articles, coordinates only — cheap and unfiltered
     2. drop the streets and districts by title
     3. keep every plausible destination, plus the nearest few regardless
     4. fetch description, extract, picture and readership for those
     5. rank by readers, then by distance

   Step 4 is the expensive one and it is batched in twenties, because both
   TextExtracts and PageViewInfo quietly return nothing above that — no error,
   no warning, just absent fields, which reads as "nobody visits the
   Rijksmuseum" rather than "you asked for too much".
   ========================================================================= */

// Matched without word boundaries: Dutch names are compounds, and \bmuseum\b
// does not match "Rijksmuseum" — which is how the city's best-known museum
// went missing from a list of its sights.
const LOOKS_LIKE_A_DESTINATION =
  /(museum|gallery|park|garden|church|kerk|cathedral|basilica|synagogue|mosque|temple|castle|palace|paleis|monument|memorial|tower|toren|bridge|brug|market|markt|square|plein|gracht|theatre|theater|zoo|aquarium|stadium|library|windmill|molen|statue|hall|huis|house|hof|gebouw|poort|station|harbou?r)/i

const BATCH = 20                 // extracts and pageviews both stop above this
const MAX_CANDIDATES = 120

const pause = ms => new Promise(r => setTimeout(r, ms))

/* Wikipedia refuses a request with no User-Agent. A browser always sends one;
   Node does not, which is why the seed script has to say who it is. */
let apiHeaders = {}
export function setApiHeaders(headers) { apiHeaders = headers || {} }

/* And it refuses too many of them: about two a second, after which it answers
   429 for a while. A single gate here rather than a delay at each call site,
   because the one that forgets is the one that gets everything else refused. */
/* Two a second is what the API tolerates, so that is the default everywhere —
   including the browser fallback, which used to fire a whole viewport's worth
   of cells at once. Nothing complained, because a refused cell is caught and
   dropped: the map just quietly held fewer attractions than it should have. */
let minGap = 450
let lastCall = 0
export function setApiThrottle(ms) { minGap = ms || 0 }

async function ask(params, signal) {
  const url = API + '?' + new URLSearchParams({ action: 'query', format: 'json', origin: '*', ...params })
  for (let attempt = 0; attempt < 4; attempt++) {
    if (minGap) {
      const wait = lastCall + minGap - Date.now()
      if (wait > 0) await pause(wait)
      lastCall = Date.now()
    }
    const res = await fetch(url, { signal, headers: apiHeaders })
    if (res.ok) {
      const text = await res.text()
      if (text.startsWith('{')) return JSON.parse(text)
    }
    if (attempt === 3) break
    // Honour Retry-After when it is offered; otherwise back off steeply, since
    // the usual cause is having asked for too much too quickly.
    const after = Number(res.headers.get('retry-after'))
    await pause(Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * (attempt + 1))
  }
  throw new Error('Could not reach Wikipedia')
}

const dailyReaders = page => {
  const counts = Object.values(page.pageviews || {}).filter(n => typeof n === 'number')
  return counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0
}

const sightsCache = new Map()

export async function findSights({ lng, lat, radius = 3000, limit = 40, signal }) {
  const key = [lng.toFixed(3), lat.toFixed(3), Math.round(radius / 250)].join(':')
  if (sightsCache.has(key)) return sightsCache.get(key).slice(0, limit)

  const wide = await ask({
    list: 'geosearch',
    gscoord: lat + '|' + lng,
    gsradius: String(Math.min(MAX_RADIUS, Math.max(500, Math.round(radius)))),
    gslimit: '500',
  }, signal)

  const found = (wide.query?.geosearch || []).filter(p => !NOT_A_PLACE.test(p.title))
  const candidates = [...new Map([
    ...found.filter(p => LOOKS_LIKE_A_DESTINATION.test(p.title)),
    ...found.slice(0, 30),                    // somewhere unremarkable but close still counts
  ].map(p => [p.pageid, p])).values()].slice(0, MAX_CANDIDATES)

  const away = new Map(candidates.map(p => [p.pageid, Math.round(p.dist)]))
  const detail = []
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH)
    const json = await ask({
      pageids: batch.map(p => p.pageid).join('|'),
      prop: 'extracts|pageimages|description|info|pageviews|coordinates', inprop: 'url',
      exintro: '1', explaintext: '1', exsentences: '2', exlimit: 'max',
      piprop: 'thumbnail', pithumbsize: '800', pvipdays: '14',
    }, signal)
    detail.push(...Object.values(json.query?.pages || {}))
    if (i + BATCH < candidates.length) await pause(80)   // be a good citizen
  }

  const places = detail
    .map(p => {
      const about = (p.description || '') + ' ' + (p.extract || '')
      const image = p.thumbnail?.source || null
      return {
        id: 'wk' + p.pageid,
        pageTitle: p.title,
        name: p.title.replace(/\s*\([^)]*\)\s*$/, '').replace(/,\s*Amsterdam$/i, ''),
        kind: p.description || '',
        note: tidy(p.extract),
        image: image && !NOT_A_PHOTO.test(fileNameOf(image)) ? image : null,
        source: p.fullurl || null,
        lng: p.coordinates?.[0]?.lon ?? null,
        lat: p.coordinates?.[0]?.lat ?? null,
        icon: iconFor(about),
        metres: away.get(p.pageid) ?? null,
        readers: Math.round(dailyReaders(p)),
        /* Tested against the one-line description only, never the article text.
           Run over the extract it threw away the Rijksmuseum, whose opening
           paragraph mentions the borough it stands in — the filter is meant to
           catch things that *are* a district, not things that name one. */
        skip: NOT_A_PLACE.test(p.description || '') ||
              NOT_SOMEWHERE_YOU_GO.test(p.description || ''),
      }
    })
    .filter(p => !p.skip)
    .sort((a, b) => (b.readers - a.readers) || (a.metres - b.metres))

  // Coordinates come from pass one; pass two is not asked for them again.
  for (const p of places) {
    if (p.lng == null) {
      const src = candidates.find(c => 'wk' + c.pageid === p.id)
      if (src) { p.lng = src.lon; p.lat = src.lat }
    }
  }

  sightsCache.set(key, places)
  return places.slice(0, limit)
}

/* =========================================================================
   Attractions on the map

   Not a search you run, but a layer that is simply there: everywhere the map
   goes, the castles, museums, lochs and monuments are already drawn.

   Geosearch caps at a ten-kilometre radius, so covering a country means
   covering it in circles. The map is tiled onto a fixed global grid of
   ten-kilometre cells; whatever cells the view touches get fetched once, are
   kept in the browser afterwards, and are never asked for again. Panning
   across Scotland fills it in cell by cell rather than in one doomed request.

   One cell is about 450 ms and comes back with a description and the name of a
   picture for roughly nine articles in ten, so a pin can open into a card with
   no further request at all.
   ========================================================================= */

const CELL_DEG = 0.12                       // ~13 km of latitude, so 10 km circles overlap
const lngStepAt = lat => CELL_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180))

export function cellsCovering({ west, south, east, north }, { limit = 12, centre } = {}) {
  const cells = []
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
const KINDS = [
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
  /^(the )?(capital |former |small |large )*(city|town|village|hamlet|burgh|settlement|community)\b/i

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

export async function attractionsInCell(cell, signal) {
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

  const items = Object.values(json.query?.pages || {})
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
      f: p.pageprops?.page_image_free || null,
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
export async function articleSummary(pageId, signal) {
  const json = await ask({
    pageids: String(pageId), prop: 'extracts|info|pageimages', inprop: 'url',
    exintro: '1', explaintext: '1', exsentences: '3',
    piprop: 'thumbnail', pithumbsize: '800',
  }, signal)
  const page = Object.values(json.query?.pages || {})[0]
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
export async function extractsFor(pageIds, signal) {
  const out = new Map()
  for (let i = 0; i < pageIds.length; i += 20) {
    const batch = pageIds.slice(i, i + 20)
    const json = await ask({
      pageids: batch.join('|'), prop: 'extracts',
      exintro: '1', explaintext: '1', exsentences: '3', exlimit: 'max',
    }, signal)
    for (const page of Object.values(json.query?.pages || {})) {
      out.set(page.pageid, tidy(page.extract))
    }
  }
  return out
}
