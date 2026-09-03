/* Hand-laid walking segments, dressed as what the client already understands.

   The airport indoor payload is raw Overpass JSON, and the client turns any
   way tagged highway=corridor with a level into a routable path — so a
   walkway row becomes exactly that shape and nothing downstream needs to
   know it was born here. Negative ids keep clear of every real OSM id. */

export const walkwayElement = (row, index = 0) => ({
  type: 'way',
  id: -(index + 1),
  tags: {
    highway: 'corridor',
    level: row.level || '0',
    ...(row.name ? { name: row.name } : {}),
  },
  geometry: (row.points || []).map(([lng, lat]) => ({ lon: lng, lat })),
})

export function mergeWalkways(body, rows) {
  if (!rows?.length) return body
  return {
    ...(body || {}),
    elements: [...(body?.elements || []), ...rows.map((row, i) => walkwayElement(row, i))],
  }
}
