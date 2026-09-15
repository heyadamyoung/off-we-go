import { test, expect } from '@playwright/test'
import { atDemoTime } from './demo-clock'

/* Swiping the full-screen photograph.
 *
 * Reported from the road: "I want the same swipe mechanism as the normal view
 * in the zoomed view, where the picture moves around. It's too mechanical
 * right now."
 *
 * It was mechanical in a precise way. The viewer behind this draws three
 * photographs side by side and moves the strip under the finger; the
 * full-screen view drew one, ignored the finger entirely while it was down,
 * and swapped the picture when it lifted. So the gesture had no answer until
 * it was over, and then the answer was a jump.
 *
 * These go through the pixels: press, move, and ask where the photograph
 * actually is before letting go.
 */

const MAP_READY = 9000
const PHONE = { width: 390, height: 844 }

test.beforeEach(async ({ page }) => {
  await page.route('https://en.wikipedia.org/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
    }),
  )
})

async function openZoom(page) {
  await page.setViewportSize(PHONE)
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.evaluate(() => window.__offwegoMap?.stop())
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.locator('.pgrid-photo').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })
  await page.locator('.vpane.on .vmaintap').click()
  await expect(page.locator('.vzstage')).toBeVisible({ timeout: 8000 })
  /* Laid out before its position means anything. Its BOX rather than its
     bytes: the demo's photographs are fetched from the open internet, and a
     test that only passes on a machine with that is a test with a permanently
     red corner. Where the picture sits on the screen is the question here, and
     that is answered whether or not the pixels arrived. */
  await expect.poll(() => middle(page).then(it => it?.width ?? 0)).toBeGreaterThan(0)
}

/* The photograph being looked at: how wide it is laid out, how far its middle
   sits from the middle of the stage, and the transform it carries.
 *
 * Asked of whatever is on the stage rather than of a class this change
 * introduced, so it is a question about the picture and not about the markup —
 * which is what lets it be run against the version before the change and go
 * red for the right reason. The one nearest the middle is the one being looked
 * at: at rest it is centred, and mid-drag it is still it, further away, with
 * its neighbours a whole stage width further out again. */
const middle = page =>
  page.evaluate(() => {
    const stage = document.querySelector('.vzstage')?.getBoundingClientRect()
    if (!stage) return null
    const mid = stage.x + stage.width / 2
    let nearest = null
    for (const image of document.querySelectorAll('.vzstage img')) {
      const box = image.getBoundingClientRect()
      if (!box.width) continue
      const off = box.x + box.width / 2 - mid
      if (!nearest || Math.abs(off) < Math.abs(nearest.off))
        nearest = { off, width: box.width, transform: getComputedStyle(image).transform }
    }
    return nearest
  })

/** How far that photograph has been carried from the middle, in pixels. */
const carriedBy = page => middle(page).then(it => Math.abs(it?.off ?? 0))

/** The viewer's own counter, behind the full-screen picture. */
const counter = page => page.locator('.vcap .ct').innerText()

test('the photograph follows the finger, and comes back when the swipe is taken back', async ({
  page,
}) => {
  await openZoom(page)
  const before = await counter(page)
  expect(await carriedBy(page)).toBeLessThan(2)

  const stage = await page.locator('.vzstage').boundingBox()
  const y = stage.y + stage.height / 2
  const from = stage.x + stage.width * 0.8

  /* Paced, because that is what separates a drag from a flick — Playwright's
     moves land back to back, and a finger that covered this ground in no time
     at all is a finger plainly going somewhere. 110 pixels of a 390 stage,
     slowly: well short of the 195 a deliberate carry asks for here. */
  await page.mouse.move(from, y)
  await page.mouse.down()
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(from - (110 * step) / 6, y)
    await page.waitForTimeout(80)
  }

  expect(
    await carriedBy(page),
    'the photograph did not move under the finger — the swipe says nothing until it is over',
  ).toBeGreaterThan(stage.width * 0.15)

  await page.mouse.up()
  // Short of half, so it comes home rather than turning the page.
  await expect.poll(() => carriedBy(page)).toBeLessThan(2)
  expect(await counter(page)).toBe(before)
  await expect(page.locator('.vzoom')).toBeVisible()
})

test('a swipe carried across turns the page and stays full screen', async ({ page }) => {
  await openZoom(page)
  const before = await counter(page)

  const stage = await page.locator('.vzstage').boundingBox()
  const y = stage.y + stage.height / 2
  const from = stage.x + stage.width * 0.9
  await page.mouse.move(from, y)
  await page.mouse.down()
  await page.mouse.move(from - stage.width * 0.75, y, { steps: 16 })
  await page.mouse.up()

  await expect.poll(() => counter(page)).not.toBe(before)
  // And it is still the full-screen view: a page turn is not a way out of it.
  await expect(page.locator('.vzoom')).toBeVisible()
  // Settled back in the middle, not parked where the finger left it.
  await expect.poll(() => carriedBy(page)).toBeLessThan(2)
})

test('a drag on a zoomed picture moves the picture, and never turns the page', async ({ page }) => {
  /* The rule that lets the two gestures live on one surface: reaching the
     right-hand edge of something you are reading is not a request to leave
     it. */
  await openZoom(page)
  const before = await counter(page)

  const scale = async () => {
    const t = (await middle(page))?.transform
    return !t || t === 'none' ? 1 : Number(t.match(/matrix\(([-\d.]+)/)?.[1] ?? 1)
  }
  await page.locator('.vzstage').dblclick()
  await expect.poll(scale).toBeGreaterThan(1.5)

  const stage = await page.locator('.vzstage').boundingBox()
  const y = stage.y + stage.height / 2
  const from = stage.x + stage.width * 0.9
  await page.mouse.move(from, y)
  await page.mouse.down()
  await page.mouse.move(from - stage.width * 0.75, y, { steps: 16 })
  await page.mouse.up()

  await page.waitForTimeout(500)
  expect(await counter(page), 'a pan turned the page').toBe(before)
  await expect(page.locator('.vzoom')).toBeVisible()
})
