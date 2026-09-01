function metres(a, b) {
  const R = 6371000, r = d => d * Math.PI / 180
  const dLat = r(b[1] - a[1]), dLng = r(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function validLngLat(lng, lat) {
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
}

function coordinateLabel([lng, lat], precision = 4) {
  return `${Math.abs(lat).toFixed(precision)}° ${lat >= 0 ? 'N' : 'S'}, `
    + `${Math.abs(lng).toFixed(precision)}° ${lng >= 0 ? 'E' : 'W'}`
}
function routeKm(coords) {
  let d = 0
  for (let i = 1; i < coords.length; i++) {
    const m = metres(coords[i - 1], coords[i])
    if (m < 50000) d += m
  }
  return d / 1000
}

/* Ground covered on foot from the phones' fixes: each phone's trail in turn,
   keeping only the steps that were clearly a step (GPS drifts a few metres
   standing still) and clearly not a vehicle. The longest of the phones'
   totals, since two phones in one pocket walked the same distance once. */
function trailKm(fixes) {
  const by = new Map()
  for (const f of fixes) {
    if (f.accuracy != null && f.accuracy > 80) continue
    if (!by.has(f.deviceId)) by.set(f.deviceId, [])
    by.get(f.deviceId).push(f)
  }
  let best = 0
  for (const list of by.values()) {
    let d = 0
    for (let i = 1; i < list.length; i++) {
      const m = metres([list[i - 1].lng, list[i - 1].lat], [list[i].lng, list[i].lat])
      const dt = (list[i].at - list[i - 1].at) / 1000
      if (m < 12 || dt <= 0) continue
      if (m / dt > 40 / 3.6) continue      // faster than 40 km/h is a bus, a train or a plane
      d += m
    }
    best = Math.max(best, d)
  }
  return best / 1000
}

function agoLabel(d) {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

const lineOf = coords => ({
  type: 'Feature', properties: {},
  geometry: { type: 'LineString', coordinates: coords },
})

export { agoLabel, coordinateLabel, lineOf, metres, routeKm, trailKm, validLngLat }



