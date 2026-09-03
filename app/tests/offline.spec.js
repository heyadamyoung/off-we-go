import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // Freeze the demo's walking traveller: layout and offline assertions need a
  // world that holds still. Set before boot; the router strips query params.
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
})

/* The whole point of the offline work, asserted end to end: pull the plug and
   reload, and the app is still there with a map under it. This needs the built
   app — the shell worker is not registered in development — which is what the
   e2e server serves. */
test('the app opens and the map draws with the network cut', async ({ page, context }) => {
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 15000 })
  // Long enough for the worker to take over and be told what the page loaded.
  await page.waitForTimeout(6000)
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          (await caches.open('wayfare-shell-v1')).keys().then(keys => keys.length),
        ),
      { timeout: 15000, message: 'the shell should be held on the device' },
    )
    .toBeGreaterThan(5)

  await context.setOffline(true)
  await page.reload()

  // The app itself booted, from nothing but what was kept.
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('Amsterdam Weekend')).toBeVisible()
  await expect(page.locator('.mstop')).toHaveCount(8)
  // And the basemap drew, rather than leaving the markers on an empty ground.
  const painted = await page.evaluate(async () => {
    const cache = await caches.open('wayfare-basemap-v1')
    return (await cache.keys()).filter(request => request.url.includes('/planet/')).length
  })
  expect(painted, 'basemap tiles were served from the device').toBeGreaterThan(0)
})

/* The tile requests are stubbed: this is here to prove the button reaches the
   basemap and reports what it did, not to pull a few hundred real tiles off a
   free service every time the suite runs. */
test('a trip’s map can be saved to the device before the signal goes', async ({ page }) => {
  let asked = 0
  await page.route('**/tiles.openfreemap.org/planet/**', route => {
    asked++
    return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: 'x' })
  })

  await page.goto('/trips/sample?sheet=settings&tab=trip')
  await expect(page.getByText('Use this map without a signal')).toBeVisible({ timeout: 20000 })
  const before = asked
  await page.getByRole('button', { name: /Save this trip/ }).click()

  await expect(page.getByRole('button', { name: /Remove \(\d+ tiles\)/ })).toBeVisible({
    timeout: 90000,
  })
  expect(asked - before, 'the trip’s own corner of the map was fetched').toBeGreaterThan(50)
})
