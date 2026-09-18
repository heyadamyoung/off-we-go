import { test, expect } from './fixture.js'
import { atDemoTime } from './demo-clock'

/* What is happening, on the screen that never said.
 *
 * The map screen has always been reactive: it answers what you tap and says
 * nothing on its own. The one exception was a pill over the map with room for
 * a single line — "At the harbour" — and touching it silently moved the
 * camera. So the map showed where everything was, and nothing told you what
 * was going on.
 *
 * The map stays the hero. The pill opens into a card on it: what is next and
 * how long until it was due, today's pictures, what is already behind you.
 * Every row is a way back to a place on the map.
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

async function openTrip(page, viewport = PHONE) {
  await page.setViewportSize(viewport)
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.evaluate(() => window.__offwegoMap?.stop())
  await expect(page.locator('.mstop')).toHaveCount(8)
}

/** The pill over the map, whatever it currently says. */
const capsule = page => page.locator('.nowpill')

async function openCard(page) {
  const pill = page.locator('.nowcard').first()
  if (await pill.count()) return
  await capsule(page).click()
  await expect(page.locator('.nowcard')).toBeVisible({ timeout: 5000 })
}

test('the pill opens into an answer rather than moving the map', async ({ page }) => {
  await openTrip(page)

  /* Before: the only thing on the screen that speaks is one line. Asking it
     for more is what this whole change is about, so the assertion is that
     there is somewhere for the rest of the answer to be. */
  await openCard(page)
  const card = page.locator('.nowcard')

  await expect(card).toBeVisible()
  await expect(
    card.locator('.ncrow, .ncstrip, .ncdone, .ncempty'),
    'the card opened onto nothing at all',
  ).not.toHaveCount(0)
})

test('the card says what is next and how long until it was due', async ({ page }) => {
  await openTrip(page)
  await openCard(page)
  const next = page.locator('.nowcard .ncrow')
  await expect(next).toHaveCount(1)

  /* A span or an overdue one — the demo's clock is pinned, so which of them
     it is depends on where in the day the fixture sits. What must never
     happen is a countdown that says nothing. */
  await expect(next.locator('.ncmeta, .nclate')).toHaveText(
    /^(in \d+ (h|min)|due .+ ago|now|Later on the trip)/,
  )
})

test('a row in the card is a way back to a place on the map', async ({ page }) => {
  /* The map is the point. Everything the card says is a thing that is
     somewhere, and tapping it should take you there rather than open a screen
     in front of the map. */
  await openTrip(page)
  await openCard(page)
  await page.locator('.nowcard .ncrow').click()

  await expect(page.locator('.nowcard')).toHaveCount(0)
  await expect(page.locator('.detailcard')).toBeVisible({ timeout: 5000 })
  // Still the map screen: no panel came up over it.
  await expect(page.locator('.mapcanvas canvas')).toBeVisible()
})

test('today’s pictures are in the card, and open the gallery where they are', async ({ page }) => {
  await openTrip(page, { width: 1100, height: 900 })
  await openCard(page)
  /* Not conditional. A photograph belongs to the day of its stop, so a demo
     day with stops behind it has pictures behind it too — and a demo whose
     pictures have no day is the demo contradicting the app in the one trip
     everybody sees first. */
  const strip = page.locator('.nowcard .ncshot')
  await expect(strip.first()).toBeVisible({ timeout: 8000 })

  await strip.first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })
})

test('the card closes without leaving the map', async ({ page }) => {
  await openTrip(page)
  await openCard(page)
  await page.locator('.nowcard .ncx').click()
  await expect(page.locator('.nowcard')).toHaveCount(0)
  await expect(page.locator('.mapcanvas canvas')).toBeVisible()
  // And the pill is still there to open it again.
  await expect(capsule(page)).toBeVisible()
})
