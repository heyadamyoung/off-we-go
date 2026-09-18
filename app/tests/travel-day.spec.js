import { expect, test } from '@playwright/test'
import { atDemoTime } from './demo-clock'

/* The travel day, on the ticket.
 *
 * A boarding pass prints TERMINAL, GATE and CHECK-IN as headings with the
 * value under each, and a traveller looks for the heading first. So the
 * ticket in the Travel tab has those columns whether or not the board has
 * filled them in — a dash under the ones it has not — and on the day itself
 * the answer sits on top in words, the phases run underneath, and the board
 * that said so is named with how old its word is.
 *
 * The sample trip's legs are always tomorrow, so the page is told it is the
 * travel day (window.__offwegoTravelDay) to see the day face: the train has
 * just run, the flight leaves in a couple of hours.
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

async function openTrip(page, { travelDay = false } = {}) {
  await page.setViewportSize(PHONE)
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
}

async function openTravel(page, options) {
  await openTrip(page, options)
  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Getting there' })).toBeVisible()
}

const ticketOf = (page, text) => page.locator('.ticket').filter({ hasText: text }).first()
const column = (ticket, key) => ticket.locator(`.tkcol[data-key="${key}"]`)

test('the ticket has its columns the evening before, with a dash where the board has not said', async ({
  page,
}) => {
  await openTravel(page)
  const flight = ticketOf(page, 'KL 677')
  await expect(flight).toHaveAttribute('data-face', 'eve')
  for (const key of ['terminal', 'gate', 'checkin', 'walk', 'security', 'belt']) {
    await expect(column(flight, key), `no ${key} column`).toBeVisible()
  }
  await expect(column(flight, 'terminal')).toContainText('T3')
  await expect(column(flight, 'gate')).toContainText('E19')
  /* Two lines, the zone over the desks: one line was cut to "Des…" on a phone. */
  await expect(column(flight, 'checkin')).toContainText('Zone 3')
  await expect(column(flight, 'checkin')).toContainText('Desks 13–20')
  await expect(column(flight, 'belt')).toContainText('—')
  /* A train has the columns a train has. */
  const train = ticketOf(page, 'IC 3155')
  await expect(column(train, 'platform')).toContainText('14b')
  await expect(train.locator('.tkcol')).toHaveCount(1)
})

test('on the day the answer is on top, in words, with the phases and the board under it', async ({
  page,
}) => {
  await openTravel(page, { travelDay: true })
  const flight = ticketOf(page, 'KL 677')
  await expect(flight).toHaveAttribute('data-face', 'day')
  /* Three hours and ten to the flight in travel-day mode; check-in closes an
     hour before it. The clock is pinned, so this is exact. */
  await expect(flight.locator('.tkhead')).toHaveText(
    /^On time · gate E19 · check-in closes in 2 h (09|10)$/,
  )
  await expect(column(flight, 'walk')).toContainText('9 min')
  await expect(column(flight, 'security')).toContainText('6 min queue')
  /* The phases: the first one still to come is the one lit. */
  const phases = flight.locator('.tkphase')
  await expect(phases).toHaveCount(6)
  await expect(flight.locator('.tkphase[data-state="now"]')).toHaveCount(1)
  await expect(flight.locator('.tkphase[data-state="now"]')).toContainText('Check-in')
  await expect(flight.locator('.tkphase[data-state="done"]')).toHaveCount(0)
  /* Which board, how old, in its own words. */
  await expect(flight.locator('.tksource')).toContainText('Schiphol · 2 min ago · On time')
  /* The trail behind the word, on demand. */
  await flight.getByRole('button', { name: 'What the airport said' }).click()
  await expect(flight.locator('.tktrail li').first()).toContainText('moved from gate E17 to E19')
  await expect(flight.locator('.tktrail li')).toHaveCount(2)
})

test('the make-it meter counts the walk to the gate and says when to leave', async ({ page }) => {
  await openTravel(page, { travelDay: true })
  await expect(page.getByText('9 min from the door to the gate, counted')).toBeVisible()
  await expect(page.locator('.mkleave').first()).toHaveText(/^leave by \d{2}:\d{2}$/)
})

test('the pill over the map leads with the live leg, and the card opens on the ticket', async ({
  page,
}) => {
  await openTrip(page, { travelDay: true })
  const pill = page.locator('.nowpill')
  await expect(pill.locator('b')).toHaveText(/^✈ KL 677 · On time · gate E19/)
  await pill.click()
  const leg = page.locator('.nowcard .ncleg')
  await expect(leg).toBeVisible()
  await expect(leg.locator('.ncbody b')).toHaveText('KL 677')
  await expect(leg).toContainText('T3 · gate E19 · Zone 3 · Desks 13–20')
  await expect(leg).toContainText('Schiphol · 2 min ago')
  await expect(leg.locator('.ncpaper')).toHaveCount(2)
  await leg.locator('.ncrow').click()
  await expect(page.getByRole('heading', { name: 'Getting there' })).toBeVisible()
})

test('on any other day the pill says where the phones are, as before', async ({ page }) => {
  await openTrip(page)
  await expect(page.locator('.nowpill b')).not.toHaveText(/KL 677/)
  await page.locator('.nowpill').click()
  await expect(page.locator('.nowcard')).toBeVisible()
  await expect(page.locator('.nowcard .ncleg')).toHaveCount(0)
})
