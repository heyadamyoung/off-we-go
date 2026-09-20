/**
 * The OpenStreetMap objects a place might be.
 *
 * Two sources behind one shape, because the two tiers have opposite needs.
 *
 * The backfill walks millions of prominent places and must not go anywhere
 * near a volunteer API to do it, so it reads `osm_landmarks` — the objects
 * carrying a wikidata, wikipedia, commons, image or description tag, loaded
 * once from a planet extract. A couple of million rows, a GiST index, and a
 * match is a spatial query rather than a network round trip. It is also the
 * only version that honours the rule that nothing metered or third-party
 * sits in the path between a traveller and their map.
 *
 * On-demand is the other case: somebody has opened a card for a place the
 * extract predates, and there is one person waiting on one answer. That is
 * what Overpass is for, and one request for one place is a reasonable thing
 * to ask of it.
 *
 * `fromTable` is tried first and Overpass only answers when it found nothing,
 * so a well-loaded extract means the volunteer service is almost never asked.
 */

/** How far around a place to look. Wider than resolve.js's 200m gate on
    purpose: the gate decides, this only has to not miss the candidate. */
export const LOOK_METRES = 300

/** More than this and the matcher is choosing between duplicates anyway. */
export const MOST_CANDIDATES = 40

const rowToCandidate = row => ({
  id: row.id,
  name: row.name,
  lat: Number(row.lat),
  lng: Number(row.lng),
  category: row.category,
  website: row.website,
  tags: {
    website: row.website ?? undefined,
    wikidata: row.wikidata ?? undefined,
    wikipedia: row.wikipedia ?? undefined,
    wikimedia_commons: row.commons ?? undefined,
    description: row.description ?? undefined,
  },
})

/** Candidates from our own copy of the interesting OSM objects. */
export function fromTable(db, { metres = LOOK_METRES } = {}) {
  return async function osmNear(place) {
    const { rows } = await db.query(
      `select id, name, category, website, wikidata, wikipedia, commons, description,
              ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lng
         from osm_landmarks
        where ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
        order by geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        limit ${MOST_CANDIDATES}`,
      [place.lng, place.lat, metres],
    )
    return rows.map(rowToCandidate)
  }
}

/* Overpass QL asking for anything nearby carrying something we can use.
   `nwr` is node, way and relation at once; `out center` gives a single point
   for a way or relation rather than its whole geometry, which is all the
   matcher needs and a fraction of the bytes. */
const AROUND = (lat, lng, metres) => `
[out:json][timeout:25];
(
  nwr(around:${metres},${lat},${lng})["wikidata"];
  nwr(around:${metres},${lat},${lng})["wikipedia"];
  nwr(around:${metres},${lat},${lng})["wikimedia_commons"];
  nwr(around:${metres},${lat},${lng})["image"];
);
out center tags ${MOST_CANDIDATES};`

/** An Overpass element as a candidate, or null if it has no position. */
export function readElement(element) {
  const lat = element?.lat ?? element?.center?.lat
  const lon = element?.lon ?? element?.center?.lon
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const tags = element.tags ?? {}
  return {
    id: `${element.type}/${element.id}`,
    name: tags.name ?? tags['name:en'] ?? null,
    lat: Number(lat),
    lng: Number(lon),
    /* Overpass gives OSM's own vocabulary; resolve.js compares our
       categories, and `categoryAgreement` treats an unknown as neutral
       rather than contradictory, so passing it through is honest. */
    category: tags.tourism ?? tags.historic ?? tags.amenity ?? tags.leisure ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    tags,
  }
}

/** Candidates from Overpass. One place, with somebody waiting. */
export function fromOverpass({
  endpoint = 'https://overpass-api.de/api/interpreter',
  userAgent,
  fetch: fetchImpl = globalThis.fetch,
  metres = LOOK_METRES,
} = {}) {
  if (!userAgent) throw new Error('places: Overpass needs a user agent that names us')
  return async function osmNear(place, { signal } = {}) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      signal,
      headers: { 'user-agent': userAgent, 'content-type': 'text/plain' },
      body: AROUND(place.lat, place.lng, metres),
    })
    if (!response.ok) throw new Error(`places: Overpass answered ${response.status}`)
    const body = await response.json()
    return (body?.elements ?? []).map(readElement).filter(Boolean)
  }
}

/** Our own copy first; the volunteer service only when it had nothing. */
export function fromTableThenOverpass(table, overpass) {
  return async function osmNear(place, options) {
    const near = await table(place, options)
    if (near.length || !overpass) return near
    return await overpass(place, options)
  }
}
