import { test, expect } from '@playwright/test'
import { atDemoTime } from './demo-clock'
import { serveWikipedia } from './wikipedia-fixture.js'

/* Tapping a sight — reported twice from the road as "you can't click
   attractions", and untested until it was.

   The suite had a test called "attractions are drawn across the map and open
   into a card" which counted what the source was holding and never tapped a
   single dot. So the drawing was covered and the opening was not, which is
   the half that was broken.

   These go through the pixels: find a dot, check nothing is sitting on top of
   it, click there, and expect the card. */

const MAP_READY = 9000

test.beforeEach(async ({ page }) => {
  await serveWikipedia(page)
})

async function open(page) {
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await expect(page.locator('.mstop')).toHaveCount(8)
  const follow = page.locator('.wc.on') // stop the camera drifting under us
  if (await follow.count()) {
    await follow.click()
    await expect(follow).toHaveCount(0)
  }
  await page.evaluate(() => window.__offwegoMap?.stop())
  await page.waitForTimeout(1100)
  await page.evaluate(() => window.__offwegoMap?.stop())
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
}

/** How many sights the layer is holding. Drawn by the GPU: nothing in the DOM. */
const drawn = page =>
  page.evaluate(
    () => window.__offwegoMap?.getSource('attr')?.serialize?.().data?.features?.length ?? 0,
  )

/* A pixel that is a sight and has nothing on top of it. elementFromPoint is
   the honest test of reachability — whatever is topmost there is what a tap
   lands on — and the demo's sights ARE the demo's stops, so a dot's own centre
   is under its pin. The tap target is a fingertip wide, so a pixel just off
   the pin is still that sight, which is what the ring searches for. */
async function sightPoint(page) {
  const box = await page.locator('.mapcanvas').boundingBox()
  const spot = await page.evaluate(({ x, y, width, height }) => {
    const map = window.__offwegoMap
    const data = map?.getSource('attr')?.serialize?.().data
    const ring = []
    for (let radius = 4; radius <= 13; radius += 3)
      for (let step = 0; step < 16; step++)
        ring.push([
          Math.round(radius * Math.cos((step * Math.PI) / 8)),
          Math.round(radius * Math.sin((step * Math.PI) / 8)),
        ])
    const covered = []
    for (const feature of data?.features || []) {
      if (feature.geometry?.type !== 'Point') continue
      const at = map.project(feature.geometry.coordinates)
      if (at.x < 30 || at.y < 30 || at.x > width - 30 || at.y > height - 30) continue
      for (const [dx, dy] of [[0, 0], ...ring]) {
        const px = Math.round(x + at.x + dx)
        const py = Math.round(y + at.y + dy)
        if (document.elementFromPoint(px, py)?.tagName === 'CANVAS')
          return { x: px, y: py, name: feature.properties?.n }
      }
      covered.push(feature.properties?.n)
    }
    return { covered, count: (data?.features || []).length }
  }, box)
  if (!spot?.x) throw new Error('no sight can be reached: ' + JSON.stringify(spot))
  return spot
}

test('a sight opens its card, and still does after a stop card has been opened', async ({
  page,
}) => {
  await open(page)
  await expect.poll(() => drawn(page), { timeout: 30000 }).toBeGreaterThan(0)

  const cold = await sightPoint(page)
  await page.mouse.click(cold.x, cold.y)
  await expect(page.locator('.acard')).toBeVisible({ timeout: 5000 })
  await page.locator('.acard .ax').click()
  await expect(page.locator('.acard')).toHaveCount(0)

  // An itinerary item, opened and closed — the sequence it was reported in.
  const pins = page.locator('.mstop')
  const size = page.viewportSize()
  let pin = null
  for (let i = 0; i < (await pins.count()); i++) {
    const at = await pins.nth(i).boundingBox()
    if (at && at.x > 0 && at.y > 0 && at.x < size.width && at.y < size.height) {
      pin = pins.nth(i)
      break
    }
  }
  if (!pin) throw new Error('no stop pin on screen to open')
  await pin.click()
  await expect(page.locator('.detailcard')).toBeVisible({ timeout: 5000 })
  await page.locator('.detailcard').getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.detailcard')).toHaveCount(0)

  const again = await sightPoint(page)
  await page.mouse.click(again.x, again.y)
  await expect(page.locator('.acard')).toBeVisible({ timeout: 5000 })
})

test('the sights survive a change of map theme', async ({ page }) => {
  /* The reported bug. setStyle replaces the whole style document, so every
     source added to it goes with it — and the sights were the one source put
     back empty. Nothing refilled it but the next screenful of results, which
     on a map nobody has panned since is never. Turn on the night map and
     every sight on screen vanishes; a sight that is not drawn is a sight that
     cannot be tapped, because queryRenderedFeatures answers about what is
     rendered. */
  await open(page)
  await expect.poll(() => drawn(page), { timeout: 30000 }).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('menuitem', { name: /Night map|Day map/ }).click()
  await expect.poll(() => drawn(page), { timeout: 15000 }).toBeGreaterThan(0)

  const spot = await sightPoint(page)
  await page.mouse.click(spot.x, spot.y)
  await expect(page.locator('.acard')).toBeVisible({ timeout: 5000 })
})
