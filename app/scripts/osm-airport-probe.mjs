/* What OpenStreetMap holds for one airport, printed as a table.

     node scripts/osm-airport-probe.mjs <lat> <lng> [radius]

   Every aeroway=gate and aeroway=parking_position element within the radius,
   with its tags and how far it sits from the nearest terminal outline, so a
   drawing rule ("a gate is at the terminal; a stand is out on the apron")
   can be checked against the data before it is written. Runs from a machine
   with open internet; the sandbox this app is developed in has none. */

const [lat, lng, radius = '1500'] = process.argv.slice(2).map(String)
if (!lat || !lng) {
  console.error('usage: node scripts/osm-airport-probe.mjs <lat> <lng> [radius]')
  process.exit(2)
}
const around = `(around:${radius},${lat},${lng})`
const query =
  `[out:json][timeout:60];(` +
  `node["aeroway"="gate"]${around};way["aeroway"="gate"]${around};` +
  `node["aeroway"="parking_position"]${around};way["aeroway"="parking_position"]${around};` +
  `way["aeroway"="terminal"]${around};` +
  `node["level"]["name"]${around};` +
  `);out geom 6000;`

const response = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: query,
  headers: { 'User-Agent': 'OffWeGo/0.1 (airport probe)' },
})
if (!response.ok) throw new Error(`Overpass answered ${response.status}`)
const body = await response.json()
if (body.remark) console.log('remark:', body.remark)
const elements = body.elements || []

const metres = (a, b) => {
  const dx = (a.lon - b.lon) * 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  const dy = (a.lat - b.lat) * 110_540
  return Math.hypot(dx, dy)
}
const toSegment = (p, a, b) => {
  const ab = { lon: b.lon - a.lon, lat: b.lat - a.lat }
  const ap = { lon: p.lon - a.lon, lat: p.lat - a.lat }
  const len = ab.lon * ab.lon + ab.lat * ab.lat
  const t = len ? Math.max(0, Math.min(1, (ap.lon * ab.lon + ap.lat * ab.lat) / len)) : 0
  return metres(p, { lon: a.lon + ab.lon * t, lat: a.lat + ab.lat * t })
}
const inside = (p, ring) => {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a.lat > p.lat !== b.lat > p.lat &&
      p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon
    )
      hit = !hit
  }
  return hit
}
const centre = geometry => ({
  lon: geometry.reduce((s, g) => s + g.lon, 0) / geometry.length,
  lat: geometry.reduce((s, g) => s + g.lat, 0) / geometry.length,
})

const terminals = elements.filter(e => e.type === 'way' && e.tags?.aeroway === 'terminal')
const placeOf = e => (e.type === 'node' ? { lon: e.lon, lat: e.lat } : centre(e.geometry || []))
const terminalDistance = p => {
  let best = Number.POSITIVE_INFINITY
  for (const t of terminals) {
    const ring = t.geometry || []
    if (inside(p, ring)) return 0
    for (let i = 1; i < ring.length; i++) best = Math.min(best, toSegment(p, ring[i - 1], ring[i]))
  }
  return best
}

const counts = {}
for (const e of elements) {
  const k = `${e.type}:${e.tags?.aeroway || (e.tags?.level != null ? 'level+name' : '?')}`
  counts[k] = (counts[k] || 0) + 1
}
console.log('elements', elements.length, JSON.stringify(counts))
console.log(
  'terminals',
  terminals.map(t => `${t.tags.name || t.id} (${(t.geometry || []).length} pts)`).join('; '),
)

const byRef = (a, b) =>
  String(a.tags.ref || a.tags.name || '').localeCompare(
    String(b.tags.ref || b.tags.name || ''),
    undefined,
    {
      numeric: true,
    },
  )
const show = (title, list) => {
  console.log(`\n== ${title}: ${list.length}`)
  for (const e of list.sort(byRef)) {
    const p = placeOf(e)
    const d = terminalDistance(p)
    const tags = Object.entries(e.tags)
      .filter(([k]) => !['aeroway', 'ref'].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    const far = Number.isFinite(d) ? `${Math.round(d)} m`.padStart(7) : '     ? '
    console.log(
      `${String(e.tags.ref || '(no ref)').padEnd(10)} ${e.type.padEnd(4)} ${far} ${p.lat.toFixed(5)},${p.lon.toFixed(5)}  ${tags}`,
    )
  }
}
show(
  'aeroway=gate',
  elements.filter(e => e.tags?.aeroway === 'gate'),
)
show(
  'aeroway=parking_position',
  elements.filter(e => e.tags?.aeroway === 'parking_position'),
)
const named = elements.filter(e => e.type === 'node' && e.tags?.level != null && e.tags?.name)
console.log(`\n== named nodes with a level: ${named.length}`)
console.log(
  named
    .map(e => `${e.tags.name} [${e.tags.level}]`)
    .slice(0, 400)
    .join(' | '),
)
