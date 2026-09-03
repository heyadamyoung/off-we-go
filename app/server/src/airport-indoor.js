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
  /* VK Maps' public instance: planet-wide, free, no stated limits, big iron —
     but its front proxy cuts queries at about thirty seconds, so the very
     largest terminals (Pearson wants 24-33) can 504 here while the three
     above finish. Last for that reason.

     The rest of the free world, surveyed 2026-09-03, for whoever next goes
     looking: kumi still answers but has left the wiki's public list;
     osm.jp's TLS certificate is expired; and the regional instances
     (osm.ch and friends) are traps for this file — they answer 200 with
     EMPTY results for anywhere outside their extract, and a cache would
     remember that emptiness as "nobody mapped this airport" for a month.
     Everything else on the wiki wants an API key. */
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
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
  /* Longer than the query's own [timeout:40]: Overpass is allowed forty
     seconds of honest work, and a big terminal uses them — Pearson answers in
     24-33. Aborting the fetch at twenty turned every large airport into a
     permanent 502, from every mirror, which read as "the route is broken"
     when it was this number. */
  deadlineMs = 42000,
  /* The durable copy, shared between restarts: { read(key) -> {at, body} or
     null, write(key, body, at) }. Without it the month-long memory lives and
     dies with the process, and every deploy sends the next phone back to
     Overpass for a terminal already paid for. */
  store = null,
} = {}) {
  const done = new Map() // key -> { at, body }
  const pending = new Map() // key -> Promise, so a stampede is one request

  const remember = (key, entry) => {
    done.delete(key) // re-insertion keeps the Map in age order
    done.set(key, entry)
    while (done.size > max) done.delete(done.keys().next().value)
  }

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
        flight = (async () => {
          // The durable copy first — a restart forgot this Map, not the month.
          const durable = store ? await store.read(key).catch(() => null) : null
          if (durable && clock().getTime() - durable.at < ttlMs) {
            remember(key, { at: durable.at, body: durable.body })
            return durable.body
          }
          let body
          try {
            body = await fromMirrors(queryFor(lng, lat))
          } catch (error) {
            // Floor plans change on the timescale of construction work:
            // last month's terminal beats an outage's empty hands.
            if (durable) return durable.body
            throw error
          }
          const at = clock().getTime()
          remember(key, { at, body })
          if (store) store.write(key, body, at).catch(() => {})
          return body
        })().finally(() => pending.delete(key))
        pending.set(key, flight)
      }
      return flight
    },
  }
}
