import { expect, test } from '@playwright/test'
import { atDemoTime } from './demo-clock'

/* Everything you are carrying, in one place.
 *
 * The documents were always there. What was missing was anywhere in this app
 * that meant "your documents": every paper hung off the stop or the leg it
 * belonged to, so producing a boarding pass at a desk meant remembering which
 * leg you had filed it on and then five taps. On a real trip that lost to
 * searching an email, every time.
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

async function openPapers(page) {
  await page.setViewportSize(PHONE)
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.evaluate(() => window.__offwegoMap?.stop())
  await page.getByRole('button', { name: 'Papers', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Papers' })).toBeVisible()
}

test('the trip has a place that means "your documents"', async ({ page }) => {
  await openPapers(page)
  const rows = page.locator('.pprow')
  /* A pile, not a folder. Four papers across two stops and a flight, which is
     an ordinary family's worth and the whole reason this screen exists. */
  expect(await rows.count()).toBeGreaterThanOrEqual(4)
  await expect(rows.first()).toContainText('Timed entry ticket')
})

test('the next thing leads and what is finished sinks', async ({ page }) => {
  /* The order is the feature: at a desk the paper you want is almost always
     for the thing about to happen. */
  await openPapers(page)
  const names = await page.locator('.pprow .ppbody b').allInnerTexts()
  expect(names[0]).toBe('Timed entry ticket')
  expect(names.at(-1), 'yesterday’s hotel booking belongs at the bottom').toBe('Hotel booking')
})

test('the boarding passes sit together, one per traveller', async ({ page }) => {
  await openPapers(page)
  const passes = page.locator('.pprow').filter({ hasText: 'Boarding pass' })
  await expect(passes).toHaveCount(2)
  await expect(passes.first().locator('.ppfor')).toHaveText(/KL 677/)
})

test('a paper says what it is for, without being opened', async ({ page }) => {
  await openPapers(page)
  await expect(page.locator('.pprow').first().locator('.ppfor')).toHaveText('Anne Frank House')
})

test('the whole row opens the document, not a chevron in the corner', async ({ page }) => {
  /* The sheet this replaces put an editable name, an editable note and a
     hold-to-delete on top of a 32px chevron. At a desk the document IS the
     interface. */
  await openPapers(page)
  const row = page.locator('.pprow').first()
  const box = await row.boundingBox()
  expect(box.height, 'the tap target is too small to hit in a hurry').toBeGreaterThan(44)
  // Tapped well away from any corner control.
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height / 2)
  await expect(page.locator('.ppview')).toBeVisible()
})

test('a PDF is handed over rather than pretended at', async ({ page }) => {
  /* Drawing one needs a renderer this app does not carry, and a grey box with
     a spinner would be worse than the browser's own viewer. */
  await openPapers(page)
  await page.locator('.pprow').first().click()
  const view = page.locator('.ppview')
  await expect(view).toBeVisible()
  await expect(view.locator('.ppvfile a')).toHaveAttribute('href', /\.pdf$/)
})

test('the paper closes and leaves the trip where it was', async ({ page }) => {
  await openPapers(page)
  const before = page.url()
  await page.locator('.pprow').first().click()
  await expect(page.locator('.ppview')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ppview')).toHaveCount(0)
  expect(page.url(), 'holding up a document is not a place you navigated to').toBe(before)
})
