/* Strava-style privacy for the place everyone sleeps.

   A trip's history is served only to its members — but the trail still traces
   loops around the traveller's own front door, and the day public sharing
   ships that becomes a doxxing machine. So the zone is enforced here, at the
   server, where the coordinates actually leave the building: history points
   within the radius of a device owner's saved home are simply never sent.
   Client-side hiding would be theatre — the payload would still carry them.

   The latest fix per device is exempt: live presence keeps working while
   someone is at home, and members already know where home is. Revisit that
   exemption before any anonymous share link exists. */

export const HOME_ZONE_RADIUS_METRES = 250

const EARTH_RADIUS_METRES = 6_371_000
const rad = value => (value * Math.PI) / 180

export function distanceMetres(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(h))
}

/**
 * @param fixes rows with { deviceId, lng, lat, id }
 * @param homeByDevice Map of deviceId -> { lat, lng } (owner's saved home), or null-ish entries
 */
export function maskHomeZones(
  fixes,
  homeByDevice,
  { radiusMetres = HOME_ZONE_RADIUS_METRES } = {},
) {
  if (!fixes?.length || !homeByDevice?.size) return fixes || []
  const latest = new Map()
  for (const fix of fixes) {
    const seen = latest.get(fix.deviceId)
    if (!seen || (fix.id ?? 0) > (seen.id ?? 0)) latest.set(fix.deviceId, fix)
  }
  return fixes.filter(fix => {
    const home = homeByDevice.get(fix.deviceId)
    if (!home || home.lat == null || home.lng == null) return true
    if (latest.get(fix.deviceId) === fix) return true
    return distanceMetres(fix, home) > radiusMetres
  })
}
