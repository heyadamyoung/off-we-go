/* Travel times from a self-hosted Valhalla, the one piece a hand-drawn route
   cannot fake: how long the road actually takes.

   Built debug-first, because the assistant's certificate outage taught us
   what a silent integration costs: every refusal logs the upstream status
   and body, every timeout and network failure logs its cause and latency,
   and a missing engine is a visible 503 at the API and a `routing: false`
   on /api/health — never a feature that quietly shows nothing. A failed leg
   degrades to absence (the itinerary still renders), but the reason is
   always one `docker logs` away. */

const round = value => Math.round(Number(value) * 1e5) / 1e5
// Number(null) is 0 — finite, and a real place in the Gulf of Guinea. Reject
// the absent explicitly, not just the non-numeric.
const coordinate = value => value != null && value !== '' && Number.isFinite(Number(value))

/* Which gaps deserve a travel time: consecutive stops of the same day, in
   itinerary order. A leg across midnight is not a journey anyone takes in
   one go, and a stop without a real coordinate cannot be routed to. */
export function consecutiveDayLegs(stops) {
  const ordered = [...stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const pairs = []
  for (let index = 1; index < ordered.length; index++) {
    const from = ordered[index - 1]
    const to = ordered[index]
    if ((from.day ?? null) !== (to.day ?? null)) continue
    if (![from.lng, from.lat, to.lng, to.lat].every(coordinate)) continue
    pairs.push({ from, to })
  }
  return pairs
}

export const LEG_MODES = new Set(['auto', 'pedestrian', 'bicycle'])

/* Valhalla's encoded polyline, precision 1e-6, decoded to [lng,lat] pairs —
   the shape a phone draws between "you are here" and the museum steps. */
export function decodeShape(encoded) {
  const points = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const which of [0, 1]) {
      let result = 0
      let shift = 0
      let byte
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lng += delta
    }
    points.push([lng / 1e6, lat / 1e6])
  }
  return points
}

export function createValhallaRouting({
  url,
  fetch = globalThis.fetch,
  logger = null,
  clock = () => new Date(),
  timeoutMs = 10_000,
  cacheSize = 1000,
}) {
  const root = String(url).replace(/\/$/, '')
  /* Stops move rarely and questions repeat; a small LRU spares the engine.
     Only answers are cached — a refusal might be the engine still building
     its tiles, and must be asked again. */
  const cache = new Map()
  const remember = (key, value) => {
    cache.set(key, value)
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value)
  }

  async function leg(from, to, mode) {
    const key = `${mode}:${round(from.lng)},${round(from.lat)}>${round(to.lng)},${round(to.lat)}`
    if (cache.has(key)) return cache.get(key)
    const started = clock().getTime()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      const response = await fetch(`${root}/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          locations: [
            { lat: Number(from.lat), lon: Number(from.lng) },
            { lat: Number(to.lat), lon: Number(to.lng) },
          ],
          costing: mode,
          directions_type: 'none',
          units: 'kilometers',
        }),
      })
      const ms = clock().getTime() - started
      if (!response.ok) {
        const body = (await response.text().catch(() => '')).slice(0, 300)
        logger?.warn({ status: response.status, body, key, ms }, 'valhalla refused a leg')
        return null
      }
      const summary = (await response.json())?.trip?.summary
      if (!summary || !Number.isFinite(summary.time)) {
        logger?.warn({ key, ms }, 'valhalla answered without a usable summary')
        return null
      }
      const value = { seconds: Math.round(summary.time), meters: Math.round(summary.length * 1000) }
      logger?.debug({ key, ms, ...value }, 'valhalla leg')
      remember(key, value)
      return value
    } catch (error) {
      logger?.warn({ err: error, key, ms: clock().getTime() - started }, 'valhalla unreachable')
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    /** One question a phone asks on the spot: from here to that stop, by this
        mode — time, distance, and the shape to draw. Null when the engine
        cannot say; the phone falls back to the crow. */
    async routeBetween(from, to, mode = 'pedestrian') {
      const key = `shape:${mode}:${round(from.lng)},${round(from.lat)}>${round(to.lng)},${round(to.lat)}`
      if (cache.has(key)) return cache.get(key)
      const started = clock().getTime()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      timer.unref?.()
      try {
        const response = await fetch(`${root}/route`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            locations: [
              { lat: Number(from.lat), lon: Number(from.lng) },
              { lat: Number(to.lat), lon: Number(to.lng) },
            ],
            costing: mode,
            directions_type: 'none',
            units: 'kilometers',
          }),
        })
        const ms = clock().getTime() - started
        if (!response.ok) {
          const body = (await response.text().catch(() => '')).slice(0, 300)
          logger?.warn({ status: response.status, body, key, ms }, 'valhalla refused a route')
          return null
        }
        const trip = (await response.json())?.trip
        const summary = trip?.summary
        if (!summary || !Number.isFinite(summary.time)) {
          logger?.warn({ key, ms }, 'valhalla answered without a usable summary')
          return null
        }
        const shape = (trip.legs || []).flatMap(part =>
          typeof part.shape === 'string' ? decodeShape(part.shape) : [],
        )
        const value = {
          seconds: Math.round(summary.time),
          meters: Math.round(summary.length * 1000),
          shape,
        }
        logger?.debug({ key, ms, seconds: value.seconds, meters: value.meters }, 'valhalla route')
        remember(key, value)
        return value
      } catch (error) {
        logger?.warn({ err: error, key, ms: clock().getTime() - started }, 'valhalla unreachable')
        return null
      } finally {
        clearTimeout(timer)
      }
    },
    /** Ordered stops in, labelled legs out; a leg the engine cannot answer is simply absent. */
    async legsFor(stops, mode = 'auto') {
      const legs = []
      for (const { from, to } of consecutiveDayLegs(stops)) {
        const value = await leg(from, to, mode)
        if (value) legs.push({ fromId: from.id, toId: to.id, day: from.day ?? null, ...value })
      }
      return legs
    },
  }
}
