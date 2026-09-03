import {
  ask,
  pause,
  type WikiGeosearchHit,
  type WikiPage,
  type WikiQueryResponse,
} from '../../../shared/api/wikipedia-client'
import {
  MAX_RADIUS,
  NOT_A_PHOTO,
  NOT_A_PLACE,
  NOT_SOMEWHERE_YOU_GO,
  fileNameOf,
  iconFor,
  tidy,
} from '../../../shared/lib/place-format'

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

const BATCH = 20 // extracts and pageviews both stop above this
const MAX_CANDIDATES = 120

const dailyReaders = (page: WikiPage) => {
  const counts = Object.values(page.pageviews || {}).filter(
    (n): n is number => typeof n === 'number',
  )
  return counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0
}

/** one ranked sight, the shape the panel renders and the editor adds from */
export interface SightPlace {
  id: string
  pageTitle: string
  name: string
  kind: string
  note: string
  image: string | null
  source: string | null
  lng: number | null
  lat: number | null
  icon: string
  metres: number | null
  readers: number
  skip: boolean
}

const sightsCache = new Map<string, SightPlace[]>()

export async function findSights({
  lng,
  lat,
  radius = 3000,
  limit = 40,
  signal,
}: {
  lng: number
  lat: number
  radius?: number
  limit?: number
  signal?: AbortSignal
}): Promise<SightPlace[]> {
  const key = [lng.toFixed(3), lat.toFixed(3), Math.round(radius / 250)].join(':')
  if (sightsCache.has(key)) return sightsCache.get(key)!.slice(0, limit)

  const wide = await ask<WikiQueryResponse>(
    {
      list: 'geosearch',
      gscoord: lat + '|' + lng,
      gsradius: String(Math.min(MAX_RADIUS, Math.max(500, Math.round(radius)))),
      gslimit: '500',
    },
    signal,
  )

  const found = (wide.query?.geosearch || []).filter(p => !NOT_A_PLACE.test(p.title))
  const candidates = [
    ...new Map<number, WikiGeosearchHit>(
      [
        ...found.filter(p => LOOKS_LIKE_A_DESTINATION.test(p.title)),
        ...found.slice(0, 30), // somewhere unremarkable but close still counts
      ].map(p => [p.pageid, p]),
    ).values(),
  ].slice(0, MAX_CANDIDATES)

  const away = new Map(candidates.map(p => [p.pageid, Math.round(p.dist ?? 0)]))
  const detail: WikiPage[] = []
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH)
    const json = await ask<WikiQueryResponse>(
      {
        pageids: batch.map(p => p.pageid).join('|'),
        prop: 'extracts|pageimages|description|info|pageviews|coordinates',
        inprop: 'url',
        exintro: '1',
        explaintext: '1',
        exsentences: '2',
        exlimit: 'max',
        piprop: 'thumbnail',
        pithumbsize: '800',
        pvipdays: '14',
      },
      signal,
    )
    detail.push(...Object.values(json.query?.pages || {}))
    if (i + BATCH < candidates.length) await pause(80) // be a good citizen
  }

  const places = detail
    .map((p): SightPlace => {
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
        skip:
          NOT_A_PLACE.test(p.description || '') || NOT_SOMEWHERE_YOU_GO.test(p.description || ''),
      }
    })
    .filter(p => !p.skip)
    .sort((a, b) => b.readers - a.readers || (a.metres ?? 0) - (b.metres ?? 0))

  // Coordinates come from pass one; pass two is not asked for them again.
  for (const p of places) {
    if (p.lng == null) {
      const src = candidates.find(c => 'wk' + c.pageid === p.id)
      if (src) {
        p.lng = src.lon
        p.lat = src.lat
      }
    }
  }

  sightsCache.set(key, places)
  return places.slice(0, limit)
}
