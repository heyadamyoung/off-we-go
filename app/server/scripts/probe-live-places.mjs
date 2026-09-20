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
 *   node server/scripts/probe-live-places.mjs [host]
 */

const host = process.argv[2] || process.env.PLACES_HOST || 'offwego.to'

/* Viewports, not points: this is the query shape the map makes. One dense
   European city, one prairie city, and the two ends of the trip that is
   running right now — a layer that works in Amsterdam and nowhere else is
   the failure this whole layer was built to end. */
const VIEWS = [
  { name: 'Amsterdam', west: 4.86, south: 52.35, east: 4.92, north: 52.39 },
  { name: 'Regina', west: -104.65, south: 50.42, east: -104.55, north: 50.47 },
  { name: 'Toronto', west: -79.4, south: 43.64, east: -79.36, north: 43.66 },
  { name: 'Dublin', west: -6.28, south: 53.33, east: -6.24, north: 53.36 },
]

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
    }
  } catch (error) {
    return { ...view, ms: Date.now() - started, error: String(error?.message || error) }
  }
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
  for (const place of found.sample) console.log(`             · ${place.name} — ${place.category}`)
}

console.log(`\n${served} of ${VIEWS.length} viewports answered with pins.`)
/* Not a failure: a city whose cell has not been drained yet is honestly
   empty, and an exit code that says otherwise would make this useless as
   the thing you run to watch the queue fill. */
