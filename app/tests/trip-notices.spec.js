import { test, expect } from '@playwright/test'
import { atDemoTime } from './demo-clock'

/* What happened while you were not looking.
 *
 * A trip app where the interesting moment happens and nobody is told is a trip
 * app people open twice. Family had to remember to check, and the map — which
 * is the whole reason they came — never said anything had changed.
 *
 * The pill says how much is waiting without being opened, because a pill that
 * says nothing is a pill nobody opens and the whole of this is behind it. Each
 * notice is a way to the place it happened.
 */

const MAP_READY = 9000
const PHONE = { width: 390, height: 844 }
const MARK = 'wf-seen-sample'

/* Somebody who has looked before, a long time ago. The watermark is a
   snapshot rather than a clock, so "before everything" is an empty one. */
async function lookedLongAgo(page) {
  /* Once, not on every navigation. An init script runs again on a reload, and
     re-seeding there would wipe whatever the app had just marked read — which
     is precisely what the reload is here to check survived. */
  await page.addInitScript(
    ({ key }) => {
      if (window.localStorage.getItem(`${key}-seeded`)) return
      window.localStorage.setItem(`${key}-seeded`, '1')
      window.localStorage.setItem(key, JSON.stringify({ done: [], photosTo: 0 }))
    },
    { key: MARK },
  )
}

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

test('a first visit is told nothing, because nothing has been missed', async ({ page }) => {
  /* Without this, everybody's first open announces the whole trip as news,
     which is the opposite of the point. */
  await openTrip(page)
  await expect(page.locator('.nowpill .ncbadge')).toHaveCount(0)
  await page.locator('.nowpill').click()
  await expect(page.locator('.nowcard')).toBeVisible()
  await expect(page.locator('.nowcard .ncnrow')).toHaveCount(0)
})

test('the pill says how much is waiting, without being opened', async ({ page }) => {
  await lookedLongAgo(page)
  await openTrip(page)
  const badge = page.locator('.nowpill .ncbadge')
  await expect(badge).toBeVisible({ timeout: 8000 })
  await expect(badge).toHaveText(/^\d\+?$/)
})

test('what was missed is the first thing in the card', async ({ page }) => {
  /* Somebody who opened the app because something happened came for this
     line. Burying it under the itinerary answers a different question. */
  await lookedLongAgo(page)
  await openTrip(page)
  await page.locator('.nowpill').click()

  const rows = page.locator('.nowcard .ncnrow')
  await expect(rows.first()).toBeVisible({ timeout: 8000 })
  await expect(rows.first()).toHaveText(/new photograph/)

  // First in the card, above everything the card otherwise says.
  const order = await page.evaluate(() => {
    const card = document.querySelector('.nowcard')
    return [...(card?.children ?? [])].map(child => child.className.split(' ')[0])
  })
  expect(order.indexOf('ncnew')).toBe(1, 'the notices are not directly under the headline')
})

test('a notice is a way to the place it happened', async ({ page }) => {
  await lookedLongAgo(page)
  await openTrip(page)
  await page.locator('.nowpill').click()
  await page.locator('.nowcard .ncnrow').first().click()

  // A pictures notice opens the gallery at the newest of them.
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })
})

test('reading them once is reading them, so the pill stops nagging', async ({ page }) => {
  /* Leaving the rest marked unread after somebody has plainly seen the card
     would have the pill lie about what is waiting. */
  await lookedLongAgo(page)
  await openTrip(page)
  await expect(page.locator('.nowpill .ncbadge')).toBeVisible({ timeout: 8000 })

  await page.locator('.nowpill').click()
  await page.locator('.nowcard .ncnrow').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })
  await page.keyboard.press('Escape')

  await expect(page.locator('.nowpill .ncbadge')).toHaveCount(0)
})

test('the mark survives the trip being opened again', async ({ page }) => {
  /* The whole point of a watermark is that it outlives the visit. */
  await lookedLongAgo(page)
  await openTrip(page)
  await page.locator('.nowpill').click()
  await page.locator('.nowcard .ncnrow').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })

  await page.reload()
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await expect(page.locator('.nowpill .ncbadge')).toHaveCount(0)
})
