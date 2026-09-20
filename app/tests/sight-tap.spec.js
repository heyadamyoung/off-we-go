import assert from 'node:assert/strict'
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

/* Reported from the road, looking at a city: "ours is just a cluster fuck of
   dots ... we need to only show points of interest like landmarks, museums
   etc when zoomed out further and you have to zoom in more to see other shit".
 *
 * It was one bit per place — `big` — and above zoom 11 everything drew, so a
 * whole city arrived as three hundred identical dots at once. Each place now
 * earns a zoom from its category and from how sure we are of the record.
 *
 * Asserted by camera rather than by counting: moving the camera changes the
 * viewport, which refetches the pins, so two counts taken at two zooms are
 * not two measurements of the same thing. Putting one café in the middle of
 * the screen and asking whether it is drawn is. */
async function centreOn(page, [lng, lat], zoom) {
  await page.evaluate(({ at, z }) => window.__offwegoMap?.jumpTo({ center: at, zoom: z }), {
    at: [lng, lat],
    z: zoom,
  })
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
}

/** The names actually painted right now — not what the source is holding. */
const paintedNames = page =>
  page.evaluate(() =>
    (window.__offwegoMap?.queryRenderedFeatures({ layers: ['attr-dot'] }) || []).map(
      feature => feature.properties?.n,
    ),
  )

test('a museum is visible across the city; a cafe waits until you are in its street', async ({
  page,
}) => {
  await open(page)
  await expect.poll(() => drawn(page), { timeout: 30000 }).toBeGreaterThan(0)

  // The sample's café, in the middle of the screen, from across the city.
  const cafe = [4.8828, 52.3799]
  await centreOn(page, cafe, 12.5)
  await expect.poll(() => paintedNames(page), { timeout: 15000 }).not.toContain('Winkel 43')

  // The same café, from its own street.
  await centreOn(page, cafe, 17)
  await expect.poll(() => paintedNames(page), { timeout: 15000 }).toContain('Winkel 43')

  // And the museum is there at both — that is what "across the city" means.
  const museum = [4.8852, 52.36]
  await centreOn(page, museum, 12.5)
  await expect.poll(() => paintedNames(page), { timeout: 15000 }).toContain('Rijksmuseum')
})

/* Colour is the other half of the same report. Every dot used to be the same
   grey, so a street with three cafés and a museum on it looked like four of
   the same thing. */
test('the dots are coloured by what the place is', async ({ page }) => {
  await open(page)
  await expect.poll(() => drawn(page), { timeout: 30000 }).toBeGreaterThan(0)
  await centreOn(page, [4.8852, 52.36], 17)

  const colour = await page.evaluate(() =>
    window.__offwegoMap?.getPaintProperty('attr-dot', 'circle-color'),
  )
  assert(Array.isArray(colour), 'the colour is an expression over the feature, not one flat value')
  assert.equal(colour[0], 'match')
  assert.deepEqual(colour[1], ['get', 'k'])
})

/* What the card says once it is open.
 *
 * Reported from the road: "I want to see the address on the cards from the
 * map pins. You don't see them now." They were not there because the card was
 * still the one written for Wikipedia pins — it read `poi.d`, which the places
 * layer leaves empty, and asked Wikipedia about an id that is now one of our
 * uuids. A pin carries a name, a position and a category and nothing else, by
 * design; everything on this card beyond the name comes from the record the
 * tap goes and fetches. */
test('a tapped pin says what the place is and where it is', async ({ page }) => {
  await open(page)
  await expect.poll(() => drawn(page), { timeout: 30000 }).toBeGreaterThan(0)
  await tapSight(page)

  const card = page.locator('.acard')
  // What it is, from the category the pin already carried.
  await expect(card.locator('.kind')).not.toBeEmpty()
  // Where it is, which can only have come from the record behind the pin.
  await expect(card.locator('.awhere')).toContainText('Amsterdam', { timeout: 5000 })
  /* And no dead link to somebody else's site. Every card used to carry a
     button labelled Wikipedia pointing at ?curid=<a uuid of ours>. */
  await expect(card.getByRole('link', { name: 'Wikipedia' })).toHaveCount(0)
})

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
