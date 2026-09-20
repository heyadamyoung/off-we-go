#!/usr/bin/env node
/**
 * The OpenStreetMap objects worth matching places against, into our database.
 *
 * The enrichment chain needs one fuzzy match — place to OSM object — and
 * everything after it is a link a human declared. This fills the table that
 * match is made against.
 *
 * Why a table rather than Overpass. Overpass is a volunteer service with rate
 * limits, and the standing rule for this layer is that nothing metered or
 * third-party sits between a traveller and their map. Backfilling millions of
 * prominent places through somebody else's API would break both. Loaded here
 * once, a match is a GiST index lookup.
 *
 * Why it is small. An object earns a row only if it carries something the
 * pipeline can use — wikidata, wikipedia, wikimedia_commons, image or
 * description. That is a couple of million objects worldwide rather than the
 * hundreds of millions in a full planet, and it is exactly the set that can
 * produce a picture.
 *
 * The input is a Geofabrik-style extract in the o5m/pbf-derived CSV that
 * `osmium export` produces, or the GeoJSON sequence it writes with
 * --output-format=geojsonseq. One object per line, which is what lets this
 * stream a planet without holding it in memory:
 *
 *   osmium tags-filter planet.osm.pbf \
 *     nwr/wikidata nwr/wikipedia nwr/wikimedia_commons nwr/image nwr/description \
 *     -o interesting.osm.pbf
 *   osmium export interesting.osm.pbf --output-format=geojsonseq -o interesting.geojsonseq
 *   node server/scripts/osm-landmarks.mjs interesting.geojsonseq
 *
 * Reads stdin when given no file, so the two can be piped together.
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import pg from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const say = line => process.stderr.write(`${line}\n`)

/** The byte RFC 8142 puts before each record in a GeoJSON sequence. */
const RECORD_SEPARATOR = 0x1e

/** The tags that make an object worth keeping, and what we call them. */
export function landmarkOf(feature) {
  const tags = feature?.properties ?? {}
  const kept = {
    wikidata: /^Q\d+$/.test(String(tags.wikidata ?? '')) ? String(tags.wikidata) : null,
    wikipedia: /^[a-z-]{2,12}:.+/i.test(String(tags.wikipedia ?? ''))
      ? String(tags.wikipedia)
      : null,
    commons: typeof tags.wikimedia_commons === 'string' ? tags.wikimedia_commons : null,
    description: typeof tags.description === 'string' ? tags.description : null,
  }
  const image = typeof tags.image === 'string' ? tags.image : null
  /* Nothing usable, no row. `image` alone counts — an OSM image tag is a URL
     somebody put there on purpose — but it is not stored here; commons.js is
     the only thing allowed to decide a picture, and it needs a Commons file. */
  if (!kept.wikidata && !kept.wikipedia && !kept.commons && !kept.description && !image) {
    return null
  }

  /* A point is all the matcher needs. `osmium export` gives ways and
     relations their geometry; the centroid of a bounding box is close enough
     for a 200-metre gate and costs nothing to compute. */
  const point = centreOf(feature.geometry)
  if (!point) return null

  const id = feature.id ?? `${tags['@type'] ?? 'node'}/${tags['@id'] ?? ''}`
  if (!/^(node|way|relation)\/\d+$/.test(String(id))) return null

  return {
    id: String(id),
    name: typeof tags.name === 'string' ? tags.name : null,
    lng: point[0],
    lat: point[1],
    category: tags.tourism ?? tags.historic ?? tags.amenity ?? tags.leisure ?? tags.natural ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    ...kept,
  }
}

/** The middle of whatever geometry this is. */
export function centreOf(geometry) {
  if (!geometry) return null
  if (geometry.type === 'Point') return geometry.coordinates
  const seen = []
  const walk = value => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      seen.push(value)
      return
    }
    for (const part of value) walk(part)
  }
  walk(geometry.coordinates)
  if (!seen.length) return null
  let west = seen[0][0]
  let east = seen[0][0]
  let south = seen[0][1]
  let north = seen[0][1]
  for (const [lng, lat] of seen) {
    if (lng < west) west = lng
    if (lng > east) east = lng
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return [(west + east) / 2, (south + north) / 2]
}

const field = value =>
  value === null || value === undefined
    ? '\\N'
    : String(value)
        .replaceAll('\\', '\\\\')
        .replaceAll('\t', ' ')
        .replaceAll('\n', ' ')
        .replaceAll('\r', '')

async function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set; nothing to load into.')
    process.exit(2)
  }
  const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
  const client = await pool.connect()
  const input = file ? createReadStream(file) : process.stdin
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })

  /* Into a staging table and then swapped in, so the live table is never
     half a planet. COPY rather than inserts: millions of rows. */
  await client.query('create temp table osm_incoming (like osm_landmarks including defaults)')

  let read = 0
  let kept = 0
  const rows = new Readable({ read() {} })
  const copying = pipeline(
    rows,
    client.query(
      copyFrom(
        'copy osm_incoming (id, name, geom, category, website, wikidata, wikipedia, commons, description) from stdin',
      ),
    ),
  )

  for await (const line of lines) {
    if (!line.trim()) continue
    read += 1
    let feature
    try {
      /* geojsonseq puts a record separator before each record. Sliced
         rather than matched, because a control character in a regular
         expression is a thing linters rightly object to. */
      feature = JSON.parse(line.charCodeAt(0) === RECORD_SEPARATOR ? line.slice(1) : line)
    } catch {
      continue
    }
    const landmark = landmarkOf(feature)
    if (!landmark) continue
    kept += 1
    rows.push(
      `${[
        field(landmark.id),
        field(landmark.name),
        `SRID=4326;POINT(${landmark.lng} ${landmark.lat})`,
        field(landmark.category),
        field(landmark.website),
        field(landmark.wikidata),
        field(landmark.wikipedia),
        field(landmark.commons),
        field(landmark.description),
      ].join('\t')}\n`,
    )
    if (kept % 100_000 === 0)
      say(`  ${kept.toLocaleString()} kept of ${read.toLocaleString()} read`)
  }
  rows.push(null)
  await copying

  /* Merged rather than replaced: a regional extract loaded after a planet
     must update its own objects and not delete everything else. */
  const { rowCount } = await client.query(
    `insert into osm_landmarks (id, name, geom, category, website, wikidata, wikipedia, commons, description, loaded_at)
     select id, name, geom, category, website, wikidata, wikipedia, commons, description, now()
       from osm_incoming
     on conflict (id) do update set
       name = excluded.name, geom = excluded.geom, category = excluded.category,
       website = excluded.website, wikidata = excluded.wikidata,
       wikipedia = excluded.wikipedia, commons = excluded.commons,
       description = excluded.description, loaded_at = now()`,
  )
  const total = await client.query('select count(*)::int as n from osm_landmarks')
  say(
    `${rowCount.toLocaleString()} landmark(s) loaded; ${total.rows[0].n.toLocaleString()} in the table`,
  )
  client.release()
  await pool.end()
}

/* Importable for the tests without running. */
if (process.argv[1]?.endsWith('osm-landmarks.mjs')) {
  await main()
}
