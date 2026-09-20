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
  LABEL_ZOOMS,
  MAX_RADIUS_METRES,
  VIEW_WEIGHT,
  markRank,
  rankNearby,
  rankSearch,
  widen,
} from './rank.js'
import { nameSimilarity } from './resolve.js'
import { isCategory } from './taxonomy.js'
import { zoomForBounds } from './tiles.js'
import { shownAs } from './enrich/enrich.js'
import { enqueue, readEnrichment, WANTED_NOW } from './enrich/store.js'
import { event, span, stamp } from '../tracing.js'

/** The most any one response will carry. A typeahead shows ten and a nearby
    list twenty; fifty is generous for a map that wants to draw the lot. */
export const MAX_LIMIT = 50
/** Pins on a map, which is a different question: a map draws hundreds of dots
    happily and clusters what it cannot. Measured at 500 over an Amsterdam
    viewport of 168,523 places: 33 ms. */
export const MAX_PINS = 1_000
const DEFAULT_PINS = 300
/** A viewport whose best pins are all below this weight is a viewport with
    nothing worth a dot from orbit — see VIEW_KIND in rank.js on why the
    catch-all category sits under the named ones. */
const HEADLINE_WEIGHT = 0.65
const DEFAULT_SEARCH_LIMIT = 10
const DEFAULT_NEARBY_LIMIT = 20
/** A nearby query with no radius. A kilometre is a quarter of an hour's walk,
    and it is the radius the measurements were taken at: 1 km p50 1.5 ms,
    p95 2.6 ms over a cell holding 168,523 places. */
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
/* Nothing keeps a card we are still filling in — not the browser, not
   anything between here and it. The same rule as an unfinished tile. */
const PLACE_UNSETTLED = 'no-store'
const NEARBY_CACHE = 'private, max-age=120'
const SEARCH_CACHE = 'private, max-age=30'
const DEGRADED_CACHE = 'no-store'
/* A tile is the same bytes for everybody, and stays so until the data behind
   it is re-ingested — which is a release, not a minute. `public` because
   there is nothing of anybody's trip in it, and the whole point of a tiled
   map is that the second look at a square is free. */
const TILE_CACHE = 'public, max-age=3600, stale-while-revalidate=86400'
/** A square whose ground is still being ingested: right for now and wrong in
    ten minutes, so nothing between here and the screen may keep it. */
const TILE_UNSETTLED = 'no-store'

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

/** How many cells one query may ask coverage about.
 *
 * Nine is the home cell and its ring, which is every cell a sane radius can
 * reach. Past 89° of latitude the longitude span becomes the whole parallel —
 * the cosine goes to nothing and a kilometre is 360 degrees wide — so
 * `cellsWithin` correctly returns all 360 columns, and a single GET at the
 * smallest radius would read and upsert 360 coverage rows. A hundred of those
 * writes thirty-six thousand pending cells of polar ocean for the drain to
 * work through. Above the cap the query is about the cell it is standing in
 * and nothing else, which at that latitude is the only honest answer anyway.
 */
const MAX_COVERAGE_CELLS = 9

const coverageCells = (lng, lat, radius, home) => {
  const touched = cellsWithin(lng, lat, radius)
  return touched.length > MAX_COVERAGE_CELLS ? [home] : touched
}

/** A pin, which is less than a place: a map draws a dot and a label, and
    sending an address, a phone number and a provenance trail for each of
    three hundred of them is bytes nobody renders. Tapping one asks
    /api/places/:id for the rest. */
const pin = record => ({
  id: record.id,
  name: record.name,
  lng: record.lng,
  lat: record.lat,
  category: record.category,
  confidence: record.confidence,
  /* Whether it deserves a dot when the map is zoomed out. Decided here
     because the weighting that decides it lives here; the client should not
     be carrying a second copy of the taxonomy to answer the same question a
     different way. */
  big: VIEW_WEIGHT[record.category] >= HEADLINE_WEIGHT,
  /* The zoom this one earns its dot at, and which place wins when two want
     the same piece of screen.
     The zoom is read, not worked out. It was computed once, from where this
     place comes among its neighbours (places/store.js assignLabelZoom), and
     recomputing it here from the category would be the old table back again —
     the one that made a city a cluster of dots and an island bare. A record
     from before that pass has none yet, and the floor zoom is the honest
     answer for it: drawn when you are standing on it, rather than never.
     `big` stays beside them because a client from before this release still
     reads it, and a map that draws nothing is worse than one that draws the
     old way for an afternoon. */
  minzoom: Number.isFinite(record.labelZoom) ? record.labelZoom : LABEL_ZOOMS.from,
  rank: markRank(record),
})

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

/** Our own primary key, as opposed to an upstream id. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* A map's viewport. Degrees rather than a radius, because that is what a map
   has, and bounded to the planet so a bad number cannot ask for an envelope
   the size of the solar system. The pin limit is generous — a map draws
   hundreds of dots happily and clusters the rest — and the floor is the same
   suppression floor every other query uses. */
/* A tile address. Integers, and bounded by the deepest zoom the map goes to —
   an unbounded z is an unbounded ST_TileEnvelope and a query nobody asked
   for. 20 is past the point where the basemap itself has detail. */
const tileQuery = z.object({
  z: z.coerce.number().int().min(0).max(20),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
})

const viewQuery = z
  .object({
    west: z.coerce.number().min(-180).max(180),
    east: z.coerce.number().min(-180).max(180),
    south: z.coerce.number().min(-90).max(90),
    north: z.coerce.number().min(-90).max(90),
    limit: z.coerce
      .number()
      .int()
      .transform(value => Math.min(MAX_PINS, Math.max(1, value)))
      .default(DEFAULT_PINS),
    /* Zoomed out, only the things worth a dot from orbit. The client sends
       this rather than a zoom level, because what counts as "worth it" is a
       decision about data and belongs on this side. */
    headline: z
      .enum(['true', 'false'])
      .optional()
      .transform(value => value === 'true'),
  })
  .refine(box => box.north > box.south, 'north must be above south')

const PLACE_ID = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, 'A place id is a uuid or an upstream id')

const message = error => error.issues?.[0]?.message || 'That query is not valid'

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} options
 * @param {object} options.repository
 * @param {Function} options.authenticated
 * @param {object} [options.coverage] a queue from coverage.js; one is made if absent
 * @param {object} [options.fallback] a reader from fallback.js; without a release
 *   index one is made that refuses, which is what an un-configured deployment wants
 * @param {Record<string, string>|(() => Record<string, string>)} [options.releases]
 *   source → current release, or a function returning it: the current release
 *   is discovered at runtime, so it is not known when the routes are built
 * @param {() => Promise<object|null>} [options.upstream] a loadIndex from upstream.js
 * @param {{loadFooter?: Function, saveFooter?: Function}} [options.footers]
 * @param {() => Date} [options.clock]
 */
export function registerPlaceRoutes(
  app,
  {
    repository,
    authenticated,
    coverage = null,
    fallback = null,
    releases = {},
    upstream = null,
    footers = {},
    clock,
  } = {},
) {
  const cells = coverage ?? createPlaceCoverage({ repository, releases, clock })
  /* `upstream` is how a deployment turns the third tier on: a loadIndex from
     places/upstream.js, or null for a box that may only answer from its own
     database. Null is the default deliberately — a test server must not be
     able to reach the internet by accident.

     `footers` is the disk cache the ingest script also uses. Without it every
     restart re-downloads and re-parses sixteen 1.6 MB footers the first time
     anybody falls through, which is the difference between a 1.7-second first
     degraded query and a 300-millisecond one. */
  const bucket =
    fallback ??
    createPlaceFallback({ coverage: cells, loadIndex: upstream, readerOptions: footers })

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

  /**
   * Sources for a page of records, in one round trip.
   *
   * Only for the records that need one, and only for ids the database can
   * accept. A degraded record's id is its upstream GERS id rather than one of
   * our uuids — deliberately, see fallback.js — and it already carries the
   * sources read out of the Parquet row. Handing that id to `place_id =
   * any($1::uuid[])` is a 22P02 raised inside the driver, which is a 500 on
   * every single degraded answer: the whole third tier dead, in the one code
   * path no test covered.
   */
  async function withSources(records) {
    const ids = records
      .filter(record => !record.sources && UUID.test(String(record.id ?? '')))
      .map(record => record.id)
    const sources =
      ids.length && repository.placeSources ? await repository.placeSources(ids) : new Map()
    return records.map(record => ({
      ...record,
      sources: record.sources || sources.get(record.id) || [],
    }))
  }

  /**
   * What coverage says about where the query is standing.
   *
   * The answer that matters is about the home cell, not about every cell the
   * radius happens to graze. A point near a corner touches four, and if one of
   * them is a square of ocean that will never be ingested then treating "any
   * missing" as degraded would mean every query from that street is degraded
   * for ever: `no-store` on every response, a Parquet read on every request,
   * and a coverage row rewritten each time. The neighbours are still asked
   * for — that is what `ensure` does — they just do not decide the answer.
   *
   * Never throws. On `/api/places/nearby` this runs after the database has
   * already produced a servable list, and a lock wait on `place_coverage`
   * during an ingest must not turn that list into a 500. A coverage read that
   * failed is reported as "we do not know", which is the truth.
   */
  async function coverageFor({ lng, lat, radius }) {
    const home = cellKey(lng, lat)
    const touched = coverageCells(lng, lat, radius, home)
    try {
      const status = await cells.ensure(touched)
      const row = status.coverage?.get(home)
      const ready = status.ready.includes(home)
      if (!ready) {
        /* The metric that says tier two is not keeping up. */
        event('places coverage miss', {
          'places.coverage.cell': home,
          'places.coverage.status': row?.status ?? 'none',
          'places.coverage.missing': status.missing.length,
        })
      }
      return { home, ready, missing: status.missing, status: row?.status ?? 'pending' }
    } catch (error) {
      event('places coverage unread', {
        'places.coverage.cell': home,
        error: String(error?.message || error).slice(0, 200),
      })
      /* Unknown, not missing: an answer already in hand is served as it is
         rather than being called degraded on the strength of a failed read. */
      return { home, ready: true, missing: [], status: 'unknown', unread: true }
    }
  }

  /**
   * The records the bucket can add for a cell that is not ready. Returns the
   * degraded shape the contract asks for. Never throws, for the same reason.
   */
  async function fallbackFor({ lng, lat, radius, limit, want, coverage: found }) {
    let read = { places: [], reason: 'unavailable' }
    if (bucket.available) {
      try {
        read = await bucket.readBounds(boxAround(lng, lat, radius), {
          limit: want,
          centre: { lng, lat },
          cells: found.missing,
        })
      } catch (error) {
        read = { places: [], reason: String(error?.message || error).slice(0, 120) }
      }
    }
    return {
      coverage: { cell: found.home, status: found.status },
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
        const found = await coverageFor({
          lng: near.lng,
          lat: near.lat,
          radius: SEARCH_FALLBACK_METRES,
        })
        if (!found.ready) {
          degraded = await fallbackFor({
            lng: near.lng,
            lat: near.lat,
            radius: SEARCH_FALLBACK_METRES,
            limit,
            want,
            coverage: found,
          })
        }
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

        /* Coverage first, because the ladder is four database round trips and
           an uningested cell holds nothing to find on any of its rungs. The
           widening exists for a village with four places in it, not for a
           country nobody has loaded, and walking all four rungs out to 25 km
           before discovering there is no coverage was four KNN scans spent
           learning what one indexed row already knew. */
        const found = await coverageFor({ lng, lat, radius: base.radius })

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
          const next = found.ready ? widen(ranked.length, attempt, base) : null
          if (!next) break
          current = next
          attempt += 1
        }

        const degraded = found.ready
          ? null
          : await fallbackFor({ lng, lat, radius: current.radius, limit, want, coverage: found })
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

  /* Every pin on a map's screen.
   *
   * The layer this replaces held the Netherlands and Scotland, seeded by
   * walking Wikipedia's geosearch a region at a time, and everywhere else the
   * map asked Wikipedia live from the phone in ten-kilometre circles at two
   * requests a second. A traveller in Canada got rate-limited instead of pins.
   * This answers anywhere, in one indexed query, from data we hold.
   *
   * Unauthenticated, like the attractions route it replaces and like the
   * airport indoor route beside it: a map's pins are not built from anybody's
   * trip and carry nothing private. Bounded by MAX_PINS and by the envelope
   * itself, so being public costs one index scan.
   */
  /* A tile of places, which is what a map should have been asking for all
   * along.
   *
   * `/in-view` below answers "what is in this box", and a map asks it again
   * on every camera move: a different box, a different best three hundred,
   * and dots at the edges appearing and vanishing for no reason anybody
   * looking at the screen could name. It was reported as janky and it was
   * exactly that — the instability was in the question, not in the data.
   *
   * z/x/y names one fixed square of the world at one zoom. Its contents are
   * decided once and are the same for everybody, so panning back over ground
   * you have already seen gets what you already have rather than a fresh
   * opinion, and the map library keeps and drops tiles itself. No debounce,
   * no refetch on a pan, nothing to re-rank.
   *
   * It is also the only shape in which the zoom is known at query time, which
   * is what lets the database drop the places that would not be drawn instead
   * of sending them to be hidden.
   *
   * Unauthenticated, like the viewport query it replaces: a map's pins are
   * built from nobody's trip and carry nothing private. */
  app.get('/api/places/tiles/:z/:x/:y', async (request, reply) => {
    if (!servable || !repository.placeTile) return unavailable(reply)
    const asked = tileQuery.safeParse(request.params || {})
    if (!asked.success) return reply.code(400).send({ error: message(asked.error) })
    const { z, x, y } = asked.data
    /* Outside the square grid of this zoom there is no tile to be wrong
       about — 2^z by 2^z — and a request for one is a bug in a client rather
       than an empty part of the world. */
    const side = 2 ** z
    if (x >= side || y >= side) return reply.code(404).send({ error: 'No such tile' })

    return span('places tile', { 'places.tile.z': z }, async () => {
      const started = Date.now()
      /* Built once, then looked up.
       *
       * Reported as slow when panning across a lot of ground, and it was:
       * every square was a bounding-box scan, a CASE per row, a sort and a
       * protobuf encode — tens of thousands of rows touched to produce at
       * most forty-eight places — and a fast pan asks for dozens of squares
       * at once, all queueing on the one database this box has.
       *
       * So the first request for a square builds it and keeps the bytes, and
       * every request after, from anybody, is a primary key lookup. The
       * places worker builds them ahead of being asked as it ingests, so in
       * the normal case nobody pays even the first one. Dropped when the
       * ground under them is re-ingested — see clearPlaceTiles, which is the
       * only thing standing between "built once" and "wrong for ever". */
      let body = repository.readPlaceTile ? await repository.readPlaceTile({ z, x, y }) : null
      const kept = body !== null
      /* Whether this square is worth keeping, which is a question about the
         ground and not about the bytes.
         *
         * Reported from the road: pins at one zoom, nothing a zoom in, and it
         * never healed. This is why. A square over ground nobody had ingested
         * yet built empty — correctly, there was nothing there — and then that
         * emptiness was cached: here, and for an hour in the browser, and for
         * a day after that as stale-while-revalidate. Half an hour later the
         * ground was full of places and the map was still showing the hole.
         * A tile is only the truth for as long as its ground is finished, so
         * an unfinished square is answered and then forgotten. */
      const ground = kept ? null : await repository.placeTileGround?.({ z, x, y })
      const settled = !ground || (ground.covered >= ground.cells && ground.unready === 0)
      if (!kept) {
        /* Before the read, not after: a cell ingested while this was being
           built makes these bytes a description of a past, and writePlaceTile
           compares the two and declines. */
        const from = new Date()
        body = await repository.placeTile(
          { z, x, y },
          /* How many a tile may carry is the store's to decide — it is a fact
             about the shape of a tile, not about this route. */
          { floor: CONFIDENCE_FLOOR, weights: VIEW_WEIGHT },
        )
        /* Kept without waiting on it and without letting it fail the answer:
           the tile in hand is already correct, and a cache that cannot be
           written is a slow map rather than a broken one. */
        if (settled) {
          repository
            .writePlaceTile?.({ z, x, y }, body, 0, from)
            .catch(error => event('places tile unkept', { error: String(error?.message || error) }))
        }
      }
      stamp({
        'places.query.kind': 'tile',
        'places.query.ms': Date.now() - started,
        'places.tile.bytes': body.length,
        'places.tile.built': !kept,
      })
      /* A tile is the same bytes for everybody for as long as the data behind
         it holds, which is a release — so it is cached hard and at the edge.
         This is the other half of why a tiled map does not flicker: the
         second look at a square costs nothing at all.
         *
         * Unless the ground under it is still being ingested, in which case
         * these bytes are true for minutes and an hour of browser cache is
         * how a filled-in city keeps looking empty. Answered, not kept. */
      reply.header('cache-control', settled ? TILE_CACHE : TILE_UNSETTLED)
      reply.header('content-type', 'application/vnd.mapbox-vector-tile')
      /* An empty tile is a real answer — that square has nothing in it — and
         204 is how a vector source is told so without it treating the square
         as broken and asking again. */
      if (!body.length) return reply.code(204).send()
      return reply.send(body)
    })
  })

  app.get('/api/places/in-view', async (request, reply) => {
    if (!servable) return unavailable(reply)
    const parsed = viewQuery.safeParse(request.query || {})
    if (!parsed.success) return reply.code(400).send({ error: message(parsed.error) })
    const { west, south, east, north, limit, headline } = parsed.data

    return span('places in view', { 'places.view.limit': limit }, async () => {
      const started = Date.now()
      /* The zoom the viewport is looking at, from its own width. What comes
         back is what has earned that zoom — not the best N of everything in
         the box, which is what a cap gives and is why panning used to change
         which places were on screen. */
      const zoom = zoomForBounds({ west, south, east, north }, LABEL_ZOOMS)
      const rows = await repository.placesInView(
        { west, south, east, north },
        {
          limit,
          zoom,
          floor: CONFIDENCE_FLOOR,
          floorWeight: headline ? HEADLINE_WEIGHT : 0,
          weights: VIEW_WEIGHT,
        },
      )
      stamp({ 'places.view.zoom': zoom, 'places.view.found': rows.length })
      if (rows.capped) {
        /* Never for a real viewport. Said loudly rather than silently cut. */
        event('places view hit the planet backstop', {
          'places.view.zoom': zoom,
          'places.view.span': Math.abs(east - west),
        })
      }
      /* Coverage is asked about the middle of the view, because that is where
         somebody is looking. A box the size of a continent touches more cells
         than any one answer should queue — coverageCells caps that — and the
         cells around the middle are the ones a pan will want next. */
      const found = await coverageFor({
        lng: (west + east) / 2,
        lat: (south + north) / 2,
        radius: DEFAULT_RADIUS_METRES,
      })
      /* One attribution for the layer rather than one per pin — see
         licensesFor in store.js. A pin needs a name, a kind and a position;
         provenance for one place is what /api/places/:id is for. */
      const licenses = repository.placeLicenses
        ? await repository.placeLicenses(rows.map(place => place.id))
        : []
      const page = rows
      stamp({
        'places.query.kind': 'view',
        'places.query.ms': Date.now() - started,
        'places.result.count': page.length,
        'places.degraded': !found.ready,
      })
      /* Pins do not fall back to the bucket. A degraded viewport would be a
         Parquet read per pan, which is the one thing the cap exists to
         prevent; the cell is queued and the map fills in as it lands. Said
         rather than hidden, so the client can show that it is still filling. */
      reply.header('cache-control', found.ready ? NEARBY_CACHE : DEGRADED_CACHE)
      return {
        places: page.map(pin),
        attribution: attributionFor(licenses.map(license => ({ license }))),
        degraded: !found.ready,
        ...(found.ready ? {} : { coverage: { cell: found.home, status: found.status } }),
      }
    })
  })

  app.get('/api/places/:id', async (request, reply) => {
    const user = await authenticated(request, reply)
    if (!user) return
    if (!servable) return unavailable(reply)
    /* Our uuid or an upstream GERS id — see store.js on why both. Bounded and
       restricted to the characters an id can contain, because an unbounded
       string in a route parameter is a free index scan for anybody. */
    const id = PLACE_ID.safeParse(request.params?.id)
    if (!id.success)
      return reply.code(400).send({ error: 'A place id is a uuid or an upstream id' })

    return span('read place', {}, async () => {
      const found = await repository.placeById(id.data)
      if (!found) return reply.code(404).send({ error: 'No such place' })
      if (found.gone) {
        stamp({ 'places.record.gone': true })
        /* 410, not 404: the id was real and we know what became of it. A stop
           pointing here can say "this has closed" instead of losing its pin
           to a generic not-found. */
        reply.header('cache-control', PLACE_CACHE)
        return reply.code(410).send({ place: null, gone: true, reason: found.reason, at: found.at })
      }
      stamp({
        'places.record.category': found.category,
        'places.record.sources': found.sources.length,
        'places.record.redirected': Boolean(found.redirectedFrom),
      })
      const { redirectedFrom = null, ...record } = found

      /* What we know about it, and — if nobody has ever asked — the asking.
       *
       * Opening a card is the request. A place the prominent backfill has
       * not reached is queued here at the priority that jumps the backfill,
       * because there is one person waiting on this and a batch behind it,
       * so the card fills while they are still looking at it and the next
       * open is instant.
       *
       * Nothing is fetched inline. A route that waited on Wikidata would tie
       * how fast a card opens to how busy somebody else's server is. */
      const known = await readEnrichment(repository.pool, record.id).catch(() => null)
      if (known && !known.status) {
        await enqueue(repository.pool, [record.id], WANTED_NOW).catch(() => {})
      }
      const waiting = !known?.status || known.status === 'pending' || known.status === 'working'
      stamp({
        'places.record.enrichment': known?.status ?? 'none',
        'places.record.images': known?.images.length ?? 0,
      })

      /* A card still being filled must not be kept, or what somebody gets
         for the next day is the answer from before we looked. */
      reply.header('cache-control', waiting ? PLACE_UNSETTLED : PLACE_CACHE)
      return {
        place: present(record),
        redirectedFrom,
        about: { ...shownAs(known ?? {}), status: known?.status ?? 'pending', waiting },
      }
    })
  })
}
