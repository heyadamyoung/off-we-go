import { expect, test } from './fixture.js'
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

async function openTravel(page, { size = PHONE, travelDay = false } = {}) {
  await page.setViewportSize(size)
  await page.addInitScript(
    ({ today }) => {
      window.__offwegoStill = true
      if (today) window.__offwegoTravelDay = true
    },
    { today: travelDay },
  )
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
  // The evening before, the flight is folded under the train: open it.
  await page.getByRole('button', { name: /KL 677/ }).click()
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
  await page.getByRole('button', { name: /KL 677/ }).click()
  const flight = page.locator('.rounded-xl').filter({ hasText: 'KL 677' }).first()
  await flight.locator('.pprow').first().click()
  await expect(page.locator('.ppview')).toBeVisible()
  await expect(page.locator('.ppview .ppvbar b')).toContainText('Boarding pass')
})

/* The order of the tab.
 *
 * A travel day is read from where you are in it. The leg that matters now —
 * the one you are on, or the next to leave — is on top as its ticket, and
 * every other leg is a line: the ones still to come under it, the ones
 * behind you under "Earlier". A line opens to its ticket on a tap and folds
 * on another, so a past flight's belt or a future one's booking is a tap
 * away and never in the way.
 */

test('the leg that matters now is on top, and the rest fold to a line', async ({ page }) => {
  // The evening before: the train leaves first, so it is the ticket on top
  // and the flight after it is one folded line.
  await openTravel(page)
  const cards = page.locator('.ticket, .legfold')
  await expect(cards.first()).toHaveClass(/ticket/)
  await expect(cards.first()).toContainText('IC 3155')
  await expect(page.locator('.legfold')).toHaveCount(1)
  await expect(page.locator('.legfold')).toContainText('KL 677')
  await expect(page.locator('.legfold')).toContainText('AMS → YYC')
  await expect(page.getByText('Earlier')).toHaveCount(0)
  // The gap between them still judges itself, above the folded flight.
  await expect(page.getByText(/to change —/)).toBeVisible()

  /* The fold's own line, not the ticket's route inside it — that is a
     button too now, the door to the leg's own screen. */
  const flight = page.locator('.legfold > button', { hasText: 'KL 677' })
  await expect(flight).toHaveAttribute('aria-expanded', 'false')
  await flight.click()
  await expect(flight).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.legfold .ticket')).toContainText('R7QWXZ')
  await flight.click()
  await expect(page.locator('.legfold .ticket')).toHaveCount(0)
})

test('on the day, the flight is on top and the train that has arrived is behind it', async ({
  page,
}) => {
  await openTravel(page, { travelDay: true })
  const cards = page.locator('.ticket, .legfold')
  await expect(cards.first()).toHaveClass(/ticket/)
  await expect(cards.first()).toContainText('KL 677')
  await expect(page.getByText('Earlier')).toBeVisible()
  const train = page.locator('.legfold').filter({ hasText: 'IC 3155' })
  await expect(train).toHaveCount(1)
  await train.getByRole('button').click()
  await expect(train.locator('.ticket')).toContainText('14b')
})
