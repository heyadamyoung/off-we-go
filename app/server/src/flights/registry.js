/* Which board to ask about which airport, and one place to ask it from.
 *
 * Three providers today, chosen by IATA code. Every board is read through
 * the cache, so the trips watching the same airport share one request a
 * minute between them, and every provider's health is kept in one place for
 * the health endpoint and the report. */

import { createBoardCache } from './board-cache.js'
import { createBoardHttp } from './http.js'
import { createAdsbProvider } from './providers/adsb.js'
import { createDublinProvider } from './providers/dublin.js'
import { createPearsonProvider } from './providers/pearson.js'
import { createReginaProvider } from './providers/regina.js'

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]  for the boards fetch can read
 * @param {Function} [options.http]  the browser-like client for the one it cannot (flights/http.js)
 * @param {() => number} [options.now]
 * @param {number} [options.cacheTtlMs]  how long a board is served without asking again
 */
export function createFlightSources({
  fetch = globalThis.fetch,
  http = null,
  now = () => Date.now(),
  cacheTtlMs = 60_000,
} = {}) {
  const providers = new Map()
  for (const provider of [
    createDublinProvider({ fetch, now }),
    createReginaProvider({ fetch, now }),
    createPearsonProvider({ fetch: http || createBoardHttp(), now }),
  ]) {
    providers.set(provider.airportCode, provider)
  }
  const cache = createBoardCache({ ttlMs: cacheTtlMs, now })
  const adsb = createAdsbProvider({ fetch, now })

  const providerFor = code => providers.get(String(code || '').toUpperCase()) || null

  return {
    providers,
    cache,
    adsb,
    providerFor,

    /** Every airport with a board, and whether its board can be asked. */
    airports() {
      return [...providers.values()].map(provider => ({
        code: provider.airportCode,
        source: provider.source,
        zone: provider.zone,
        configured: provider.configured !== false,
      }))
    },

    /**
     * One board, from the cache when it is fresh. `date` is YYYY-MM-DD in the
     * airport's own day for the providers that take one; the others carry
     * today whatever is asked.
     * @returns {Promise<{value: import('./model.js').FlightInfo[]|null, fetchedAt: number|null, stale: boolean, error: Error|null}|null>}
     */
    async board(code, direction, date = null) {
      const provider = providerFor(code)
      if (!provider) return null
      const day = provider.datedBoards ? date || 'today' : 'today'
      return cache.get(
        `${provider.airportCode}:${direction}:${day}`,
        () => (direction === 'arrival' ? provider.arrivals(date) : provider.departures(date)),
        { source: provider.source },
      )
    },

    health() {
      return cache.health()
    },
  }
}
