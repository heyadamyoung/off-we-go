import { test, expect } from '@playwright/test'
import { atDemoTime } from './demo-clock'

/* The papers, in reach.
 *
 * Documents existed, but only hanging off the stop or the flight they belonged
 * to — filed correctly and reached slowly — and they were not in the offline
 * pack at all. So the one moment a ticket is wanted, standing at a desk with a
 * queue behind you and no signal, was the moment it was three taps away and
 * not there.
 *
 * The ones for the next thing sit on the next thing now, in the card that
 * already says what is happening. That they are also fetched before anybody
 * opens one is held to account in tests/offline-papers.test.js, where the
 * store can be watched: what a browser has in a Cache is not a thing a page
 * can be asked about honestly from the outside.
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

async function openTrip(page) {
  await page.setViewportSize(PHONE)
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.evaluate(() => window.__offwegoMap?.stop())
  await expect(page.locator('.mstop')).toHaveCount(8)
}

test('the paper for the next thing is on the next thing', async ({ page }) => {
  await openTrip(page)
  await page.locator('.nowpill').click()
  await expect(page.locator('.nowcard')).toBeVisible()

  const paper = page.locator('.nowcard .ncpaper')
  await expect(paper).toHaveCount(1)
  await expect(paper).toHaveText(/Timed entry ticket/)
})

test('a paper opens in the app, which is where the kept copy is', async ({ page }) => {
  /* This used to be a link with target=_blank, and that is the one thing it
     must not be. A new tab is a page of ours with none of this one's state:
     the Cache the offline pack fills is read by app code, not by a service
     worker, so a document opened outside the app is a document fetched over
     the network — at the one desk, in the one queue, with the one dead signal
     this whole feature exists for. */
  await openTrip(page)
  await page.locator('.nowpill').click()
  const paper = page.locator('.nowcard .ncpaper')
  await expect(paper).toHaveCount(1)
  expect(await paper.evaluate(node => node.tagName)).toBe('BUTTON')

  await paper.click()
  await expect(page.locator('.ppview')).toBeVisible()

  /* And it draws the ticket rather than offering to send you somewhere that
     can. */
  await expect(page.locator('.ppview .ppvpdfpages canvas').first()).toBeVisible({
    timeout: 20000,
  })
})

test('the demo has paperwork on it at all', async ({ page }) => {
  /* A demo of a trip app with no documents anywhere in it is a demo of a
     different app — and it is the one trip everybody sees first. */
  await openTrip(page)
  const pin = page.locator('.mstop').filter({ hasText: /Anne Frank/ })
  await expect(page.locator('.nowpill')).toBeVisible()
  await page.locator('.nowpill').click()
  await expect(page.locator('.nowcard .ncpaper')).toHaveCount(1)
  expect(await pin.count()).toBeGreaterThanOrEqual(0)
})
