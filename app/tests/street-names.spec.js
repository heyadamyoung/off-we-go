import { test, expect } from './fixture.js'
import { atDemoTime } from './demo-clock'

/* The map's own words.

   Reported as wanting to see the road names: the roads were drawn and none of
   them were named, because CARTO starts its street labels at a zoom well past
   the one a day-on-one-screen sits at. And a switch beside it, because a city
   at full detail is a mat of text over the itinerary.

   Read off the style document rather than off the pixels: the labels are
   painted by the GPU from vector tiles, so what is in the DOM is nothing at
   all, and what the test can actually hold the app to is the layer's own
   visibility and the zoom it begins at. */

const MAP_READY = 9000

async function open(page) {
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await expect(page.locator('.mstop')).toHaveCount(8)
}

/** Every street-name layer, as the style currently holds it. */
const roadNames = page =>
  page.evaluate(() => {
    const map = window.__offwegoMap
    const ids = ['roadname_major', 'roadname_pri', 'roadname_sec', 'roadname_minor']
    return ids.map(id => {
      const layer = map?.getLayer(id)
      return {
        id,
        there: !!layer,
        minzoom: layer?.minzoom ?? null,
        visibility: map?.getLayoutProperty(id, 'visibility') ?? 'visible',
      }
    })
  })

const tool = (page, name) =>
  page
    .getByRole('button', { name: 'More tools' })
    .click()
    .then(() => page.getByRole('menuitem', { name }).click())

test('the map names its roads at the zoom a trip is looked at', async ({ page }) => {
  await open(page)

  await expect.poll(async () => (await roadNames(page)).every(l => l.there)).toBe(true)
  const named = await roadNames(page)
  assertShown(named)
  const major = named.find(layer => layer.id === 'roadname_major')
  expect(major.minzoom).toBeLessThanOrEqual(11)
})

test('street names can be put away when the map gets too busy, and come back', async ({ page }) => {
  await open(page)
  await expect.poll(async () => (await roadNames(page)).every(l => l.there)).toBe(true)

  await tool(page, 'Hide street names')
  await expect
    .poll(async () => (await roadNames(page)).map(l => l.visibility))
    .toEqual(['none', 'none', 'none', 'none'])

  await tool(page, 'Show street names')
  await expect
    .poll(async () => (await roadNames(page)).map(l => l.visibility))
    .toEqual(['visible', 'visible', 'visible', 'visible'])
})

test('the choice survives a change of map theme, which throws the style away', async ({ page }) => {
  /* setStyle replaces the whole document, so anything done to a layer goes
     with it — the same way the sights did. */
  await open(page)
  await expect.poll(async () => (await roadNames(page)).every(l => l.there)).toBe(true)
  await tool(page, 'Hide street names')
  await expect.poll(async () => (await roadNames(page))[0].visibility).toBe('none')

  await tool(page, /Night map|Day map/)
  await expect.poll(async () => (await roadNames(page)).every(l => l.there)).toBe(true)
  await expect
    .poll(async () => (await roadNames(page)).map(l => l.visibility))
    .toEqual(['none', 'none', 'none', 'none'])
})

function assertShown(layers) {
  for (const layer of layers) {
    expect(layer.there, `${layer.id} is in the style`).toBe(true)
    expect(layer.visibility, `${layer.id} is drawn`).toBe('visible')
  }
}
