/* The ground we watch, and the one list of it.
 *
 * Two things ask "is the places layer alright": a probe on a runner, which
 * can only reach what is public over HTTPS, and a script inside the box,
 * which can reach the database but not the internet. They were going to hold
 * a viewport list each, and two lists drift — the runner would be watching
 * Amsterdam while the box measured Toronto, and the first time the two
 * disagreed nobody would know whether the layer or the lists had.
 *
 * So the list is here, imported by both, and adding a city is one edit.
 *
 * Why these five. Two dense European cities, one prairie city, and the two
 * ends of the trip that is running right now — a layer that works in
 * Amsterdam and nowhere else is the failure this whole layer was built to
 * end. Edinburgh is on it because the map was panned to Scotland and found
 * nothing, and a standing viewport is the only kind that gets checked
 * without somebody remembering to.
 */
export const STANDING = Object.freeze([
  Object.freeze({ name: 'Amsterdam', west: 4.86, south: 52.35, east: 4.92, north: 52.39 }),
  Object.freeze({ name: 'Edinburgh', west: -3.21, south: 55.94, east: -3.17, north: 55.96 }),
  Object.freeze({ name: 'Regina', west: -104.65, south: 50.42, east: -104.55, north: 50.47 }),
  Object.freeze({ name: 'Toronto', west: -79.4, south: 43.64, east: -79.36, north: 43.66 }),
  Object.freeze({ name: 'Dublin', west: -6.28, south: 53.33, east: -6.24, north: 53.36 }),
])

/** Where somebody looking at a viewport is looking, which is what a point
    query — nearby, a tile, the coverage read — is asked about. */
export const centreOf = view => ({
  lng: (view.west + view.east) / 2,
  lat: (view.south + view.north) / 2,
})

/** The slippy tile a point falls in: the arithmetic a map does to decide
    which squares to ask for, so a probe built on it asks what a phone asks. */
export function tileFor(lng, lat, z) {
  const side = 2 ** z
  const radians = (lat * Math.PI) / 180
  return {
    z,
    x: Math.floor(((lng + 180) / 360) * side),
    y: Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * side),
  }
}
