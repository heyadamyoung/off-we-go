/* What the live places layer is actually answering, asked from outside.
 *
 * The development sandbox has no route to the deployment, so "the map draws
 * pins now" has until now been a deduction from the code rather than an
 * observation — and that cost us a week of a traveller staring at "still
 * loading places here". This runs on a runner, asks the real server for a
 * handful of real viewports, and prints what came back.
 *
 * Read-only and unauthenticated: /api/places/in-view needs no session by
 * design, because the map draws before anybody signs in.
 *
 *   node server/scripts/probe-live-places.mjs [host] [name:w,s,e,n ...]
 *
 * Extra viewports are asked for as well as the standing ones, so "is Scotland
 * covered yet" is one dispatch rather than a deploy. That matters more than it
 * sounds: reading coverage off a deploy restarts the planet sweep, which is
 * how the first run kept losing its place.
 */

const host = process.argv[2] || process.env.PLACES_HOST || 'offwego.to'

/* Viewports, not points: this is the query shape the map makes. Two dense
   European cities, one prairie city, and the two ends of the trip that is
   running right now — a layer that works in Amsterdam and nowhere else is
   the failure this whole layer was built to end. Edinburgh is here because
   the map was panned to Scotland and found nothing, and a standing viewport
   is the only kind that gets checked without somebody remembering to. */
const STANDING = [
  { name: 'Amsterdam', west: 4.86, south: 52.35, east: 4.92, north: 52.39 },
  { name: 'Edinburgh', west: -3.21, south: 55.94, east: -3.17, north: 55.96 },
  { name: 'Regina', west: -104.65, south: 50.42, east: -104.55, north: 50.47 },
  { name: 'Toronto', west: -79.4, south: 43.64, east: -79.36, north: 43.66 },
  { name: 'Dublin', west: -6.28, south: 53.33, east: -6.24, north: 53.36 },
]

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

async function ask(view) {
  const query = new URLSearchParams({
    west: String(view.west),
    south: String(view.south),
    east: String(view.east),
    north: String(view.north),
    limit: '300',
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
  for (const place of found.sample) console.log(`             · ${place.name} — ${place.category}`)
}

console.log(`\n${served} of ${VIEWS.length} viewports answered with pins.`)
/* Not a failure: a city whose cell has not been drained yet is honestly
   empty, and an exit code that says otherwise would make this useless as
   the thing you run to watch the queue fill. */
