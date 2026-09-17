/* A board is fetched once per interval for everyone waiting on it.
 *
 * Ten legs at the same airport are one request, not ten: the unit of
 * fetching is the board, and the unit of interest is the flight. Between
 * fetches the last answer is served; when a fetch fails the last answer is
 * still served for a while, marked stale, because a board that was right two
 * minutes ago is better than a card that goes blank — and the failure is
 * remembered per source, so a site that has changed shape shows up as a
 * source that keeps failing rather than as a flight that quietly stopped
 * updating. */

export function createBoardCache({
  ttlMs = 60_000,
  staleForMs = 20 * 60_000,
  now = () => Date.now(),
} = {}) {
  const entries = new Map()
  const loading = new Map()
  const health = new Map()

  const noteOk = (source, at) => {
    const row = health.get(source) || { failures: 0 }
    health.set(source, { ...row, lastOkAt: at, failures: 0, lastError: null })
  }
  const noteFailure = (source, at, error) => {
    const row = health.get(source) || { failures: 0 }
    health.set(source, {
      ...row,
      lastErrorAt: at,
      lastError: error?.message || String(error),
      failures: (row.failures || 0) + 1,
    })
  }

  return {
    /**
     * The board under `key`, loaded with `load()` when the cached one is
     * older than the ttl. Concurrent callers share one load.
     * @returns {Promise<{value: *, fetchedAt: number, stale: boolean, error: Error|null}>}
     */
    async get(key, load, { source = key } = {}) {
      const at = now()
      const held = entries.get(key)
      if (held && at - held.fetchedAt < ttlMs) return { ...held, stale: false, error: null }
      if (loading.has(key)) return loading.get(key)

      const attempt = (async () => {
        try {
          const value = await load()
          const fresh = { value, fetchedAt: now() }
          entries.set(key, fresh)
          noteOk(source, fresh.fetchedAt)
          return { ...fresh, stale: false, error: null }
        } catch (error) {
          noteFailure(source, now(), error)
          if (held && now() - held.fetchedAt < staleForMs) {
            return { ...held, stale: true, error }
          }
          return { value: null, fetchedAt: held?.fetchedAt ?? null, stale: true, error }
        } finally {
          loading.delete(key)
        }
      })()
      loading.set(key, attempt)
      return attempt
    },

    /** What is known about each source: last success, last failure, streak. */
    health() {
      return Object.fromEntries(health)
    },

    forget(key) {
      entries.delete(key)
    },

    size() {
      return entries.size
    },
  }
}
