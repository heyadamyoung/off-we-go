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

// Worth surfacing first.
const IS_A_DESTINATION =
  /\b(museum|gallery|park|garden|church|cathedral|basilica|synagogue|mosque|temple|castle|palace|monument|memorial|tower|bridge|market|square|theatre|theater|zoo|aquarium|stadium|restaurant|cafe|café|brewery|library|station|harbou?r|windmill|statue|house|hall)\b/i

const metresBetween = (a, b) => {
  const R = 6371000, r = d => (d * Math.PI) / 180
  const dLat = r(b[1] - a[1]), dLng = r(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const cache = new Map()

export async function findPlaces({ lng, lat, radius = 1200, limit = 30, signal }) {
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
        note: (p.extract || '').trim(),
        // A locator map is worse than no picture: it looks like a photograph in
        // the card and tells you nothing.
        image: image && !NOT_A_PHOTO.test(fileNameOf(image)) ? image : null,
        source: p.fullurl || null,
        lng: p.coordinates[0].lon,
        lat: p.coordinates[0].lat,
        icon: iconFor(about),
        metres: Math.round(metresBetween([lng, lat], [p.coordinates[0].lon, p.coordinates[0].lat])),
        destination: IS_A_DESTINATION.test(about),
        skip: NOT_A_PLACE.test(p.description || p.title),
      }
    })
    .filter(p => !p.skip)
    // Places you would visit first, then whatever is nearest.
    .sort((a, b) => (b.destination - a.destination) || (a.metres - b.metres))

  cache.set(key, places)
  return places
}

// The single best match for somewhere you already have — used to fill in a stop
// you placed by hand. Tight radius, because "nearest article" gets silly fast.
export async function describePlace({ lng, lat, name, radius = 250 }) {
  const near = await findPlaces({ lng, lat, radius, limit: 10 })
  if (!near.length) return null
  if (!name) return near[0]
  const want = name.trim().toLowerCase()
  return near.find(p => p.name.toLowerCase().includes(want) || want.includes(p.name.toLowerCase()))
      || near[0]
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
