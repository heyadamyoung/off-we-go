import { expect, test } from './fixture.js'
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
  await expect(page.getByRole('heading', { name: 'Travel' })).toBeVisible()
}

const ticketOf = (page, text) => page.locator('.ticket').filter({ hasText: text }).first()
const column = (ticket, key) => ticket.locator(`.tkcol[data-key="${key}"]`)

test('the ticket has the columns the board has filled in the evening before, and no dashes', async ({
  page,
}) => {
  await openTravel(page)
  // The evening before, the flight is folded under the train that leaves first.
  await page.getByRole('button', { name: /KL 677/ }).click()
  const flight = ticketOf(page, 'KL 677')
  await expect(flight).toHaveAttribute('data-face', 'eve')
  for (const key of ['terminal', 'gate', 'checkin', 'walk', 'security']) {
    await expect(column(flight, key), `no ${key} column`).toBeVisible()
  }
  await expect(column(flight, 'terminal')).toContainText('T3')
  await expect(column(flight, 'gate')).toContainText('E19')
  /* Two lines, the zone over the desks: one line was cut to "Des…" on a phone. */
  await expect(column(flight, 'checkin')).toContainText('Zone 3')
  await expect(column(flight, 'checkin')).toContainText('Desks 13–20')
  /* Nothing the board has not said: no belt yet, so no belt column and no
     dash, and never a stand. */
  await expect(flight.locator('.tkcol')).toHaveCount(5)
  await expect(flight.locator('.tkcols')).not.toContainText('—')
  await expect(flight.locator('.tkcols')).not.toContainText('Stand')
  /* The aircraft the booking named, under the flight number; Edit lives in
     the corner, not among the day's buttons. */
  await expect(flight.locator('.tkcraft')).toHaveText('Boeing 787-9')
  await expect(flight.getByRole('button', { name: 'Edit' })).toBeVisible()
  await expect(flight.locator('.tkbags')).toContainText('Checked 1 × 23 kg · Carry-on 1 × 12 kg')
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
  /* How long is left, and nothing the ticket already says: not the board's
     word, not the gate, which sit in the columns underneath. */
  await expect(flight.locator('.tkhead')).toHaveText(/^Check-in closes in 2 h (09|10)$/)
  await expect(column(flight, 'walk')).toContainText('9 min')
  await expect(column(flight, 'security')).toContainText('6 min queue')
  /* The phases: the first one still to come is the one lit. */
  const phases = flight.locator('.tkphase')
  await expect(phases).toHaveCount(6)
  await expect(flight.locator('.tkphase[data-state="now"]')).toHaveCount(1)
  await expect(flight.locator('.tkphase[data-state="now"]')).toContainText('Check-in')
  await expect(flight.locator('.tkphase[data-state="done"]')).toHaveCount(0)
  /* Which board, how old — and not its status word again, which the headline
     already said in ours. */
  await expect(flight.locator('.tksource')).toHaveText('Schiphol · 2 min ago')
  /* The trail behind the word, on demand. */
  await flight.getByRole('button', { name: 'What the airport said' }).click()
  await expect(flight.locator('.tktrail li').first()).toContainText('moved from gate E17 to E19')
  await expect(flight.locator('.tktrail li')).toHaveCount(2)
})

test('the make-it meter lives in the pill’s card, not boxed over the map or above the tickets', async ({
  page,
}) => {
  await openTrip(page, { travelDay: true })
  /* Nothing over the map says it: the pill is the one line, and the card
     it opens has everyone's distance against the doors and the leave-by. */
  await expect(page.locator('.mkleave')).toHaveCount(0)
  await page.locator('.nowpill').click()
  const card = page.locator('.nowcard')
  await expect(card.locator('.ncpace')).toContainText('9 min from the door to the gate, counted')
  await expect(card.locator('.mkleave').first()).toHaveText(/^leave by \d{2}:\d{2}$/)
  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Travel' })).toBeVisible()
  await expect(page.locator('aside.sheet .mkleave')).toHaveCount(0)
  await expect(page.locator('aside.sheet .ticket').first()).toContainText('KL 677')
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
  await expect(page.getByRole('heading', { name: 'Travel' })).toBeVisible()
})

test('on any other day the pill says where the phones are, as before', async ({ page }) => {
  await openTrip(page)
  await expect(page.locator('.nowpill b')).not.toHaveText(/KL 677/)
  await page.locator('.nowpill').click()
  await expect(page.locator('.nowcard')).toBeVisible()
  await expect(page.locator('.nowcard .ncleg')).toHaveCount(0)
})

/* The leg's own screen: a tap on the ticket's route opens the airline-app
   view of the flight — the two ends large with their times, the board as a
   board, the day as steps with a note under each, the people and the
   papers — and the arrow goes back to the tab with the ticket as it was. */
test('a tap on the ticket opens the flight’s own screen, and the arrow comes back', async ({
  page,
}) => {
  await openTravel(page, { travelDay: true })
  const flight = ticketOf(page, 'KL 677')
  await expect(flight).toHaveAttribute('data-face', 'day')
  await flight.getByRole('button', { name: 'Open KL 677' }).click()

  const screen = page.getByRole('dialog', { name: /KL 677/ })
  await expect(screen).toBeVisible()
  await expect(screen.locator('.fsstatus')).toContainText('Check-in closes in 2 h')
  await expect(screen.locator('.fsend').first()).toContainText('AMS')
  await expect(screen.locator('.fsend').first()).toContainText('Amsterdam Schiphol')
  await expect(screen.locator('.fsend').last()).toContainText('YYC')
  await expect(screen.locator('.fsend').last()).toContainText('Calgary')
  await expect(screen.locator('.fscraft')).toHaveText('Boeing 787-9')
  await expect(screen.locator('.fscol[data-key="gate"]')).toContainText('E19')
  await expect(screen.locator('.fscol[data-key="checkin"]')).toContainText('Zone 3')
  await expect(screen.locator('.fsstep')).toHaveCount(6)
  await expect(screen.locator('.fsstep[data-state="now"]')).toHaveCount(1)
  await expect(screen.locator('.fsstep').filter({ hasText: 'Check-in' })).toContainText(
    'Zone 3 · Desks 13–20',
  )
  await expect(screen.locator('.fsstep').filter({ hasText: 'Boarding' })).toContainText('Gate E19')
  await expect(screen.locator('.fspeople')).toContainText('Maya')
  await expect(screen.locator('.fspeople')).toContainText('31A')
  await expect(screen.locator('.fspapers')).toContainText('Boarding pass — Maya')
  await expect(screen.getByRole('button', { name: 'Show the gate on the map' })).toBeVisible()

  await screen.getByRole('button', { name: 'Back to the Travel tab' }).click()
  await expect(screen).toHaveCount(0)
  await expect(flight).toBeVisible()

  /* Escape closes it too, and only it: the Travel tab stays. */
  await expect(flight.locator('.tkmore')).toHaveText('Details ›')
  await flight.getByRole('button', { name: 'Open KL 677' }).click()
  await expect(page.getByRole('dialog', { name: /KL 677/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: /KL 677/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Travel' })).toBeVisible()
})
