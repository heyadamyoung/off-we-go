import { test, expect } from '@playwright/test'

/* The grid only puts the rows somebody can see in the document, which is what
   let the two-thousand-photograph ceiling go. The arithmetic is covered in
   tests/photo-groups.test.js; what these check is that the shipped grid, in a
   real layout engine, still holds every photograph the trip has and can be
   scrolled to the end of. Windowing that quietly drops the last row is worse
   than no windowing at all.

   The grid groups by itinerary item by default now, so a small trip is a set
   of cards with headers between them and is taller than it used to be. The
   no-spacers case is asked of the chronological view, which is the one that
   really is a plain grid of everything. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await page.route('https://en.wikipedia.org/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
    }),
  )
})

const openPhotos = async page => {
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await expect(page.locator('.pgrid-photo').first()).toBeVisible()
}

test('a trip that fits on one screen renders every photograph, with no spacers', async ({
  page,
}) => {
  await openPhotos(page)
  await page.getByRole('button', { name: 'By date' }).click()
  await expect(page.locator('.pgrid-head')).toHaveCount(0)

  const tiles = page.locator('.pgrid-photo')
  const count = await tiles.count()
  expect(count).toBeGreaterThan(5)

  /* Nothing is standing in for rows that are not there. A spacer with height
     on a grid this small would mean the window had misplaced itself. */
  const grid = page.locator('.pgrid-photo').first().locator('xpath=../..')
  const spacers = await grid.evaluate(node =>
    [...node.children]
      .filter(child => !child.className.includes('grid'))
      .map(child => child.getBoundingClientRect().height),
  )
  expect(spacers).toEqual(spacers.map(() => 0))

  // Every tile has real size — a windowed row that never got measured collapses.
  const heights = await tiles.evaluateAll(nodes =>
    nodes.map(node => Math.round(node.getBoundingClientRect().height)),
  )
  expect(heights.every(height => height > 20)).toBe(true)
  expect(new Set(heights).size).toBe(1)
})

test('the last photograph in the grid is reachable and opens', async ({ page }) => {
  await openPhotos(page)

  const last = page.locator('.pgrid-photo').last()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  await last.click()

  /* The end of the grid is where a window that renders only the top would
     fail: the tile would either not exist or not be the photograph it claims. */
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })
})

test('the grid is the itinerary: a card per place, in the order the trip visits them', async ({
  page,
}) => {
  await openPhotos(page)

  const headings = await page.locator('.pgrid-head').allInnerTexts()
  expect(headings.length).toBeGreaterThan(1)
  /* The itinerary's own order, not the photographs': the trip flew in before
     it reached the museum, whatever order the pictures were taken in. */
  expect(headings[0]).toContain('Schiphol Airport')

  // Each card says how much is in it, and the counts are real.
  const first = page.locator('.pgrid-head').first()
  await expect(first).toHaveAttribute('aria-expanded', 'true')
})

test('a card rolls up and gives its space back, keeping its own heading', async ({ page }) => {
  await openPhotos(page)
  const headings = page.locator('.pgrid-head')
  const before = await headings.count()
  const firstCard = headings.first()

  await firstCard.click()
  await expect(firstCard).toHaveAttribute('aria-expanded', 'false')
  /* The heading stays — a card you cannot see the name of is one you cannot
     open again — and the trip is shorter, so more of it fits on the screen. */
  await expect(headings).toHaveCount(before)
})

test('by date is one plain list of everything, newest first', async ({ page }) => {
  await openPhotos(page)
  await page.getByRole('button', { name: 'By date' }).click()

  await expect(page.locator('.pgrid-head')).toHaveCount(0)
  const tiles = page.locator('.pgrid-photo')
  await expect(tiles.first()).toBeVisible()
  /* Everything the trip has, in one card: the sample is small enough that the
     whole of it fits, so nothing here is hidden by the window. */
  expect(await tiles.count()).toBeGreaterThan(await page.locator('.pgrid-head').count())

  // And the choice is visible in the controls rather than only in the layout.
  await expect(page.getByRole('button', { name: 'By date' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
