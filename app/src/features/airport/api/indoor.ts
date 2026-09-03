import { loadAirportIndoor } from '../../../backend'
import {
  indoorFeatures,
  overpassQueryFor,
  type IndoorFeature,
  type OverpassResponse,
} from '../../../airport-indoor-core'
import type { Stop } from '../../../shared/model/types'

/* Overpass is a public good with no key and no account, which also means no
   SLA: a few mirrors, tried in turn. A terminal's floor plan changes on the
   timescale of construction work, so what came back is kept — in memory for
   the session and in localStorage for the next trip through this airport. */
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
  // is for a mirror that accepts the connection and then sits on it.
  const res = await fetch(base, {
    method: 'POST',
    body: query,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error('Overpass answered ' + res.status)
  return indoorFeatures((await res.json()) as OverpassResponse)
}

/* Hedged rather than strictly serial: the primary gets a six-second head
   start, then the next mirror joins the race — a tarpitted primary costs six
   seconds, not its whole deadline. First answer wins; a failure launches the
   next mirror at once. */
function fromMirrors(query: string): Promise<IndoorFeature[]> {
  return new Promise((resolve, reject) => {
    let launched = 0,
      failed = 0,
      settled = false
    const launch = () => {
      if (settled || launched >= MIRRORS.length) return
      askMirror(MIRRORS[launched++], query).then(
        found => {
          if (!settled) {
            settled = true
            resolve(found)
          }
        },
        caught => {
          if (settled) return
          if (++failed === MIRRORS.length) {
            settled = true
            reject(caught)
          } else launch()
        },
      )
      if (launched < MIRRORS.length) setTimeout(launch, 6000)
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

/* The server's shared cache first — one warm answer instead of a mirror
   lottery — and OSM directly when there is no backend to ask, it predates the
   route, or it is briefly unreachable. */
async function fromAnywhere(stop: Stop): Promise<IndoorFeature[]> {
  try {
    const viaServer = await loadAirportIndoor(stop.lng, stop.lat)
    if (viaServer) return indoorFeatures(viaServer)
  } catch {
    /* the mirrors are still there */
  }
  return fromMirrors(overpassQueryFor(stop.lng, stop.lat))
}
