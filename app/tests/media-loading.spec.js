import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
})

/* One indicator for the whole screen says "loading" long after most of the
   grid has drawn, and says nothing about the one tile still coming. Each
   picture arrives on its own, so each picture waits on its own. */
test('every picture that is still coming says so, on its own tile', async ({ page }) => {
  // Hold the photographs, so the loading state is observable at all.
  await page.route('**/*.{jpg,jpeg,png,webp}', async route => {
    await new Promise(resolve => setTimeout(resolve, 2500))
    await route.abort()
  })
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await page.getByRole('button', { name: 'Photos', exact: true }).click()

  const tiles = page.locator('.pgrid-photo img.im')
  await expect(tiles.first()).toBeVisible()
  const states = await tiles.evaluateAll(images =>
    images.map(image => ({
      ready: image.classList.contains('rdy'),
      animation: getComputedStyle(image).animationName,
      opacity: Number(getComputedStyle(image).opacity),
    })),
  )

  const waiting = states.filter(state => !state.ready)
  expect(waiting.length).toBeGreaterThan(0)
  for (const tile of waiting) {
    expect(tile.animation).toBe('media-loading')
    /* It used to be opacity 0 while loading — invisible, so there was
       nothing to see and no way to tell a slow tile from an empty one. */
    expect(tile.opacity).toBeGreaterThan(0)
  }
})
