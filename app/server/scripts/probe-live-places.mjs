/* What the live places layer is actually answering, asked from outside.
 *
 * The development sandbox has no route to the deployment, so "the map draws
 * pins now" has until now been a deduction from the code rather than an
 * observation — and that cost us a week of a traveller staring at "still
 * loading places here". This runs on a runner, asks the real server for a
 * handful of real viewports, and prints what came back.
 *
 * Read-only and unauthenticated: none of these need a session by design,
 * because the map draws before anybody signs in.
 *
 *   node server/scripts/probe-live-places.mjs [host] [name:w,s,e,n ...]
 *
 * Three questions per viewport, because they are three different paths and
 * only one of them is what a map pays:
 *
 *   coverage  is this ground ingested — the one question the tiles cannot
 *             answer, and all the app asks on a pan
 *   tiles     what the map actually draws, at three zooms, timed twice so a
 *             built tile and a kept one are told apart, and decoded so the
 *             count is what MapLibre will see rather than a byte length
 *   in-view   the whole viewport in one answer, uncapped. Nothing in the app
 *             asks for this any more; it is here because it is the only view
 *             that can be compared against the tiles to prove they agree
 *
 * Extra viewports are asked for as well as the standing ones, so "is Scotland
 * covered yet" is one dispatch rather than a deploy. That matters more than it
 * sounds: reading coverage off a deploy restarts the planet sweep, which is
 * how the first run kept losing its place.
 */

import { tileHolds } from '../src/places/mvt.js'
import { STANDING, tileFor } from '../src/places/viewpoints.js'

const host = process.argv[2] || process.env.PLACES_HOST || 'offwego.to'

/** `Glasgow:-4.3,55.84,-4.2,55.88`, from the command line or PLACES_VIEWS. */
function viewFrom(text) {
  const at = String(text).lastIndexOf(':')
  const name = at > 0 ? text.slice(0, at) : 'asked for'
  const numbers = (at > 0 ? text.slice(at + 1) : text).split(',').map(Number)
  if (numbers.length !== 4 || numbers.some(one => !Number.isFinite(one))) {
    console.error(`Not a viewport: ${text} — wanted name:west,south,east,north`)
    process.exit(64)
  }
  const [west, south, east, north] = numbers
  return { name, west, south, east, north }
}

const asked = [...process.argv.slice(3), ...(process.env.PLACES_VIEWS || '').split(/\s+/)]
  .filter(Boolean)
  .map(viewFrom)
const VIEWS = [...STANDING, ...asked]

const pad = (text, width) => String(text).padEnd(width)
const kb = bytes => `${(bytes / 1024).toFixed(1)}KB`

/* Every zoom the pyramid has, because the bug that needed seeing was a mark
   present at one zoom, gone a step in, and back a step further — which no
   sample of three zooms can show. */
const TILE_ZOOMS = [11, 12, 13, 14, 15, 16, 17]

/**
 * One tile, twice: what it costs to build and what it costs once kept.
 *
 * The second number is the one almost every request pays — tiles are built
 * once and then looked up, and cached at the edge on top of that — and the
 * first is what the unlucky first visitor to a square pays.
 */
async function tile(view, z) {
  return tileAt(tileFor((view.west + view.east) / 2, (view.south + view.north) / 2, z))
}

/** One square, named by the grid rather than by a viewport. */
async function tileAt({ z, x, y }) {
  const url = `https://${host}/api/places/tiles/${z}/${x}/${y}`
  const timed = async () => {
    const started = Date.now()
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    const body = new Uint8Array(await response.arrayBuffer())
    return {
      ms: Date.now() - started,
      status: response.status,
      body,
      /* What the box says it spent on it — total, database, and how many
         callers were queued for a connection. The wire is the difference. */
      timing: response.headers.get('server-timing') || '',
      /* And whether anything between here and the box kept a copy.
       *
       * A tile is `public, max-age=3600` and is the same bytes for everybody,
       * so it is exactly what an edge cache is for — and a HIT from a nearby
       * point of presence is tens of milliseconds where a trip to the origin
       * is hundreds. But a CDN decides for itself what is cacheable, and the
       * usual default is that anything under `/api/` is dynamic and goes
       * straight through however the origin labels it.
       *
       * Which means the difference between "the box answers in 2 ms" and
       * "the dots take ten seconds" can be entirely this header, and we have
       * never once looked at it. BYPASS or DYNAMIC on a tile means every
       * phone pays the full distance for bytes that never change. */
      edge:
        response.headers.get('cf-cache-status') ||
        response.headers.get('x-cache') ||
        (response.headers.get('age') ? `age=${response.headers.get('age')}` : 'not cached'),
    }
  }
  try {
    const first = await timed()
    if (first.status !== 200) return { z, x, y, error: `HTTP ${first.status}`, ms: first.ms }
    const again = await timed()
    return {
      z,
      x,
      y,
      ms: first.ms,
      kept: again.ms,
      bytes: first.body.length,
      /* What the box says it spent, so what is left over is the wire. */
      timing: again.timing,
      edge: `${first.edge} then ${again.edge}`,
      ...tileHolds(first.body),
    }
  } catch (error) {
    return { z, x, y, error: String(error?.message || error) }
  }
}

/**
 * Whether a mark drawn at one zoom is still drawn at the next.
 *
 * Reported from the road: "grey dots show at a further out zoom, then I
 * scroll in a bit and they disappear, then I zoom in more and they come
 * back." Nothing in the database could do that — a tile asks
 * `label_zoom <= z`, so what a zoom draws is a subset of what the next one
 * draws — and nothing we could ask from here would have shown it, because
 * the probe read one tile at a time and never compared two.
 *
 * So it compares them. A square at z covers exactly the four squares below
 * it, so the ids in the parent must all appear among its children's. What is
 * missing is named, which is the difference between "something is wrong with
 * the map" and "these eleven marks vanish between 12 and 13".
 */
async function pyramid(view) {
  const lng = (view.west + view.east) / 2
  const lat = (view.south + view.north) / 2
  const held = new Map()
  for (const z of TILE_ZOOMS) {
    const at = tileFor(lng, lat, z)
    const drawn = await tile(view, z)
    held.set(z, { at, ids: new Set(drawn.own || []), error: drawn.error })
  }
  for (let z = TILE_ZOOMS[0]; z < TILE_ZOOMS.at(-1); z += 1) {
    const here = held.get(z)
    const next = held.get(z + 1)
    if (!here || !next || here.error || next.error) continue
    /* Only the marks inside the parent's own square are owed: a tile also
       carries its neighbours' marks within the buffer, to draw a seam whole,
       and those belong to another square's four children. */
    const children = [
      { z: z + 1, x: here.at.x * 2, y: here.at.y * 2 },
      { z: z + 1, x: here.at.x * 2 + 1, y: here.at.y * 2 },
      { z: z + 1, x: here.at.x * 2, y: here.at.y * 2 + 1 },
      { z: z + 1, x: here.at.x * 2 + 1, y: here.at.y * 2 + 1 },
    ]
    const below = new Set()
    for (const child of children) {
      const drawn = await tileAt(child)
      if (drawn.error) continue
      for (const id of drawn.ids || []) below.add(id)
    }
    const lost = [...here.ids].filter(id => !below.has(id))
    console.log(
      `             z${pad(z, 3)}→${z + 1}  ${pad(`${here.ids.size} marks`, 12)}` +
        (lost.length ? `${lost.length} vanish on the way in` : 'all still drawn'),
    )
  }
}

/** The question the app actually asks on every settled pan. */
async function coverage(view) {
  const query = new URLSearchParams({
    west: String(view.west),
    south: String(view.south),
    east: String(view.east),
    north: String(view.north),
  })
  const started = Date.now()
  try {
    const response = await fetch(`https://${host}/api/places/coverage?${query}`, {
      signal: AbortSignal.timeout(30_000),
    })
    const ms = Date.now() - started
    if (!response.ok) return { ms, error: `HTTP ${response.status}` }
    const body = await response.json()
    return { ms, degraded: Boolean(body.degraded), attribution: body.attribution?.length ?? 0 }
  } catch (error) {
    return { ms: Date.now() - started, error: String(error?.message || error) }
  }
}

async function ask(view) {
  const query = new URLSearchParams({
    west: String(view.west),
    south: String(view.south),
    east: String(view.east),
    north: String(view.north),
  })
  const url = `https://${host}/api/places/in-view?${query}`
  const started = Date.now()
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    const ms = Date.now() - started
    if (!response.ok) return { ...view, ms, error: `HTTP ${response.status}` }
    const body = await response.json()
    return {
      ...view,
      ms,
      pins: body.places?.length ?? 0,
      degraded: Boolean(body.degraded),
      cell: body.coverage?.cell ?? null,
      status: body.coverage?.status ?? null,
      attribution: body.attribution?.length ?? 0,
      sample: (body.places || []).slice(0, 3),
      /* The zooms the pins carry, which is the only thing that answers "did
         the zoom pass run" from outside the box.
         Pin counts do not: the count answers how much is under the camera,
         not which tier of it is drawn, which is exactly why two carpets of
         dots reached a phone while the probe said everything was fine.
         A pass that has not run leaves every row null, and a null is drawn
         from the first zoom — so all-eleven means not yet, and a spread
         across eleven to seventeen means it has. */
      zooms: countZooms(body.places || []),
    }
  } catch (error) {
    return { ...view, ms: Date.now() - started, error: String(error?.message || error) }
  }
}

/** How many pins at each zoom, lowest first: `11:24 12:31 17:245`. */
function countZooms(places) {
  const seen = new Map()
  for (const place of places) {
    const at = Number.isFinite(place?.minzoom) ? place.minzoom : null
    const key = at === null ? 'none' : String(at)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return [...seen.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([zoom, count]) => `${zoom}:${count}`)
    .join(' ')
}

const health = await fetch(`https://${host}/api/health`)
  .then(response => String(response.status))
  .catch(error => String(error?.message || error))
console.log(`${host} health: ${health}\n`)

let served = 0
for (const view of VIEWS) {
  const found = await ask(view)
  if (found.error) {
    console.log(`${pad(found.name, 12)} ${found.error} (${found.ms}ms)`)
    continue
  }
  if (found.pins > 0) served += 1
  console.log(
    `${pad(found.name, 12)} pins=${pad(found.pins, 5)} degraded=${pad(found.degraded, 6)}` +
      ` attribution=${pad(found.attribution, 3)} ${found.ms}ms` +
      (found.cell ? `  waiting on ${found.cell} (${found.status})` : ''),
  )
  if (found.zooms) console.log(`             zooms ${found.zooms}`)
  const ground = await coverage(view)
  console.log(
    `             coverage ${ground.error ? ground.error : `${ground.ms}ms`}` +
      (ground.error ? '' : ` degraded=${ground.degraded} attribution=${ground.attribution}`),
  )
  for (const z of TILE_ZOOMS) {
    const drawn = await tile(view, z)
    if (drawn.error) {
      console.log(`             z${pad(z, 3)} ${drawn.x}/${drawn.y}  ${drawn.error}`)
      continue
    }
    console.log(
      `             z${pad(z, 3)} ${pad(`${drawn.x}/${drawn.y}`, 12)}` +
        ` ${pad(`${drawn.ms}ms then ${drawn.kept}ms`, 17)} ${pad(kb(drawn.bytes), 8)}` +
        ` ${pad(`${drawn.features} drawn`, 12)} ${drawn.zooms}` +
        (drawn.timing ? `\n                  the box says ${drawn.timing}` : '') +
        (drawn.edge ? `\n                  the edge says ${drawn.edge}` : ''),
    )
  }
  await pyramid(view)
  for (const place of found.sample) console.log(`             · ${place.name} — ${place.category}`)
}

console.log(`\n${served} of ${VIEWS.length} viewports answered with pins.`)
/* Not a failure: a city whose cell has not been drained yet is honestly
   empty, and an exit code that says otherwise would make this useless as
   the thing you run to watch the queue fill. */
