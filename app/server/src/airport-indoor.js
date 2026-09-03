/* Airport interiors, fetched from OpenStreetMap's Overpass API once and then
   served from here. The public Overpass instances are free, keyless and
   moody: one will accept a connection and sit on it, another wants a proper
   User-Agent, and all of them deserve better than every phone re-asking for
   the same terminal. So the server asks, remembers, and shares — a terminal's
   floor plan changes on the timescale of construction work.

   The query mirrors the one in src/airport-indoor-core.ts (overpassQueryFor);
   the raw Overpass JSON goes back to the client, which owns the conversion.
   Keep the two in step. */

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

function queryFor(lng, lat, radius = 1500) {
  const around = `(around:${radius},${lat.toFixed(5)},${lng.toFixed(5)})`
  return (
    `[out:json][timeout:40];(` +
    `way["indoor"]${around};` +
    `way["aeroway"="terminal"]${around};` +
    `way["aeroway"="gate"]${around};` +
    `way["highway"~"^(footway|corridor|steps)$"]["level"]${around};` +
    `node["aeroway"="gate"]${around};` +
    `node["highway"="elevator"]${around};` +
    `node["level"]["name"]${around};` +
    `node["level"]["amenity"="toilets"]${around};` +
    `);out geom 4000;`
  )
}

export function createIndoorCache({
  fetchImpl = fetch,
  userAgent = 'OffWeGo/0.1 (travel app)',
  clock = () => new Date(),
  ttlMs = 30 * 24 * 3600 * 1000,
  max = 40, // airports remembered before the oldest goes
  hedgeMs = 6000,
  deadlineMs = 20000,
} = {}) {
  const done = new Map() // key -> { at, body }
  const pending = new Map() // key -> Promise, so a stampede is one request

  const askMirror = async (base, query) => {
    // The bare query as the body, and no Content-Type: overpass-api.de's
    // front server answers 406 to a form-encoded header, of all things.
    const res = await fetchImpl(base, {
      method: 'POST',
      body: query,
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(deadlineMs),
    })
    if (!res.ok) throw new Error('Overpass answered ' + res.status)
    return res.json()
  }

  /* Hedged rather than strictly serial: the primary gets a head start, then
     the next mirror joins the race. First answer wins; a failure launches the
     next mirror at once. */
  const fromMirrors = query =>
    new Promise((resolve, reject) => {
      let launched = 0,
        failed = 0,
        settled = false
      const hedges = new Set()
      /* Every waiting hedge is dropped the moment the race is over. It has to
         be cleared rather than unref'd: when the primary mirror accepts the
         connection and then sits on it, this timer is the only thing still
         due to happen, and an unref'd one lets the process wind down while
         the caller is still waiting for an answer that can now never come. */
      const finish = (settle, value) => {
        if (settled) return
        settled = true
        for (const hedge of hedges) clearTimeout(hedge)
        hedges.clear()
        settle(value)
      }
      const launch = () => {
        if (settled || launched >= MIRRORS.length) return
        askMirror(MIRRORS[launched++], query).then(
          body => finish(resolve, body),
          caught => {
            if (settled) return
            if (++failed === MIRRORS.length) finish(reject, caught)
            else launch()
          },
        )
        if (launched < MIRRORS.length) hedges.add(setTimeout(launch, hedgeMs))
      }
      launch()
    })

  return {
    async get(lng, lat) {
      const key = lng.toFixed(3) + ',' + lat.toFixed(3)
      const kept = done.get(key)
      if (kept && clock().getTime() - kept.at < ttlMs) return kept.body
      let flight = pending.get(key)
      if (!flight) {
        flight = fromMirrors(queryFor(lng, lat))
          .then(body => {
            done.delete(key) // re-insertion keeps the Map in age order
            done.set(key, { at: clock().getTime(), body })
            while (done.size > max) done.delete(done.keys().next().value)
            return body
          })
          .finally(() => pending.delete(key))
        pending.set(key, flight)
      }
      return flight
    },
  }
}
