/* The routing engine's coverage, derived instead of configured.

   Nobody should name an OSM extract in an env var: the trips already say
   where the world matters. Every stop coordinate is matched against
   Geofabrik's public region index (GeoJSON polygons, no account, no key),
   the deepest containing region wins — Saskatchewan, not Canada — and the
   wanted extract list lands in a file on the tiles volume, where the
   engine's supervisor picks it up, downloads, and rebuilds. Plan a trip to
   Portugal and Portugal's roads follow on their own.

   Everything here leaves a queryable trail: which regions each refresh
   chose, what changed, and why a point matched nothing. */

const DEFAULT_INDEX_URL = 'https://download.geofabrik.de/index-v1.json'
const INDEX_TTL_MS = 24 * 60 * 60_000

/** Ray-cast over every ring: even-odd handles holes without special cases. */
function contains(geometry, lng, lat) {
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []
  for (const rings of polygons) {
    let inside = false
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside
        }
      }
    }
    if (inside) return true
  }
  return false
}

const depthOf = (feature, byId) => {
  let depth = 0
  for (
    let parent = feature.properties.parent;
    parent;
    parent = byId.get(parent)?.properties.parent
  ) {
    depth++
  }
  return depth
}

/** The deepest Geofabrik region containing each point — one per point, deduped. */
export function regionsForPoints(index, points) {
  const byId = new Map(index.features.map(feature => [feature.properties.id, feature]))
  const chosen = new Map()
  for (const [lng, lat] of points) {
    let best = null
    let bestDepth = -1
    for (const feature of index.features) {
      if (!feature.properties.urls?.pbf) continue
      const depth = depthOf(feature, byId)
      if (depth <= bestDepth) continue
      if (contains(feature.geometry, Number(lng), Number(lat))) {
        best = feature
        bestDepth = depth
      }
    }
    if (best) chosen.set(best.properties.id, best.properties.urls.pbf)
  }
  return [...chosen.entries()].map(([id, url]) => ({ id, url }))
}

export function createCoverage({
  listPoints,
  wantedPath,
  indexUrl = DEFAULT_INDEX_URL,
  fetch = globalThis.fetch,
  fs = null,
  logger = null,
  clock = () => new Date(),
  settleMs = 60_000,
}) {
  let cachedIndex = null
  let cachedAt = 0
  let lastWritten = null
  let timer = null

  async function loadIndex() {
    if (cachedIndex && clock().getTime() - cachedAt < INDEX_TTL_MS) return cachedIndex
    const response = await fetch(indexUrl)
    if (!response.ok) {
      throw new Error(`geofabrik index refused: ${response.status}`)
    }
    cachedIndex = await response.json()
    cachedAt = clock().getTime()
    logger?.info(
      { evt: 'coverage.index', regions: cachedIndex.features.length },
      'region index loaded',
    )
    return cachedIndex
  }

  async function refresh() {
    const started = clock().getTime()
    try {
      const points = await listPoints()
      if (!points.length) {
        logger?.info({ evt: 'coverage', points: 0 }, 'no stops yet; coverage unchanged')
        return []
      }
      const regions = regionsForPoints(await loadIndex(), points)
      const wanted = regions
        .map(region => region.url)
        .sort()
        .join('\n')
      const changed = wanted !== lastWritten
      if (changed) {
        await fs.writeFile(wantedPath, wanted + '\n')
        lastWritten = wanted
      }
      logger?.info(
        {
          evt: 'coverage',
          points: points.length,
          regions: regions.map(region => region.id),
          changed,
          ms: clock().getTime() - started,
        },
        'routing coverage derived from the trips',
      )
      return regions
    } catch (error) {
      // Coverage failing must never take a request down with it: the engine
      // keeps whatever tiles it has, and the reason is on the record.
      logger?.warn(
        { evt: 'coverage', err: error, ms: clock().getTime() - started },
        'coverage refresh failed',
      )
      return null
    }
  }

  return {
    refresh,
    /** Stops changed; recompute soon, once, not per keystroke. */
    refreshSoon() {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        refresh()
      }, settleMs)
      timer.unref?.()
    },
  }
}
