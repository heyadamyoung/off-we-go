import { test, expect } from '@playwright/test'

/* The grid only puts the rows somebody can see in the document, which is what
   let the two-thousand-photograph ceiling go. The arithmetic is covered in
   tests/grid-window.test.js; what these check is that the shipped grid, in a
   real layout engine, still holds every photograph the trip has and can be
   scrolled to the end of. Windowing that quietly drops the last row is worse
   than no windowing at all. */

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
