/* An Overture place, in our shape.
 *
 * Overture's row is a merge of other people's rows and says so: every field
 * carries which dataset it came from, and the `sources` list is the licence
 * trail. We keep that trail rather than flattening it, because "ODbL applies
 * to this record" is a per-record fact — a place Overture took from OpenStreetMap
 * obliges us to attribute, and one it took from a public business register
 * does not, and nothing downstream can work that out later if this throws it
 * away here.
 *
 * What is deliberately dropped: ratings, review counts, photographs and
 * anything resembling them. Overture does not publish them and we would not
 * be licensed to store them if it did.
 */

import { cellKey } from './cells.js'
import { categoryFor } from './taxonomy.js'

/** Every column the ingest and the fallback need, and nothing else. The list
    is here rather than at the call sites because reading a column costs real
    bytes: `sources` alone is a fifth of a row group. */
export const COLUMNS = Object.freeze([
  'id',
  'names',
  'categories',
  'basic_category',
  'confidence',
  'websites',
  'phones',
  'addresses',
  'sources',
  'operating_status',
  'bbox',
])

/* Overture's own licence statement for the places theme. Records it took from
   OpenStreetMap carry ODbL and oblige us to say so; the rest are CDLA
   Permissive. Which applies is decided per record from `sources`. */
export const OVERTURE_LICENSE = 'CDLA-Permissive-2.0'
export const OSM_LICENSE = 'ODbL-1.0'
/** Which of Overture's datasets are OpenStreetMap, and therefore ODbL.
    Exported because the ingest decides a licence per upstream record now,
    rather than joining every licence a place carries onto one row. */
export const OSM_DATASETS = /openstreetmap|osm/i

const text = value => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' ? null : trimmed
}

const first = list => (Array.isArray(list) && list.length ? list[0] : null)

/** Every name the record knows, minus the one we are calling it. */
function alternateNames(names, primary) {
  const out = new Set()
  const common = names?.common
  /* `common` arrives as a map of language → name; hyparquet gives it back as
     an object or as a list of {key, value} depending on the writer. */
  if (common && typeof common === 'object') {
    for (const value of Array.isArray(common)
      ? common.map(entry => entry?.value)
      : Object.values(common)) {
      const name = text(value)
      if (name) out.add(name)
    }
  }
  for (const rule of names?.rules || []) {
    const name = text(rule?.value)
    if (name) out.add(name)
  }
  out.delete(primary)
  return [...out].sort()
}

/** The licences that apply to this record, from the datasets behind it. */
export function licensesFor(sources) {
  const out = new Set([OVERTURE_LICENSE])
  for (const source of sources || []) {
    if (OSM_DATASETS.test(String(source?.dataset ?? ''))) out.add(OSM_LICENSE)
  }
  return [...out].sort()
}

/** The upstream record ids, so a refresh can tell a changed place from a new
    one even when Overture reissues its own id. */
export function upstreamIds(sources) {
  const out = []
  for (const source of sources || []) {
    const dataset = text(source?.dataset)
    const record = text(source?.record_id)
    if (dataset && record) out.push(`${dataset}:${record}`)
  }
  return [...new Set(out)].sort()
}

function addressOf(addresses) {
  const address = first(addresses)
  if (!address) return null
  const shaped = {
    freeform: text(address.freeform),
    locality: text(address.locality),
    region: text(address.region),
    postcode: text(address.postcode),
    country: text(address.country),
  }
  return Object.values(shaped).some(value => value !== null) ? shaped : null
}

/**
 * One Overture row as a place, or null when it is not one we can use.
 *
 * Rejected: anything without a name (a nameless point is not somewhere a
 * traveller can be told about) and anything without a position.
 *
 * @param {object} row  a row as read by places/parquet.js
 * @param {{version: string}} release
 */
export function placeFromOverture(row, release) {
  const name = text(row?.names?.primary)
  const lng = row?.bbox?.xmin
  const lat = row?.bbox?.ymin
  if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) return null

  const leaf = text(row?.categories?.primary)
  const basic = text(row?.basic_category)
  const sources = Array.isArray(row?.sources) ? row.sources : []

  return {
    source: 'overture',
    upstreamId: text(row?.id),
    gersId: text(row?.id),
    name,
    alternateNames: alternateNames(row?.names, name),
    lng,
    lat,
    cell: cellKey(lng, lat),
    category: categoryFor({ basic, leaf }),
    categoryRaw: leaf || basic || null,
    address: addressOf(row?.addresses),
    website: text(first(row?.websites)),
    phone: text(first(row?.phones)),
    /* Overture's places theme carries no opening hours. Null, not invented:
       an unfillable field stays unfilled. */
    hours: null,
    operating: text(row?.operating_status),
    /* Already 0..1 and already a merge of its sources' agreement, which is
       exactly what our confidence means. Clamped because a schema change that
       let it drift outside the range would otherwise fail a check constraint
       halfway through a planet load. */
    confidence: Math.min(1, Math.max(0, Number(row?.confidence ?? 0))),
    licenses: licensesFor(sources),
    upstreamIds: upstreamIds(sources),
    version: release?.version ?? 'unknown',
  }
}

/** A whole page of rows, with the unusable ones counted rather than silently
    dropped: a release that suddenly stops naming places should be loud. */
export function placesFromOverture(rows, release) {
  const places = []
  let skipped = 0
  for (const row of rows || []) {
    const place = placeFromOverture(row, release)
    if (place) places.push(place)
    else skipped += 1
  }
  return { places, skipped }
}
