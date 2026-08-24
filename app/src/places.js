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

async function ask(params, signal) {
  const url = API + '?' + new URLSearchParams({ action: 'query', format: 'json', origin: '*', ...params })
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { signal })
    if (res.ok) {
      const text = await res.text()
      if (text.startsWith('{')) return JSON.parse(text)
    }
    if (attempt < 2) await pause(700 * (attempt + 1))   // usually the rate limiter
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
