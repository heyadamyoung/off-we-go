/* The door into the places layer.
 *
 * Everything inside it — the SQL, the ranking, the cells, the coverage queue,
 * the Parquet fallback — is internal, and app.js should need exactly one
 * import and one call to serve the lot. That is what this exports.
 *
 * The queue, the fallback, the upstream release and the worker are exported
 * beside it for the callers that legitimately need them without the routes:
 * the entrypoint, which starts the worker that drains what the routes
 * enqueue; the ingest script, which does the same job from a terminal; and
 * the trip write path, which tells the queue that a trip's stops moved. The
 * routes decorate the app with `placeCoverage` so that last caller needs no
 * wiring of its own.
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
export { createReleaseLoader, createFooterStore, DEFAULT_INDEX_DIR } from './upstream.js'
export { createPlaceWorker, CELLS_PER_TICK, TICK_MS } from './worker.js'
export {
  createPlaceFallback,
  fallbackInFlight,
  resetFallbackCache,
  CONCURRENCY,
  DEADLINE_MS,
} from './fallback.js'
