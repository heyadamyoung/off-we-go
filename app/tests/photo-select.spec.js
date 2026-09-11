import { test, expect } from '@playwright/test'

/* Choosing several photographs and filing them somewhere.

   The rules are unit-tested in tests/photo-select.test.js and the rows in
   tests/place-choices.test.js. What only a browser can answer is whether the
   gestures reach them: whether a long press on a real tile starts a selection
   without also opening the picture, whether the bar and the picker are on the
   screen and reachable, and whether the move actually re-files anything.

   Sample mode, so there is no server and no account — which is also why the
   move is the client's optimistic one. That is the half a person sees. */

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

/* A held thumb, in the events the tile actually listens for. Playwright has a
   tap and it has a mouse; it has nothing that holds still, so the press is
   spelled out. The click afterwards is the one a phone really does send, and
   is the whole reason the hold has to swallow it. */
const longPress = async (tile, ms = 700) => {
  const box = await tile.boundingBox()
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }
  await tile.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, ...at })
  await tile.page().waitForTimeout(ms)
  await tile.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, ...at })
  await tile.dispatchEvent('click', at)
}

test('a long press starts a selection instead of opening the picture', async ({ page }) => {
  await openPhotos(page)
  const tiles = page.locator('.pgrid-photo')
  await longPress(tiles.first())

  // The bar appears, saying what is chosen, and the viewer did not open.
  await expect(page.getByRole('toolbar', { name: /chosen photos/i })).toBeVisible()
  await expect(page.getByText('1 item', { exact: true })).toBeVisible()
  await expect(page.locator('.vbody')).toHaveCount(0)

  // And the tile says so, rather than looking like every other one.
  await expect(tiles.first()).toHaveAttribute('aria-pressed', 'true')
})

test('once choosing, a tap adds and a second tap takes away', async ({ page }) => {
  await openPhotos(page)
  const tiles = page.locator('.pgrid-photo')
  await longPress(tiles.first())

  await tiles.nth(1).click()
  await expect(page.getByText('2 items', { exact: true })).toBeVisible()
  await tiles.nth(1).click()
  await expect(page.getByText('1 item', { exact: true })).toBeVisible()

  // Nothing was opened along the way.
  await expect(page.locator('.vbody')).toHaveCount(0)
})

test('the Select button is the way in for a mouse, and Escape the way out', async ({ page }) => {
  await openPhotos(page)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await expect(page.getByRole('toolbar', { name: /chosen photos/i })).toBeVisible()

  await page.locator('.pgrid-photo').first().click()
  await expect(page.getByText('1 item', { exact: true })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('toolbar', { name: /chosen photos/i })).toHaveCount(0)
  // And the gallery is a gallery again: a tap opens the picture.
  await page.locator('.pgrid-photo').first().click()
  await expect(page.locator('.vbody')).toBeVisible()
})

test('shift-click takes everything between, with no mode to enter first', async ({ page }) => {
  await openPhotos(page)
  await page.getByRole('button', { name: 'By date' }).click()
  const tiles = page.locator('.pgrid-photo')
  await tiles.first().click({ modifiers: ['Shift'] })
  await expect(page.getByText('1 item', { exact: true })).toBeVisible()
  await tiles.nth(3).click({ modifiers: ['Shift'] })
  await expect(page.getByText('4 items', { exact: true })).toBeVisible()
})

test('a heading takes its whole card in one tap', async ({ page }) => {
  await openPhotos(page)
  await page.getByRole('button', { name: 'Select', exact: true }).click()

  const head = page.locator('.pgrid-head').first()
  const row = page.locator('.pgrid-head').first().locator('..')
  const shown = Number(await head.locator('span').nth(1).innerText())
  await row.getByRole('button', { name: /^Select all of / }).click()
  await expect(
    page.getByText(`${shown} ${shown === 1 ? 'item' : 'items'}`, { exact: true }),
  ).toBeVisible()

  // And gives it all back, rather than needing one tap per picture.
  await row.getByRole('button', { name: /^Deselect / }).click()
  await expect(page.getByText('0 items', { exact: true })).toBeVisible()
})

test('the picker offers the itinerary, and choosing one re-files the pictures', async ({
  page,
}) => {
  await openPhotos(page)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  const tiles = page.locator('.pgrid-photo')
  await tiles.first().click()

  await page.getByRole('button', { name: 'Move', exact: true }).click()
  const picker = page.getByRole('dialog', { name: /Move 1 item/ })
  await expect(picker).toBeVisible()

  /* Real itinerary items, not a list of ids — and the two answers that are
     not a place, which is what makes this more than a dropdown. */
  await expect(picker.getByRole('button', { name: /Not at any place/ })).toBeVisible()
  const places = picker.locator('button').filter({ hasNot: page.locator('svg[aria-hidden]') })
  await expect(await places.count()).toBeGreaterThan(1)

  /* The card the photograph is filed under now, so the move can be seen to
     have moved it somewhere else. */
  const wasUnder = await page.locator('.pgrid-head').first().innerText()
  const target = picker
    .locator('button')
    .filter({ hasText: /\S/ })
    .filter({ hasNotText: /Not at any place|Decide by where|Close/ })
    .last()
  const targetName = (await target.innerText()).split('\n')[0]
  await target.click()

  await expect(picker).toHaveCount(0)
  // It says what happened, and the picture is now under the place chosen.
  await expect(page.locator('.toast, [role="status"]').first()).toBeVisible({ timeout: 8000 })
  expect(targetName).not.toEqual(wasUnder)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the bar and the picker both stay on the screen', async ({ page }) => {
    await openPhotos(page)
    const tiles = page.locator('.pgrid-photo')
    await longPress(tiles.first())

    /* Anchored to the bottom of the gallery, not floating past it. A bar
       drawn below the fold is a bar nobody can reach. */
    const bar = page.getByRole('toolbar', { name: /chosen photos/i })
    await expect(bar).toBeVisible()
    const barBox = await bar.boundingBox()
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(844)

    await page.getByRole('button', { name: 'Move', exact: true }).click()
    const picker = page.getByRole('dialog', { name: /Move 1 item/ })
    await expect(picker).toBeVisible()

    /* Measured where it comes to rest. The sheet rises into place over a
       fifth of a second, and a box read halfway through that is a box that
       has not arrived yet. */
    await picker.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))

    /* A bottom sheet: on the bottom edge, no wider than the phone, and not
       taller than it either. */
    const box = await picker.boundingBox()
    expect(box.width).toBeLessThanOrEqual(390)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(Math.abs(box.y + box.height - 844)).toBeLessThan(2)
    expect(box.height).toBeLessThanOrEqual(844)

    // Every row in it can be reached with a thumb.
    const row = picker.getByRole('button', { name: /Not at any place/ })
    const rowBox = await row.boundingBox()
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(844)
    expect(rowBox.height).toBeGreaterThanOrEqual(44)
  })

  test('the scrim is the way out, and nothing is left chosen by accident', async ({ page }) => {
    await openPhotos(page)
    await longPress(page.locator('.pgrid-photo').first())
    await page.getByRole('button', { name: 'Move', exact: true }).click()
    await expect(page.getByRole('dialog', { name: /Move 1 item/ })).toBeVisible()

    await page.mouse.click(195, 60)
    await expect(page.getByRole('dialog', { name: /Move 1 item/ })).toHaveCount(0)
    // Backing out of the picker leaves the selection alone rather than clearing it.
    await expect(page.getByText('1 item', { exact: true })).toBeVisible()
  })
})
