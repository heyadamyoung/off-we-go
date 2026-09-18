import { expect, test } from '@playwright/test'
import { atDemoTime } from './demo-clock'

/* Getting there, when it stops going to plan.
 *
 * Travel is the one screen in this app with consequences. Everything else
 * assumes the plan holds; this is the only place where it breaking costs
 * somebody a flight. So what is proved here is not that the card draws — it
 * is that a departure which moved SAYS SO, and that the countdown hanging off
 * it moved with it.
 *
 * Before this, the deadlines were worked out once at write time and never
 * again. A flight put back ninety minutes kept boarding, bags and doors where
 * they would have been, and every countdown on the card and every notification
 * on a phone was still counting down to a moment that had stopped existing.
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

async function openTravel(page, size = PHONE) {
  await page.setViewportSize(size)
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.evaluate(() => window.__offwegoMap?.stop())
  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Travel' })).toBeVisible()
}

test('a departure that moved says so, and says by how much', async ({ page }) => {
  /* "Delayed" on its own is the start of a question rather than an answer. */
  await openTravel(page)
  const train = page.locator('.rounded-xl').filter({ hasText: 'IC 3155' }).first()
  await expect(train).toContainText('delayed')
  await expect(train).toContainText('25 min later')
})

test('the time it was meant to go is struck through beside the time it goes', async ({ page }) => {
  /* The same way a changed gate has always been drawn. Without it the
     countdown quietly re-based and nothing said the plan had moved, so a
     traveller could not tell a delay from having misremembered. */
  await openTravel(page)
  const struck = page
    .locator('.rounded-xl')
    .filter({ hasText: 'IC 3155' })
    .first()
    .locator('s')
    .first()
  await expect(struck).toBeVisible()
  const [was, now] = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.rounded-xl')].find(node =>
      node.textContent?.includes('IC 3155'),
    )
    const line = card?.querySelector('s')?.parentElement
    const old = line?.querySelector('s')?.textContent?.trim() || ''
    return [old, (line?.textContent || '').replace(old, '').trim()]
  })
  expect(was, 'the old departure is not drawn').toMatch(/^\d{2}:\d{2}$/)
  expect(now, 'the new departure is not drawn').toMatch(/^\d{2}:\d{2}$/)
  expect(was).not.toBe(now)
})

test('a leg that never moved is not decorated with a delay it did not have', async ({ page }) => {
  await openTravel(page)
  const flight = page.locator('.rounded-xl').filter({ hasText: 'KL 677' }).first()
  await expect(flight).not.toContainText('later')
  await expect(flight).not.toContainText('earlier')
  await expect(flight.locator('s')).toHaveCount(0)
})

/* The papers on a leg.
 *
 * They used to be drawn twice on the same card: a row of paperclip chips that
 * opened the file in another tab, and a "Papers · 2" button onto a sheet whose
 * rows were an editable name, an editable note, a hold-to-delete and a 32px
 * chevron — the smallest target on the row being the only one that produced
 * the document. Two doors to one thing, and neither of them stayed in the app,
 * which means neither of them could use the copy already on the phone.
 */

test('a leg draws its papers once, as papers', async ({ page }) => {
  await openTravel(page)
  const flight = page.locator('.rounded-xl').filter({ hasText: 'KL 677' }).first()
  await expect(flight.locator('.pprow')).toHaveCount(2)
  await expect(flight, 'the paperclip chips are the second door').not.toContainText('📎')
  await expect(flight.getByRole('button', { name: 'Papers', exact: true })).toHaveCount(0)
})

test('a paper opened from a leg is the same screen as everywhere else', async ({ page }) => {
  /* Three doors — this card, a stop's sheet, the Papers tab — and one room
     behind them. Three doors that behave differently is how somebody learns
     not to trust any of them. */
  await openTravel(page)
  const flight = page.locator('.rounded-xl').filter({ hasText: 'KL 677' }).first()
  await flight.locator('.pprow').first().click()
  await expect(page.locator('.ppview')).toBeVisible()
  await expect(page.locator('.ppview .ppvbar b')).toContainText('Boarding pass')
})
