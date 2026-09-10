/* OpenFreeMap, served from here.
 *
 * The offline tests are about what this app keeps on the device, and they were
 * proving it by pulling real tiles off a free basemap service every run — a
 * few hundred of them, from a project with no funding, for a test that does
 * not care what is drawn on them. On a machine without the open internet they
 * proved nothing at all and failed.
 *
 * Everything the style reaches for is answered here: the tile index, the tiles,
 * the glyphs and the sprite. An empty vector tile is a valid one — zero bytes
 * is a well-formed protobuf with no layers in it — so the map draws a blank
 * ground, which is exactly as much basemap as these assertions look at.
 *
 * Routed on the CONTEXT rather than the page, because the service worker is
 * the thing under test and its fetches never pass through a page route.
 */

const HOST = 'https://tiles.openfreemap.org'

const INDEX = {
  tilejson: '2.2.0',
  name: 'openmaptiles',
  format: 'pbf',
  tiles: [`${HOST}/planet/{z}/{x}/{y}.pbf`],
  minzoom: 0,
  maxzoom: 14,
  bounds: [-180, -85.0511, 180, 85.0511],
  vector_layers: [],
}

/* One transparent pixel, for the sprite sheet. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** Answer the whole basemap from this fixture, service worker included. */
export async function serveBasemap(context) {
  await context.route(`${HOST}/**`, route => {
    const path = new URL(route.request().url()).pathname

    // The tile index the style points at, which names where tiles live.
    if (path === '/planet' || path === '/planet/') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(INDEX) })
    }
    // A tile. Zero bytes is a valid vector tile holding no layers.
    if (path.startsWith('/planet/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/x-protobuf',
        headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' },
        body: '',
      })
    }
    // Glyphs. Also a protobuf, also allowed to be empty.
    if (path.startsWith('/fonts/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/x-protobuf',
        headers: { 'access-control-allow-origin': '*' },
        body: '',
      })
    }
    if (path.startsWith('/sprites/')) {
      return path.endsWith('.png')
        ? route.fulfill({ contentType: 'image/png', body: PIXEL })
        : route.fulfill({ contentType: 'application/json', body: '{}' })
    }
    return route.fulfill({ status: 404, body: '' })
  })
}
