/* A Foursquare OS Places row, in our shape.
 *
 * Foursquare's open dataset is the second opinion: it knows shops and cafés
 * Overture does not, it carries a telephone number more often, and where the
 * two describe the same shopfront (resolve.js decides that, not this file)
 * the merge gets a fuller record than either had. It is Apache-2.0, which is
 * the whole of its licence story — unlike Overture, whose licence is decided
 * per record from the datasets behind it.
 *
 * The one thing it does not publish is a confidence score, and that is the
 * interesting decision in this module. Overture's rows carry a number that
 * means "how much our sources agreed", and our `places.confidence` column,
 * the ranking in rank.js and the floor a search applies are all defined in
 * those terms. Dropping Foursquare rows in at a flat 1.0 would put every one
 * of them above every Overture row in every merge and every ranking; dropping
 * them in at 0 would bury them. Both are inventions dressed as measurements.
 *
 * So the score is derived, and derived visibly:
 *
 *     confidence = 0.20 + 0.40 × completeness + 0.25 × recency
 *
 *   completeness  how many of the six things a traveller wants are filled in:
 *                 a street line, a locality, a postcode, a telephone, a
 *                 website, a category. Each worth a sixth.
 *   recency       1 when the record was refreshed within FRESH_DAYS (180),
 *                 falling linearly to 0 at STALE_DAYS (1095, three years),
 *                 and 0 when the release does not date the record at all.
 *
 * Which gives 0.20 for a bare, ancient record and 0.85 for a complete one
 * refreshed this quarter. The ceiling is 0.85 and not 1 on purpose: a derived
 * number must not be able to claim the certainty of a measured one, and the
 * gap is the visible marker that it is derived. A typical record — half the
 * fields, refreshed this year — scores 0.65, next to Overture's measured mean
 * of 0.665, so neither source systematically wins a merge on confidence
 * alone. A record Foursquare has dated as closed is CLOSED_CONFIDENCE (0.1)
 * whatever else it has, because "this place is not there any more" is the
 * only thing about it still worth knowing.
 *
 * ---- The schema ---------------------------------------------------------
 *
 * Read from the dataset's own documentation and NOTICE, not guessed, but NOT
 * read from a footer in this environment, and the honest note is that the
 * attempt failed: on 2026-09-20 an anonymous ListObjectsV2 against
 * s3://fsq-os-places-us-east-1 returned exactly two keys — LICENSE.txt and
 * NOTICE.txt — with no CommonPrefixes under `release/`, `release/dt=`, or the
 * bucket root, and a GET of the documented part path answered 404. The
 * mirrors that would settle it (huggingface.co, source.coop) are outside this
 * machine's egress policy. The columns below are therefore the published
 * schema of the `places` flat file, and the reader treats every one of them
 * as optional; the command that settles it the moment the bucket answers is:
 *
 *   node -e "import('./server/src/places/release.js').then(async r => {
 *     const rel = await r.discoverRelease({ source: 'fsq' })
 *     const p = await import('./server/src/places/parquet.js')
 *     const { parquetMetadataAsync } = await import('hyparquet')
 *     const part = rel.parts[0]
 *     const footer = await p.fetchFooter(part.url, part.size)
 *     const meta = await parquetMetadataAsync(p.remoteFile({ ...part, footer }))
 *     for (const e of meta.schema) console.log(e.name, e.type ?? '')
 *   })"
 *
 * Columns of `release/dt=<date>/places/parquet/*.parquet`:
 *
 *   fsq_place_id          string, the stable upstream id
 *   name                  string
 *   latitude, longitude   double
 *   address               string, the street line
 *   locality              string      region       string
 *   postcode              string      country      string, ISO-3166-1 alpha-2
 *   admin_region, post_town, po_box   string, regional address extras
 *   date_created          string date, first published
 *   date_refreshed        string date, last confirmed
 *   date_closed           string date or null
 *   tel                   string      website      string      email  string
 *   facebook_id           long        instagram    string      twitter string
 *   fsq_category_ids      list<string>
 *   fsq_category_labels   list<string>, "Dining and Drinking > Cafe, Coffee…"
 *   placemaker_url        string
 *   geom                  binary, WKB point        bbox  struct<xmin,ymin,xmax,ymax>
 *
 * `geom` and `bbox` are not read: latitude and longitude say the same thing
 * in eight bytes each and without a WKB parse. Everything the traveller-facing
 * record cannot fill from this list — opening hours, alternate names — stays
 * null, which is the house rule and not an omission.
 */

import { cellKey } from './cells.js'
import { categoryFor } from './taxonomy.js'

/** The minimum set. Reading a column costs bytes off a public bucket, and
    every one of these lands in a column of `places` or in the score above. */
export const COLUMNS = Object.freeze([
  'fsq_place_id',
  'name',
  'latitude',
  'longitude',
  'address',
  'locality',
  'region',
  'postcode',
  'country',
  'tel',
  'website',
  'fsq_category_labels',
  'date_created',
  'date_refreshed',
  'date_closed',
])

/** The whole licence story for this source. */
export const FSQ_LICENSE = 'Apache-2.0'

/** The parts of the derived score, exported so a test can state them and a
    reader can check the arithmetic in the comment above against the code. */
export const CONFIDENCE_BASE = 0.2
export const COMPLETENESS_WEIGHT = 0.4
export const RECENCY_WEIGHT = 0.25
export const FRESH_DAYS = 180
export const STALE_DAYS = 1095
export const CLOSED_CONFIDENCE = 0.1
const DAY_MS = 86_400_000

const text = value => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' ? null : trimmed
}

/** hyparquet hands a LIST back as an array, but a writer that emits the
    three-level encoding gives {list:[{element}]}; both are read here so a
    Foursquare release built by a different engine does not silently lose
    every category. */
function listOf(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.list)) return value.list.map(entry => entry?.element ?? entry)
  return []
}

const number = value => {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** A published date as a moment, or null. Dates arrive as "2025-06-10"; a
    release that switches to a Parquet DATE column hands back a Date, and both
    are accepted rather than one being assumed. */
function dateOf(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  const parsed = Date.parse(String(value ?? ''))
  return Number.isNaN(parsed) ? null : parsed
}

/** "Dining and Drinking > Cafe, Coffee, and Tea House" → the words taxonomy.js
    reads: the top of the path as the coarse value, the bottom as the leaf. */
function categoryParts(labels) {
  const path = text(listOf(labels)[0])
  if (!path) return { basic: null, leaf: null, raw: null }
  const segments = path
    .split('>')
    .map(segment => segment.trim())
    .filter(Boolean)
  const slug = segment =>
    segment
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
  return {
    basic: segments.length ? slug(segments[0]) : null,
    leaf: segments.length ? slug(segments[segments.length - 1]) : null,
    raw: segments.length ? segments[segments.length - 1] : path,
  }
}

/**
 * The derived confidence, and the two numbers it came from.
 *
 * Returned as parts, not just a score, so the CLI and a future audit can show
 * why a record scored what it did without re-deriving it.
 *
 * @param {object} row
 * @param {{now?: number}} [options]
 */
export function fsqConfidence(row, { now = Date.now() } = {}) {
  const closed = dateOf(row?.date_closed)
  const filled = [
    text(row?.address),
    text(row?.locality),
    text(row?.postcode),
    text(row?.tel),
    text(row?.website),
    categoryParts(row?.fsq_category_labels).leaf,
  ].filter(Boolean).length
  const completeness = filled / 6
  const refreshed = dateOf(row?.date_refreshed) ?? dateOf(row?.date_created)
  let recency = 0
  if (refreshed !== null) {
    const days = Math.max(0, (now - refreshed) / DAY_MS)
    recency =
      days <= FRESH_DAYS ? 1 : Math.max(0, 1 - (days - FRESH_DAYS) / (STALE_DAYS - FRESH_DAYS))
  }
  const score = closed
    ? CLOSED_CONFIDENCE
    : CONFIDENCE_BASE + COMPLETENESS_WEIGHT * completeness + RECENCY_WEIGHT * recency
  /* Three decimals: the inputs are a sixth and a day, and more digits would
     suggest a precision the formula does not have. */
  return {
    confidence: Math.min(1, Math.max(0, Math.round(score * 1000) / 1000)),
    completeness,
    recency,
    closed: Boolean(closed),
  }
}

function addressOf(row) {
  const shaped = {
    freeform: text(row?.address),
    locality: text(row?.locality),
    region: text(row?.region) || text(row?.admin_region),
    postcode: text(row?.postcode),
    country: text(row?.country),
  }
  return Object.values(shaped).some(value => value !== null) ? shaped : null
}

/**
 * One Foursquare row as a place, or null when it is not one we can use.
 *
 * Rejected on the same terms as Overture's: no name, no position. A record
 * Foursquare has dated as closed is kept rather than dropped — a traveller
 * looking at a guidebook from last year is better served by "this closed" than
 * by silence — but it carries CLOSED_CONFIDENCE and `operating: 'closed'`, and
 * the ranking does the rest.
 *
 * @param {object} row  a row as read by places/parquet.js
 * @param {{version: string}} release
 * @param {{now?: number}} [options]
 */
export function placeFromFsq(row, release, { now = Date.now() } = {}) {
  const name = text(row?.name)
  const lng = number(row?.longitude)
  const lat = number(row?.latitude)
  if (!name || lng === null || lat === null) return null

  const { basic, leaf, raw } = categoryParts(row?.fsq_category_labels)
  const { confidence, closed } = fsqConfidence(row, { now })
  const upstreamId = text(row?.fsq_place_id)
  if (!upstreamId) return null

  return {
    source: 'fsq',
    upstreamId,
    /* Foursquare does not carry Overture's GERS id, so a place only it knows
       has none. That is not a gap to fill with the Foursquare id: gers_id is
       unique in the schema and a made-up one would collide with a real one
       the first time Overture caught up. */
    gersId: null,
    name,
    /* The flat file publishes one name per record. Nothing to gather. */
    alternateNames: [],
    lng,
    lat,
    cell: cellKey(lng, lat),
    category: categoryFor({ basic, leaf }),
    categoryRaw: raw,
    address: addressOf(row),
    website: text(row?.website),
    phone: text(row?.tel),
    /* No opening hours in the open release. Null, not invented. */
    hours: null,
    operating: closed ? 'closed' : null,
    confidence,
    licenses: [FSQ_LICENSE],
    upstreamIds: [`fsq:${upstreamId}`],
    version: release?.version ?? 'unknown',
  }
}

/** A whole page of rows, with the unusable ones counted rather than silently
    dropped: a release that suddenly stops naming places should be loud. */
export function placesFromFsq(rows, release, { now = Date.now() } = {}) {
  const places = []
  let skipped = 0
  for (const row of rows || []) {
    const place = placeFromFsq(row, release, { now })
    if (place) places.push(place)
    else skipped += 1
  }
  return { places, skipped }
}
