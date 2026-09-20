/* The three endpoints, and the policy that sits between them and the SQL.
 *
 * store.js knows how to ask PostGIS a question; rank.js knows what order the
 * answer goes in; coverage.js and fallback.js know what to do when we have not
 * ingested where the traveller is standing. This file is the only place that
 * knows all four, and the decisions it owns are the ones a reviewer will want
 * to argue with:
 *
 *   Never fabricate, never return nothing. A village with four places in a
 *   kilometre gets the ladder from rank.js — the radius grows and the floor
 *   drops, in that order, because a real place further away beats a doubtful
 *   one underfoot — and the answer says which radius it ended up using. What
 *   it never does is invent a row or round a confidence up.
 *
 *   Rank more than you show. The database is asked for several times the page,
 *   because `order by geom <-> point` returns the nearest and ranking is about
 *   kind and confidence as well as distance. Asking for twenty and ranking
 *   twenty would mean the Rijksmuseum at eight hundred metres never enters the
 *   list that a launderette at ten metres is already in.
 *
 *   Attribution is per record, not per response. A place Overture took from
 *   OpenStreetMap obliges us to say so; one it took from a business register
 *   does not. The licences travel on `sources[]` and the notices the client
 *   must render travel beside them, so nothing downstream has to know the
 *   rule.
 *
 *   Every record has the same shape whether it came from PostGIS or, degraded,
 *   from a Parquet file on somebody else's S3. The client renders one thing.
 *
 * Behind the same login as the rest of /api — `authenticated`, exactly as
 * flights/routes.js and cabins/index.js do it — because these lists are built
 * from a trip's geography and a public one would be a free typeahead over the
 * planet for anyone who found the URL.
 */

import { z } from 'zod'
import { cellKey, cellsForPoints, cellsWithin } from './cells.js'
import { createPlaceCoverage } from './coverage.js'
import { createPlaceFallback } from './fallback.js'
import { OSM_LICENSE, OVERTURE_LICENSE } from './overture.js'
import {
  CONFIDENCE_FLOOR,
  MAX_RADIUS_METRES,
  rankNearby,
  rankSearch,
  widen,
} from './rank.js'
import { nameSimilarity } from './resolve.js'
import { isCategory } from './taxonomy.js'
import { event, span, stamp } from '../tracing.js'

/** The most any one response will carry. A typeahead shows ten and a nearby
    list twenty; fifty is generous for a map that wants to draw the lot. */
export const MAX_LIMIT = 50
const DEFAULT_SEARCH_LIMIT = 10
const DEFAULT_NEARBY_LIMIT = 20
/** A nearby query with no radius. Four hundred metres is a few minutes' walk
    and the radius rank.js's decay was tuned against. */
export const DEFAULT_RADIUS_METRES = 1_000
/** Candidates fetched per record shown — see "rank more than you show". */
const OVERSAMPLE = 5
const MAX_CANDIDATES = 250
/** How far around `near` a degraded search reads. A name typed with a
    position is a question about the town you are in, not about the planet,
    and a bigger box is more row groups for no better answer. */
const SEARCH_FALLBACK_METRES = 3_000
/** How alike a degraded result's name must be to count as a hit. pg_trgm's
    own default threshold, so the fallback and the index agree about what a
    match is. */
const SEARCH_FALLBACK_SIMILARITY = 0.3

/* Cache-Control, and why these numbers.
 *
 * All `private`: every response is built for one signed-in person and some of
 * them are biased by that person's trip. Nothing here may sit in a shared
 * cache.
 *
 * A place record — a day. The underlying row changes when an ingest refreshes
 * its cell, which is monthly; a day is already an order of magnitude shorter
 * than the data's own life, and it is what makes a map full of pins cost one
 * request each per day rather than one per pan.
 *
 * Nearby — two minutes. The list for a fixed point changes only when its cell
 * is ingested, so it could be longer; two minutes is the ceiling on how long
 * a traveller who has just walked somewhere keeps seeing the previous corner's
 * answer, and it still absorbs the burst of a map being dragged about.
 *
 * Search — thirty seconds. A typeahead re-issues on every keystroke and the
 * only hit worth having is the same finished query repeated inside a session.
 * Longer would pin a half-typed query's answer to the screen.
 *
 * Anything degraded — `no-store`. A degraded list is by definition the wrong
 * answer, and its cell is being ingested right now. Caching it would keep the
 * wrong answer on screen for exactly as long as it takes to become the right
 * one.
 */
const PLACE_CACHE = 'private, max-age=86400'
const NEARBY_CACHE = 'private, max-age=120'
const SEARCH_CACHE = 'private, max-age=30'
const DEGRADED_CACHE = 'no-store'

/* The notices a client must render, by licence. ODbL is the one with teeth:
   OpenStreetMap's licence requires the attribution to be shown wherever the
   data is, which is why it rides on the record and not in a footer somewhere
   this layer cannot see. */
const NOTICES = Object.freeze({
  [OSM_LICENSE]: {
    license: OSM_LICENSE,
    notice: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
  },
  [OVERTURE_LICENSE]: {
    license: OVERTURE_LICENSE,
    notice: '© Overture Maps Foundation',
    url: 'https://docs.overturemaps.org/attribution/',
  },
  'Apache-2.0': {
    license: 'Apache-2.0',
    notice: '© Foursquare, Apache-2.0',
    url: 'https://location.foursquare.com/places/',
  },
})

/** The notices for one record's sources, deduplicated and ordered. A licence
    nobody has written a notice for is still named, so a new source shows up as
    an unattributed licence rather than as nothing. */
export function attributionFor(sources) {
  const out = new Map()
  for (const source of sources || []) {
    const license = source?.license
    if (!license || out.has(license)) continue
    out.set(license, NOTICES[license] || { license, notice: license, url: null })
  }
  return [...out.values()].sort((a, b) => a.license.localeCompare(b.license))
}

/** One record as the API gives it: the place, who said so, and what the client
    has to print. `score` is internal and does not travel. */
function present(record) {
  const { score: _score, ...place } = record
  const sources = place.sources || []
  return { ...place, sources, attribution: attributionFor(sources) }
}

/* A box of `metres` around a point, for the Parquet reader. Latitude is
   111.32 km a degree everywhere; longitude is that times the cosine, and past
   89° the cosine goes to nothing, so the box becomes the whole parallel rather
   than a division by almost zero. cells.js does the same arithmetic to name
   cells; this needs the box itself, which no caller can get from a cell key
   without rounding out to a whole degree — and a whole degree is up to
   168,000 rows where a kilometre is a few hundred. */
function boxAround(lng, lat, metres) {
  const north = metres / 111_320
  const cosine = Math.cos((lat * Math.PI) / 180)
  const east = Math.abs(cosine) < 0.02 ? 180 : north / cosine
  return { west: lng - east, south: lat - north, east: lng + east, north: lat + north }
}

const coordinates = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/, 'near is lng,lat')
  .transform(value => {
    const [lng, lat] = value.split(',').map(Number)
    return { lng, lat }
  })
  .refine(
    point => Math.abs(point.lng) <= 180 && Math.abs(point.lat) <= 90,
    'near is a position on earth',
  )

/* Capped rather than refused: somebody asking for a thousand results or a
   radius of half the planet has made a mistake we can answer anyway, and a
   400 in a typeahead is a blank screen. Nonsense — letters where a number
   goes — is still a 400, because that is a bug in the caller. */
const limitOf = fallbackValue =>
  z.coerce
    .number()
    .int()
    .transform(value => Math.min(MAX_LIMIT, Math.max(1, value)))
    .default(fallbackValue)

const searchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  near: coordinates.optional(),
  trip_id: z.uuid().optional(),
  limit: limitOf(DEFAULT_SEARCH_LIMIT),
})

const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce
    .number()
    .positive()
    .transform(value => Math.min(MAX_RADIUS_METRES, value))
    .default(DEFAULT_RADIUS_METRES),
  category: z
    .string()
    .trim()
    .refine(isCategory, 'category is one of the twenty in places/taxonomy.js')
    .optional(),
  limit: limitOf(DEFAULT_NEARBY_LIMIT),
})

const message = error => error.issues?.[0]?.message || 'That query is not valid'

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} options
 * @param {object} options.repository
 * @param {Function} options.authenticated
 * @param {object} [options.coverage] a queue from coverage.js; one is made if absent
 * @param {object} [options.fallback] a reader from fallback.js; without a release
 *   index one is made that refuses, which is what an un-configured deployment wants
 * @param {Record<string, string>} [options.releases] source → current release
 * @param {() => Date} [options.clock]
 */
export function registerPlaceRoutes(
  app,
  { repository, authenticated, coverage = null, fallback = null, releases = {}, clock } = {},
) {
  const cells = coverage ?? createPlaceCoverage({ repository, releases, clock })
  const bucket = fallback ?? createPlaceFallback({ coverage: cells })

  /* The trip write path wants to tell the queue that a trip's stops moved, and
     app.js is only allowed one call to register all of this. Decorating is how
     the flights sources are handed about too. */
  app.decorate('placeCoverage', cells)

  /** Whether this deployment's repository has the places half at all. The
      memory repository the older tests build servers with does not, and a
      route that threw a 500 into those runs would be a worse answer than one
      that says so. */
  const servable = Boolean(repository?.searchPlaces && repository?.nearbyPlaces)
  const unavailable = reply =>
    reply.code(503).send({ error: 'The places layer is not available on this deployment' })

  /** Sources for a page of records, in one round trip. */
  async function withSources(records) {
    const ids = records.map(record => record.id).filter(Boolean)
    const sources = repository.placeSources ? await repository.placeSources(ids) : new Map()
    return records.map(record => ({
      ...record,
      sources: record.sources || sources.get(record.id) || [],
    }))
  }

  /**
   * What coverage says about the cells a query touched, and — when they are
   * not ready — the records the bucket can add. Returns the degraded shape the
   * contract asks for, or null when everything was ready.
   */
  async function degradedFor({ lng, lat, radius, limit, want }) {
    const touched = cellsWithin(lng, lat, radius)
    const status = await cells.ensure(touched)
    if (!status.missing.length) return null
    const home = cellKey(lng, lat)
    const row = status.coverage?.get(home)
    /* A coverage miss is the metric that says tier two is not keeping up; it
       is recorded whether or not a fallback is even configured. */
    event('places coverage miss', {
      'places.coverage.cell': home,
      'places.coverage.status': row?.status ?? 'none',
      'places.coverage.missing': status.missing.length,
    })
    const read = bucket.available
      ? await bucket.readBounds(boxAround(lng, lat, radius), {
          limit: want,
          centre: { lng, lat },
          cells: status.missing,
        })
      : { places: [], reason: 'unavailable' }
    return {
      coverage: { cell: home, status: row?.status ?? 'pending' },
      places: read.places,
      reason: read.reason,
      limit,
    }
  }

  app.get('/api/places/search', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!servable) return unavailable(reply)
    const parsed = searchQuery.safeParse(request.query || {})
    if (!parsed.success) return reply.code(400).send({ error: message(parsed.error) })
    const { q, limit } = parsed.data

    return span('search places', { 'places.query.limit': limit }, async () => {
      const started = Date.now()
      let near = parsed.data.near ?? null
      let scope = null
      if (parsed.data.trip_id) {
        const stops = await repository.listStops(user, parsed.data.trip_id)
        if (!stops) return reply.code(404).send({ error: 'That trip was not found' })
        const points = stops.filter(
          stop => Number.isFinite(Number(stop.lng)) && Number.isFinite(Number(stop.lat)),
        )
        scope = cellsForPoints(points.map(stop => ({ lng: +stop.lng, lat: +stop.lat })))
        if (!near && points[0]) near = { lng: +points[0].lng, lat: +points[0].lat }
      }

      const want = Math.min(MAX_CANDIDATES, limit * OVERSAMPLE)
      const rows = await repository.searchPlaces({ q, near, cells: scope, limit: want })
      let ranked = rankSearch(rows, q)

      /* A name search can only fall back where it has somewhere to look. With
         no position there is no box, and reading the planet to find a café is
         not a thing this layer will do. */
      let degraded = null
      if (near) {
        degraded = await degradedFor({
          lng: near.lng,
          lat: near.lat,
          radius: SEARCH_FALLBACK_METRES,
          limit,
          want,
        })
        if (degraded?.places.length) {
          const known = new Set(ranked.map(place => place.gersId).filter(Boolean))
          const extra = degraded.places
            .filter(place => !known.has(place.gersId))
            .map(place => ({ ...place, similarity: nameSimilarity(place.name, q) }))
            .filter(place => place.similarity >= SEARCH_FALLBACK_SIMILARITY)
          ranked = rankSearch([...ranked, ...extra], q)
        }
      }

      const page = await withSources(ranked.slice(0, limit))
      const ms = Date.now() - started
      stamp({
        'places.query.kind': 'search',
        'places.query.ms': ms,
        'places.result.count': page.length,
        'places.degraded': Boolean(degraded),
        'places.fallback.reason': degraded?.reason ?? null,
      })
      reply.header('cache-control', degraded ? DEGRADED_CACHE : SEARCH_CACHE)
      return {
        places: page.map(present),
        degraded: Boolean(degraded),
        ...(degraded ? { coverage: degraded.coverage } : {}),
      }
    })
  })

  app.get('/api/places/nearby', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!servable) return unavailable(reply)
    const parsed = nearbyQuery.safeParse(request.query || {})
    if (!parsed.success) return reply.code(400).send({ error: message(parsed.error) })
    const { lat, lng, category = null, limit } = parsed.data

    return span(
      'nearby places',
      { 'places.query.radius': parsed.data.radius, 'places.query.category': category },
      async () => {
        const started = Date.now()
        const base = { radius: parsed.data.radius, floor: CONFIDENCE_FLOOR }
        const want = Math.min(MAX_CANDIDATES, limit * OVERSAMPLE)
        let attempt = 0
        let current = { ...base }
        let ranked = []
        /* The ladder from rank.js, walked here rather than there because each
           rung is a database round trip. It stops the moment a rung finds
           enough, and `widen` stops it at 50 km whatever anybody asked for. */
        for (;;) {
          const rows = await repository.nearbyPlaces({
            lat,
            lng,
            radius: current.radius,
            category,
            floor: current.floor,
            limit: want,
          })
          ranked = rankNearby(rows, { radius: current.radius, category, floor: current.floor })
          const next = widen(ranked.length, attempt, base)
          if (!next) break
          current = next
          attempt += 1
        }

        const degraded = await degradedFor({
          lng,
          lat,
          radius: current.radius,
          limit,
          want,
        })
        if (degraded?.places.length) {
          const known = new Set(ranked.map(place => place.gersId).filter(Boolean))
          const extra = degraded.places.filter(place => !known.has(place.gersId))
          ranked = rankNearby([...ranked, ...extra], {
            radius: current.radius,
            category,
            floor: current.floor,
          })
        }

        const page = await withSources(ranked.slice(0, limit))
        const ms = Date.now() - started
        stamp({
          'places.query.kind': 'nearby',
          'places.query.ms': ms,
          'places.query.widened': attempt,
          'places.query.final_radius': current.radius,
          'places.result.count': page.length,
          'places.degraded': Boolean(degraded),
          'places.fallback.reason': degraded?.reason ?? null,
        })
        reply.header('cache-control', degraded ? DEGRADED_CACHE : NEARBY_CACHE)
        return {
          places: page.map(present),
          /* What was actually asked of the database, which is not always what
             was asked of the route: a sparse area widens, and a list of things
             3 km away must not read as a list of things 400 m away. */
          radius: current.radius,
          floor: current.floor,
          widened: attempt,
          degraded: Boolean(degraded),
          ...(degraded ? { coverage: degraded.coverage } : {}),
        }
      },
    )
  })

  app.get('/api/places/:id', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!servable) return unavailable(reply)
    const id = z.uuid().safeParse(request.params?.id)
    if (!id.success) return reply.code(400).send({ error: 'A place id is a uuid' })

    return span('read place', {}, async () => {
      const found = await repository.placeById(id.data)
      if (!found) return reply.code(404).send({ error: 'No such place' })
      if (found.gone) {
        stamp({ 'places.record.gone': true })
        /* 410, not 404: the id was real and we know what became of it. A stop
           pointing here can say "this has closed" instead of losing its pin
           to a generic not-found. */
        reply.header('cache-control', PLACE_CACHE)
        return reply
          .code(410)
          .send({ place: null, gone: true, reason: found.reason, at: found.at })
      }
      stamp({
        'places.record.category': found.category,
        'places.record.sources': found.sources.length,
        'places.record.redirected': Boolean(found.redirectedFrom),
      })
      reply.header('cache-control', PLACE_CACHE)
      const { redirectedFrom = null, ...record } = found
      return { place: present(record), redirectedFrom }
    })
  })
}
