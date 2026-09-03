import { API, ask, type WikiQueryResponse } from '../../../shared/api/wikipedia-client'
import {
  IS_A_DESTINATION,
  MAX_RADIUS,
  NOT_A_PHOTO,
  NOT_A_PLACE,
  NOT_SOMEWHERE_YOU_GO,
  fileNameOf,
  iconFor,
  tidy,
} from '../../../shared/lib/place-format'
import { metres as metresBetween } from '../../../shared/lib/geo'
import type { Id, Stop } from '../../../shared/model/types'

// Roughly how far across the viewport is, so a search covers what you can see.
export function radiusForView(zoom: number, lat: number, widthPx = 1200) {
  const metresPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom)
  return Math.round(Math.min(MAX_RADIUS, Math.max(250, (metresPerPx * widthPx) / 2)))
}

/** One place worth suggesting, straight off a Wikipedia geosearch. */
export interface NearbyPlace {
  id: string
  pageTitle: string
  name: string
  kind: string
  note: string
  image: string | null
  source: string | null
  lng: number
  lat: number
  icon: string
  metres: number
  destination: boolean
  skip: boolean
}

const cache = new Map<string, NearbyPlace[]>()

export async function findNearby({
  lng,
  lat,
  radius = 1200,
  limit = 30,
  signal,
}: {
  lng: number
  lat: number
  radius?: number
  limit?: number
  signal?: AbortSignal
}): Promise<NearbyPlace[]> {
  const key = [lng.toFixed(3), lat.toFixed(3), radius, limit].join(':')
  if (cache.has(key)) return cache.get(key)!

  const url =
    API +
    '?' +
    new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'geosearch',
      ggscoord: lat + '|' + lng,
      ggsradius: String(Math.min(MAX_RADIUS, Math.round(radius))),
      ggslimit: String(limit),
      prop: 'extracts|pageimages|coordinates|description|info',
      inprop: 'url',
      exintro: '1',
      explaintext: '1',
      exsentences: '2',
      piprop: 'thumbnail',
      pithumbsize: '800',
    })

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error('Could not reach Wikipedia (' + res.status + ')')
  const json = (await res.json()) as WikiQueryResponse

  const places = Object.values(json.query?.pages || {})
    .filter(p => p.coordinates?.length)
    .map((p): NearbyPlace => {
      const about = (p.description || '') + ' ' + (p.extract || '')
      const image = p.thumbnail?.source || null
      return {
        id: 'wk' + p.pageid,
        pageTitle: p.title, // needed to look deeper
        name: p.title.replace(/\s*\([^)]*\)\s*$/, ''), // "NEMO (museum)" -> "NEMO"
        kind: p.description || '',
        note: tidy(p.extract),
        // A locator map is worse than no picture: it looks like a photograph in
        // the card and tells you nothing.
        image: image && !NOT_A_PHOTO.test(fileNameOf(image)) ? image : null,
        source: p.fullurl || null,
        lng: p.coordinates![0].lon,
        lat: p.coordinates![0].lat,
        icon: iconFor(about),
        metres: Math.round(
          metresBetween([lng, lat], [p.coordinates![0].lon, p.coordinates![0].lat]),
        ),
        destination: IS_A_DESTINATION.test(about),
        skip:
          NOT_A_PLACE.test(p.description || p.title) ||
          NOT_SOMEWHERE_YOU_GO.test(p.description || ''),
      }
    })
    .filter(p => !p.skip)
    // Places you would visit first, then whatever is nearest.
    .sort((a, b) => Number(b.destination) - Number(a.destination) || a.metres - b.metres)

  cache.set(key, places)
  return places
}

/* Deciding whether an article is really about a stop.

   Plain containment is not enough: "Schiphol Airport" and "Amsterdam Airport
   Schiphol" are the same place and neither contains the other. So compare the
   distinctive words, ignoring the ones that appear in half of all place names —
   otherwise "Anne Frank House" happily matches "Rembrandt House". */
const STOPWORDS = new Set([
  'the',
  'de',
  'het',
  'van',
  'and',
  'en',
  'of',
  'at',
  'in',
  'op',
  'museum',
  'house',
  'huis',
  'hotel',
  'park',
  'airport',
  'station',
  'centre',
  'center',
  'gallery',
  'church',
  'kerk',
  'square',
  'plein',
  'cruise',
  'tour',
  'amsterdam',
  'city',
  'national',
  'royal',
  'new',
  'old',
])
const tokens = (s: string | null | undefined) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))

export function namesMatch(a: string | null | undefined, b: string | null | undefined) {
  const A = tokens(a),
    B = tokens(b)
  if (!A.length || !B.length) return false
  if (A.some(w => B.includes(w))) return true
  // Also allow one distinctive word inside another, so "Foodhallen" finds
  // "De Hallen". Only for longer words: short fragments match anything.
  return A.some(x =>
    B.some(y => (x.length >= 5 && y.includes(x)) || (y.length >= 5 && x.includes(y))),
  )
}

// The single best match for somewhere you already have — used to fill in a stop
// you placed by hand. Tight radius, because "nearest article" gets silly fast.
export async function describePlace({
  lng,
  lat,
  name,
  radius = 250,
  strict = false,
}: {
  lng: number
  lat: number
  name?: string | null
  radius?: number
  strict?: boolean
}): Promise<NearbyPlace | null> {
  const near = await findNearby({ lng, lat, radius, limit: 20 })
  if (!near.length) return null
  const matched = name ? near.find(p => namesMatch(p.name, name)) : null
  if (matched) return matched
  // Unattended, a wrong picture is worse than no picture.
  return strict ? null : name ? near[0] : near[0]
}

/** what enrichment learned about one stop: a picture, and a note if it had none */
export interface StopEnrichment {
  id: Id
  src: string
  sourceUrl: string | null
  note?: string
}

/* Fill in the stops that have no picture of their own.

   Runs unattended, so it is strict: a stop only takes a picture from an article
   whose name genuinely matches it. Anything unrecognised keeps its placeholder
   rather than being given a photograph of the building next door. */
export async function enrichStops(
  stops: Stop[],
  { onOne }: { onOne?: (patch: StopEnrichment) => void } = {},
) {
  const need = stops.filter(s => !s.src && s.name)
  const found: StopEnrichment[] = []
  await Promise.all(
    need.map(async stop => {
      try {
        const pl = await describePlace({
          lng: stop.lng,
          lat: stop.lat,
          name: stop.name,
          radius: 400,
          strict: true,
        })
        if (!pl) return
        const image =
          pl.image || (pl.pageTitle ? await imageForPage(pl.pageTitle).catch(() => null) : null)
        if (!image) return
        const patch: StopEnrichment = {
          id: stop.id,
          src: image,
          sourceUrl: pl.source || null,
          note: (stop.note || '').trim() ? undefined : pl.note || undefined,
        }
        found.push(patch)
        onOne?.(patch)
      } catch {
        /* one failure must not stop the rest */
      }
    }),
  )
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
export async function imageForPage(pageTitle: string, signal?: AbortSignal) {
  if (!pageTitle) return null

  /* Both calls go through ask(), like everything else here. They used to use
     fetch directly, which meant no User-Agent — fine in a browser, which sends
     its own, and fatal in Node, where Wikipedia answers with a page of HTML
     that .json() rejects and a .catch turned into a quiet null. It looked for
     all the world like these articles simply had no pictures. */
  const list = await ask<WikiQueryResponse>(
    {
      titles: pageTitle,
      prop: 'images',
      imlimit: '40',
    },
    signal,
  ).catch(() => null)
  if (!list) return null

  const file = Object.values(list.query?.pages || {})
    .flatMap(p => p.images || [])
    .map(im => im.title)
    .find(t => /\.(jpe?g|png)$/i.test(t) && !NOT_A_PHOTO.test(t.replace(/^File:/, '')))
  if (!file) return null

  const info = await ask<WikiQueryResponse>(
    {
      titles: file,
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '960',
    },
    signal,
  ).catch(() => null)

  return Object.values(info?.query?.pages || {})[0]?.imageinfo?.[0]?.thumburl || null
}
