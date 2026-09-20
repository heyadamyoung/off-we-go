/* The door into the places layer.
 *
 * Everything inside it — the SQL, the ranking, the cells, the coverage queue,
 * the Parquet fallback — is internal, and app.js should need exactly one
 * import and one call to serve the lot. That is what this exports.
 *
 * The queue and the fallback are exported beside it for the two callers that
 * legitimately need them without the routes: the ingest script, which drains
 * what `registerPlaceRoutes` enqueues, and the trip write path, which tells
 * the queue that a trip's stops moved. The routes decorate the app with
 * `placeCoverage` so that second caller needs no wiring of its own.
 */

export { registerPlaceRoutes, attributionFor, MAX_LIMIT } from './routes.js'
export {
  createPlaceCoverage,
  cellsForStops,
  isReady,
  isStale,
  needsRequest,
  LOOKAHEAD_METRES,
} from './coverage.js'
export { createReleaseLoader, DEFAULT_INDEX_DIR } from './upstream.js'
export {
  createPlaceFallback,
  fallbackInFlight,
  resetFallbackCache,
  CONCURRENCY,
  DEADLINE_MS,
} from './fallback.js'
