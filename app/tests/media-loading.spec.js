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
  /* Hold the photographs, so the loading state is observable at all.

     The two hosts the sample's pictures come from, rather than every image on
     the page: the map's own sprites are .png too, and holding those long
     enough to be sure of this would be holding the map open instead. Long
     enough that a busy runner cannot close the window before the grid has
     drawn — an abort that lands first marks the tile finished, and there is
     then nothing left to observe. */
  for (const host of ['**loremflickr.com/**', '**picsum.photos/**']) {
    await page.route(host, async route => {
      await new Promise(resolve => setTimeout(resolve, 10_000))
      await route.abort()
    })
  }
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await page.getByRole('button', { name: 'Photos', exact: true }).click()

  await expect(page.locator('.pgrid-photo img.im').first()).toBeVisible()
  /* Read at the first frame the tiles exist, in one step. Waiting for them and
     then asking about them separately is two round-trips with the loading
     window closing between: the states have to be sampled while the pictures
     are still coming, which is the whole subject of the test. */
  const states = await page
    .waitForFunction(() => {
      const images = [...document.querySelectorAll('.pgrid-photo img.im')]
      if (!images.length) return null
      return images.map(image => ({
        ready: image.classList.contains('rdy'),
        animation: getComputedStyle(image).animationName,
        opacity: Number(getComputedStyle(image).opacity),
      }))
    })
    .then(handle => handle.jsonValue())

  const waiting = states.filter(state => !state.ready)
  expect(waiting.length).toBeGreaterThan(0)
  for (const tile of waiting) {
    expect(tile.animation).toBe('media-loading')
    /* It used to be opacity 0 while loading — invisible, so there was
       nothing to see and no way to tell a slow tile from an empty one. */
    expect(tile.opacity).toBeGreaterThan(0)
  }
})
