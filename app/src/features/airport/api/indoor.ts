import { hasBackend, loadAirportIndoor } from '../../../backend'
import {
  indoorFeatures,
  overpassQueryFor,
  type IndoorFeature,
  type OverpassResponse,
} from '../../../airport-indoor-core'
import type { Stop } from '../../../shared/model/types'

/* One ask, for everyone — the owner's explicit call (2026-09-03): the server
   fetches a terminal from Overpass once, keeps it for the month in Postgres,
   and every phone pulls that shared copy. Overpass is a public good with no
   key and no SLA; a fleet of phones re-asking it for the same terminal would
   be rude and slow in equal measure. The mirrors below serve only a build
   with no backend at all (local dev) — production phones never touch them.
   What came back is kept here too: in memory for the session and in
   localStorage for the next trip through this airport. */
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

// The version in the prefix retires caches from before routes and landmarks,
// which lack the paths a route needs.
const STORE_PREFIX = 'wf-indoor2-'
const STORE_CAP = 2 // whole terminals are big; keep the last couple
const live = new Map<string, IndoorFeature[]>()

const keyFor = (stop: Stop) => stop.lng.toFixed(3) + ',' + stop.lat.toFixed(3)

function read(key: string): IndoorFeature[] | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key)
    return raw ? (JSON.parse(raw) as IndoorFeature[]) : null
  } catch {
    return null
  }
}

function write(key: string, features: IndoorFeature[]) {
  try {
    const raw = JSON.stringify(features)
    // Larger than this and it would evict everything else the app remembers.
    if (raw.length > 2_500_000) return
    localStorage.setItem(STORE_PREFIX + key, raw)
    const seen = (
      JSON.parse(localStorage.getItem(STORE_PREFIX + 'index') || '[]') as string[]
    ).filter(k => k !== key)
    seen.push(key)
    while (seen.length > STORE_CAP) {
      try {
        localStorage.removeItem(STORE_PREFIX + seen.shift())
      } catch {
        /* gone already */
      }
    }
    localStorage.setItem(STORE_PREFIX + 'index', JSON.stringify(seen))
  } catch {
    // Quota, or private browsing. The map still works, it just refetches.
    try {
      localStorage.removeItem(STORE_PREFIX + 'index')
    } catch {
      /* nothing to do */
    }
  }
}

async function askMirror(base: string, query: string) {
  // The bare query as the body, and no Content-Type: overpass-api.de's front
  // server answers 406 to a form-encoded header, of all things. The deadline
  // is for a mirror that accepts the connection and then sits on it — and it
  // must outlive the query's own [timeout:40]: a big terminal spends most of
  // those seconds honestly (Pearson answers in 24-33).
  const res = await fetch(base, {
    method: 'POST',
    body: query,
    signal: AbortSignal.timeout(40_000),
  })
  if (!res.ok) throw new Error('Overpass answered ' + res.status)
  return indoorFeatures((await res.json()) as OverpassResponse)
}

/* The server's shared cache. The guard outlives the server's own worst case —
   a cold terminal is hedged mirrors at 42 seconds each over there — so a
   route that hangs cannot pin the clock spinner up for ever. */
async function askServer(stop: Stop): Promise<IndoorFeature[]> {
  const guard = new Promise<never>((_, refuse) =>
    setTimeout(() => refuse(new Error('the server is taking too long')), 60_000),
  )
  const viaServer = await Promise.race([loadAirportIndoor(stop.lng, stop.lat), guard])
  if (viaServer) return indoorFeatures(viaServer)
  throw new Error('no server to ask')
}

/* Hedged rather than strictly serial: the favourite gets a six-second head
   start, then the next racer joins — a tarpitted favourite costs six seconds,
   not its whole deadline. First answer wins; a failure launches the next
   racer at once. */
function hedged(asks: Array<() => Promise<IndoorFeature[]>>): Promise<IndoorFeature[]> {
  return new Promise((resolve, reject) => {
    let launched = 0,
      failed = 0,
      settled = false
    const launch = () => {
      if (settled || launched >= asks.length) return
      asks[launched++]().then(
        found => {
          if (!settled) {
            settled = true
            resolve(found)
          }
        },
        caught => {
          if (settled) return
          if (++failed === asks.length) {
            settled = true
            reject(caught)
          } else launch()
        },
      )
      if (launched < asks.length) setTimeout(launch, 6000)
    }
    launch()
  })
}

/* One request per airport, shared: a remount mid-load (an itinerary edit, a
   dev-server hot update) latches onto the flight already in the air instead
   of shooting it down and starting another. */
const pending = new Map<string, Promise<IndoorFeature[]>>()

export async function indoorForStop(stop: Stop): Promise<IndoorFeature[]> {
  const key = keyFor(stop)
  const cached = live.get(key) || read(key)
  if (cached) {
    live.set(key, cached)
    return cached
  }
  let flight = pending.get(key)
  if (!flight) {
    flight = fromAnywhere(stop)
      .then(found => {
        live.set(key, found)
        write(key, found)
        return found
      })
      .finally(() => pending.delete(key))
    pending.set(key, flight)
  }
  return flight
}

/* With a backend, the server is the only door: it asks Overpass once and
   everyone shares the answer. A failure surfaces as the toast, and the next
   tap simply asks again — the server retries upstream on every miss. Only a
   backend-less build walks the mirrors itself. */
function fromAnywhere(stop: Stop): Promise<IndoorFeature[]> {
  if (hasBackend) return askServer(stop)
  const query = overpassQueryFor(stop.lng, stop.lat)
  return hedged(MIRRORS.map(base => () => askMirror(base, query)))
}
