import { test as base, expect } from '@playwright/test'
import { serveBasemap } from './basemap-fixture.js'

/* The suite's own world, sealed.
 *
 * A browser test that reaches the open internet is a test of the internet:
 * of a free tile server's afternoon, of a placeholder-image site's rate
 * limiter, of whether the machine running the suite has egress at all. On
 * the box this suite was profiled on, one page load asked outside hosts for
 * thirty-five things, and every one of them failed a second later; on a
 * runner with the internet they would each have downloaded, and drawn, and
 * cost real time in software rendering. Neither is what any test here is
 * about. So every context answers those requests itself: the basemap from
 * the fixture (empty tiles are valid tiles), Wikipedia with nothing nearby
 * unless a spec serves its own landmarks, every picture as one pixel, and
 * anything else off this machine refused at once rather than after a
 * timeout. A spec that wants a richer answer routes on its page, which is
 * matched before the context, as before.
 *
 * Motion is reduced for the same reason a lab is quiet: the pulsing dots
 * and halos are compositor animations, and in a headless browser the
 * compositor is software — an idle page was burning a core and a half at
 * sixty frames a second, which is why four workers on four cores left every
 * round trip a second behind. The stylesheet already honours the
 * preference; a test about an animation says so on its own page. */

/* The cartography is not under test. The real style is a fork of CARTO's
   dark matter — a hundred-odd layers, fonts and a sprite — and compiling it
   in a software GL context cost most of a core-second on every page a test
   opened. This one is a background and the water, on the same tile source,
   so the map still asks for tiles (the offline suite counts them) and the
   pins still have a map to sit on. A spec about the cartography itself asks
   for the real thing with `test.use({ mapStyle: 'real' })`. */
const TINY_STYLE = JSON.stringify({
  version: 8,
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0b0f14' } },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#0e1a26' },
    },
  ],
})

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const isLocal = url => {
  const { hostname } = new URL(url)
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** Seal a context: nothing leaves the machine, and what would have is answered here. */
export async function sealContext(context) {
  await context.route('**/*', route => {
    const request = route.request()
    const url = request.url()
    if (isLocal(url) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
    if (url.startsWith('https://en.wikipedia.org/')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ batchcomplete: '', query: { pages: {}, geosearch: [] } }),
      })
    }
    if (request.resourceType() === 'image' || /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(url)) {
      return route.fulfill({ contentType: 'image/png', body: PIXEL })
    }
    return route.abort('blockedbyclient')
  })
  // Registered after the catch-all, so it is matched first.
  await serveBasemap(context)
}

export const test = base.extend({
  /** 'tiny' (the default) or 'real': which basemap style the map is given. */
  mapStyle: ['tiny', { option: true }],
  context: async ({ context, mapStyle }, use) => {
    await sealContext(context)
    /* Every page holds still: the demo's live position is frozen where it
       loaded, the camera jumps rather than eases, and the home page draws
       no planet. The specs that open a trip set this themselves already. */
    await context.addInitScript(() => {
      window.__offwegoStill = true
    })
    if (mapStyle !== 'real') {
      await context.route('**/map-*.json', route =>
        route.fulfill({ contentType: 'application/json', body: TINY_STYLE }),
      )
    }
    await use(context)
  },
})

export { expect }
