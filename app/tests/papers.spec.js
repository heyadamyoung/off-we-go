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
  /* Either copy: the signed link, or the blob the offline pack already holds.
     Which one it found is not this test's business; that the bytes are a real
     PDF is. */
  const opened = await page.evaluate(async () => {
    const href = document.querySelector('.ppview .ppvfile a')?.getAttribute('href')
    if (!href) return 'no link'
    const answer = await fetch(href)
    return answer.ok ? (await answer.text()).slice(0, 8) : `status ${answer.status}`
  })
  expect(opened).toMatch(/^%PDF/)
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
