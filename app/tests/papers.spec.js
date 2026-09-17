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

test('a PDF is drawn on the screen, not handed to another tab', async ({ page }) => {
  /* This is the case the whole screen exists for and the one it used to fail:
     a ticket is very often a PDF, and what stood here was a black screen, the
     sentence "this one is a PDF — it opens in its own viewer", and the
     filename again as a link OUT of the app — into a tab with no offline copy
     of anything and no way back. */
  await openPapers(page)
  await page.locator('.pprow').first().click()
  const view = page.locator('.ppview')
  await expect(view).toBeVisible()

  const pages = view.locator('.ppvpdfpages canvas')
  await expect(pages.first()).toBeVisible({ timeout: 20000 })
  // Every page, stacked — the demo ticket has its conditions on the back.
  await expect(pages).toHaveCount(2, { timeout: 20000 })
  await expect(view.locator('.ppvfile'), 'still offering a way out of the app').toHaveCount(0)

  /* Filling the sheet rather than sitting in the middle of it as a thumbnail.
     How many device pixels that is per CSS pixel is pageScale's rule and is
     held to account in tests/paper-kind.test.js; a browser Playwright drives
     runs at a density of one, so it cannot be asked here. */
  const first = await pages.first().boundingBox()
  const sheet = await view.locator('.ppvpdfpages').boundingBox()
  expect(first.width).toBeCloseTo(sheet.width, 0)
  expect(first.height, 'a page with no height is a page nobody can read').toBeGreaterThan(300)
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

test('renaming a paper happens where you can see which paper it is', async ({ page }) => {
  /* The sheet this replaced was a column of identical text inputs: every row
     an editable name over an editable note, with the document itself behind a
     32px chevron. That is how a boarding pass ends up named after a hotel.
     The tidying is on the paper's own screen now, behind one control, with
     the thing being renamed still on it. */
  await openPapers(page)
  await page.locator('.pprow').first().click()
  const view = page.locator('.ppview')
  await expect(view).toBeVisible()

  await expect(view.getByLabel('Document name')).toHaveCount(0)
  await view.getByRole('button', { name: 'Rename, note or remove' }).click()
  await expect(view.getByLabel('Document name')).toHaveValue('Timed entry ticket')
  await expect(view.getByLabel('Document note')).toBeVisible()
})

test('the tidying is a toggle, so the paper is what the screen is by default', async ({ page }) => {
  /* Open on the inputs and this is the filing cabinet again, wearing a
     different shape. */
  await openPapers(page)
  await page.locator('.pprow').first().click()
  const view = page.locator('.ppview')
  const pencil = view.getByRole('button', { name: 'Rename, note or remove' })
  await pencil.click()
  await expect(view.getByLabel('Document name')).toBeVisible()
  await pencil.click()
  await expect(view.getByLabel('Document name')).toHaveCount(0)
})

test('a pass that is a picture is drawn on white, whatever the theme is', async ({ page }) => {
  /* The one rule on this screen with a consequence. What is being shown is
     very often a barcode, and a scanner reading a dark-themed page through a
     phone's glass is a scanner that beeps twice and a queue that does not
     move — so the app's own theme, right everywhere else, is wrong here. */
  await openPapers(page)
  await page.locator('.pprow').filter({ hasText: 'Boarding pass — Maya' }).click()
  const sheet = page.locator('.ppview .ppvpaper')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('img')).toBeVisible()
  expect(await sheet.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  )
})

test('the paper covers the screen rather than floating over the trip', async ({ page }) => {
  /* It shipped transparent. Every rule on .ppview worked — fixed, inset 0, the
     bar, the centred handover — except its background, which named a property
     nobody declares: var(--c-canvas) is the Tailwind utility's name, and the
     property is --c-bg. An unresolvable var() takes the whole declaration with
     it and says nothing, so a boarding pass was drawn over a live map with the
     trip's own title showing through the top of it. */
  await openPapers(page)
  await page.locator('.pprow').first().click()
  const view = page.locator('.ppview')
  await expect(view).toBeVisible()

  const paint = await view.evaluate(node => getComputedStyle(node).backgroundColor)
  expect(paint, 'you can read the trip through the document').not.toMatch(/transparent|,\s*0\)$/)

  const box = await view.boundingBox()
  const screen = page.viewportSize()
  expect(box.height, 'a band at the top of a screen is not a screen').toBeGreaterThanOrEqual(
    screen.height - 1,
  )
  expect(box.width).toBeGreaterThanOrEqual(screen.width - 1)
})
