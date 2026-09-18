import { test, expect } from './fixture.js'

/* This one is about the cartography, so it draws the real style. */
test.use({ mapStyle: 'real' })
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
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
}

/** How many sights the layer is holding. Drawn by the GPU: nothing in the DOM. */
const drawn = page =>
  page.evaluate(
    () => window.__offwegoMap?.getSource('attr')?.serialize?.().data?.features?.length ?? 0,
  )

/* The camera at rest. Opening and closing a card gives the map back the room
   the card was holding, which starts an ease — and a dot projected while that
   is running is a dot at a pixel it has already left. */
async function settled(page) {
  let last = null
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => {
          const map = window.__offwegoMap
          if (!map || map.isMoving()) return null
          const at = map.getCenter()
          return `${at.lng.toFixed(5)},${at.lat.toFixed(5)},${map.getZoom().toFixed(3)}`
        })
        const still = !!now && now === last
        last = now
        return still
      },
      { timeout: 15000 },
    )
    .toBe(true)
}

/* A pixel that is a sight and has nothing on top of it.

   Two questions, and both have to be yes. elementFromPoint is the honest test
   of reachability — whatever is topmost there is what a tap lands on — and
   the demo's sights ARE the demo's stops, so a dot's own centre is under its
   pin; the tap target is a fingertip wide, which is what the ring searches.
   Then the map itself is asked, with the same padded query the app's own tap
   handler uses, because a sight that is in the source but not yet painted is
   one queryRenderedFeatures will not answer for — which is a real window of a
   frame or two after a style swap.

   Null rather than a throw, so a caller can poll it. */
async function findSight(page) {
  const box = await page.locator('.mapcanvas').boundingBox()
  return page.evaluate(({ x, y, width, height }) => {
    const map = window.__offwegoMap
    const data = map?.getSource('attr')?.serialize?.().data
    const ring = []
    for (let radius = 4; radius <= 13; radius += 3)
      for (let step = 0; step < 16; step++)
        ring.push([
          Math.round(radius * Math.cos((step * Math.PI) / 8)),
          Math.round(radius * Math.sin((step * Math.PI) / 8)),
        ])
    for (const feature of data?.features || []) {
      if (feature.geometry?.type !== 'Point') continue
      const at = map.project(feature.geometry.coordinates)
      if (at.x < 30 || at.y < 30 || at.x > width - 30 || at.y > height - 30) continue
      for (const [dx, dy] of [[0, 0], ...ring]) {
        const cx = at.x + dx
        const cy = at.y + dy
        if (document.elementFromPoint(Math.round(x + cx), Math.round(y + cy))?.tagName !== 'CANVAS')
          continue
        const painted = map.queryRenderedFeatures(
          [
            [cx - 14, cy - 14],
            [cx + 14, cy + 14],
          ],
          { layers: ['attr-dot'] },
        )
        if (painted.length)
          return { x: Math.round(x + cx), y: Math.round(y + cy), name: feature.properties?.n }
      }
    }
    return null
  }, box)
}

/** The same, waited for: a style swap repaints, and a repaint takes a frame. */
async function sightPoint(page) {
  let spot = null
  await expect
    .poll(
      async () => {
        spot = await findSight(page)
        return !!spot
      },
      { timeout: 15000 },
    )
    .toBe(true)
  return spot
}

/* Tap a sight and get its card. Retried, because the only thing that can go
   wrong between choosing a pixel and clicking it is the camera moving under
   the test — the app has no second chance to give. A sight that genuinely
   does not open fails every attempt and the test still goes red. */
async function tapSight(page) {
  await settled(page)
  for (let attempt = 0; attempt < 3; attempt++) {
    const spot = await sightPoint(page)
    await page.mouse.click(spot.x, spot.y)
    const opened = await page
      .locator('.acard')
      .waitFor({ timeout: 2500 })
      .then(
        () => true,
        () => false,
      )
    if (opened) return
    await settled(page)
  }
  await expect(page.locator('.acard')).toBeVisible({ timeout: 5000 })
}

/* A stop's pin at a pixel where it is genuinely the topmost thing. Pins
   overlap in a city, and a click on one that another is sitting over is a
   click the browser gives to the other one. */
async function pinPoint(page) {
  const spot = await page.evaluate(() => {
    for (const pin of document.querySelectorAll('.mstop')) {
      const at = pin.getBoundingClientRect()
      for (const [fx, fy] of [
        [0.5, 0.5],
        [0.5, 0.35],
        [0.35, 0.5],
        [0.65, 0.5],
      ]) {
        const x = Math.round(at.x + at.width * fx)
        const y = Math.round(at.y + at.height * fy)
        if (x < 4 || y < 4 || x > innerWidth - 4 || y > innerHeight - 4) continue
        if (pin.contains(document.elementFromPoint(x, y))) return { x, y }
      }
    }
    return null
  })
  if (!spot) throw new Error('no stop pin can be reached')
  return spot
}

test('a sight opens its card, and still does after a stop card has been opened', async ({
  page,
}) => {
  await open(page)
  await expect.poll(() => drawn(page), { timeout: 30000 }).toBeGreaterThan(0)

  await tapSight(page)
  await page.locator('.acard .ax').click()
  await expect(page.locator('.acard')).toHaveCount(0)

  // An itinerary item, opened and closed — the sequence it was reported in.
  const pin = await pinPoint(page)
  await page.mouse.click(pin.x, pin.y)
  await expect(page.locator('.detailcard')).toBeVisible({ timeout: 5000 })
  await page.locator('.detailcard').getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.detailcard')).toHaveCount(0)

  await tapSight(page)
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

  await tapSight(page)
})

test('a sight opens its card after the itinerary has been edited, rather than making a stop', async ({
  page,
}) => {
  /* The reported sequence, exactly: open an itinerary item on the map, press
     Edit, close the editor, then tap a sight. Editing stays on after the
     editor closes — it is a mode, not a dialogue — and a tap on the bare
     canvas while it is on means "put a stop here". A sight is not bare
     canvas. */
  await open(page)
  await expect.poll(() => drawn(page), { timeout: 30000 }).toBeGreaterThan(0)

  const pin = await pinPoint(page)
  await page.mouse.click(pin.x, pin.y)
  await expect(page.locator('.detailcard')).toBeVisible({ timeout: 5000 })
  await page.locator('.detailcard').getByTitle('Edit this stop').click()
  await expect(page.locator('.editor')).toBeVisible()
  await page.locator('.editor').getByTitle('Close').click()
  await expect(page.locator('.editor')).toHaveCount(0)

  await tapSight(page)
  await expect(page.locator('.editor')).toHaveCount(0)
})
