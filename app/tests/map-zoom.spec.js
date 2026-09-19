import { test, expect } from './fixture.js'
import { atDemoTime } from './demo-clock'

/* The map's zoom, felt: it goes out as far as Google Maps does — the whole
   world — a notch of the wheel is most of a level, eased, rather than a
   fifth of one, and the tiles are drawn at no more than two device pixels
   per CSS pixel, which is what keeps a pinch on a phone at the frame rate. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
})

const open = async page => {
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
}

test('the map zooms out to the whole world', async ({ page }) => {
  await open(page)
  expect(await page.evaluate(() => window.__offwegoMap.getMinZoom())).toBeLessThanOrEqual(1)
  await page.evaluate(() => window.__offwegoMap.jumpTo({ zoom: 0 }))
  const zoom = await page.evaluate(() => window.__offwegoMap.getZoom())
  expect(zoom).toBeLessThanOrEqual(1)
  /* And back in: the whole range is there. */
  await page.evaluate(() => window.__offwegoMap.jumpTo({ zoom: 18 }))
  expect(await page.evaluate(() => window.__offwegoMap.getZoom())).toBe(18)
})

test('a notch of the wheel is most of a level, and it settles on its own', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__offwegoMap.jumpTo({ center: [4.9, 52.37], zoom: 10 }))
  const canvas = await page.locator('.mapcanvas canvas').boundingBox()
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.mouse.wheel(0, -100)
  await expect
    .poll(() => page.evaluate(() => window.__offwegoMap.getZoom()), { timeout: 4000 })
    .toBeGreaterThan(10.6)
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap.isMoving())).toBe(true)
  const zoom = await page.evaluate(() => window.__offwegoMap.getZoom())
  expect(zoom).toBeLessThan(11.5)
  await page.mouse.wheel(0, 100)
  await expect
    .poll(() => page.evaluate(() => window.__offwegoMap.getZoom()), { timeout: 4000 })
    .toBeLessThan(zoom - 0.6)
})

test('the tiles are drawn at no more than two device pixels per CSS pixel', async ({ page }) => {
  await open(page)
  expect(await page.evaluate(() => window.__offwegoMap.getPixelRatio())).toBeLessThanOrEqual(2)
})
