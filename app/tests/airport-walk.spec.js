import { expect, test } from './fixture.js'
import { atDemoTime, DEMO_NOW } from './demo-clock'
import { serveOverpass } from './overpass-fixture.js'

/* The walk through the terminal, on the day of the flight.
 *
 * The board names the desks and, later, the gate; the floor plan knows where
 * they are. So when a phone is found at the airport in the hours before a
 * flight, the terminal opens by itself and a capsule over the map says where
 * to go next — bag drop, then security, then the gate — with the board's
 * word on each and the walk there, and moves on as the traveller does. The
 * sample family is at Schiphol on the travel day (window.__offwegoTravelDay),
 * a hundred metres short of the desks, and Overpass is answered from the
 * fixture, whose terminal has the desks, the filter, the stairs and the
 * pier.
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

const lineDrawn = page =>
  page.evaluate(
    () =>
      window.__offwegoMap
        ?.getSource('indoor')
        ?.serialize?.()
        .data?.features?.some(f => f.properties?.kind === 'route-here') ?? false,
  )

test('on the day of the flight the terminal opens itself and walks the family to the desks, security and the gate', async ({
  page,
}) => {
  await serveOverpass(page)
  await page.setViewportSize(PHONE)
  await page.addInitScript(() => {
    window.__offwegoStill = true
    window.__offwegoTravelDay = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })

  const capsule = page.locator('.walkcap')
  await expect(capsule).toBeVisible({ timeout: 15000 })
  await expect(capsule).toHaveAttribute('data-stage', 'bagdrop')
  await expect(capsule).toContainText('Bag drop · Zone 3 · Desks 13–20')
  await expect(capsule).toContainText(/\d+ m walk/, { timeout: 15000 })
  await expect.poll(() => lineDrawn(page), { timeout: 15000 }).toBe(true)

  /* The chrome is the capsule and, once the camera is over the terminal,
     the floor pill — nothing that only says what to click and nothing that
     closes the terminal. The pill waits for the camera: at open the map is
     the trip, and a picker for floors nobody can see was sitting over it. */
  await page.evaluate(() => window.__offwegoMap?.jumpTo({ center: [4.7639, 52.3105], zoom: 16 }))
  await expect(page.getByRole('button', { name: 'Floor 0 — choose a floor' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close the terminal map' })).toHaveCount(0)
  await expect(page.getByText('Click a gate for walking directions')).toHaveCount(0)

  await capsule.getByRole('button', { name: 'Next' }).click()
  await expect(capsule).toHaveAttribute('data-stage', 'security')
  await expect(capsule).toContainText('Security · 6 min queue')
  await expect(capsule).toContainText(/\d+ m walk/, { timeout: 15000 })

  await capsule.getByRole('button', { name: 'Next' }).click()
  await expect(capsule).toHaveAttribute('data-stage', 'gate')
  await expect(capsule).toContainText('Gate E19')
  await expect(capsule).toContainText('stairs to level 2', { timeout: 15000 })
  // The gate is where the walk ends: nothing to press.
  await expect(capsule.getByRole('button')).toHaveCount(0)

  // The floor pill opens on a tap and folds on a choice.
  await page.getByRole('button', { name: 'Floor 0 — choose a floor' }).click()
  await page.getByRole('button', { name: 'Floor 2', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Floor 2 — choose a floor' })).toBeVisible()
  /* And the choice outlives the clock. The walk is rebuilt every minute,
     and a target rebuilt as a new object was taken for a new destination,
     whose route starts on the ground floor — so the pill snapped back to 0
     within a minute of anybody choosing 2, which read as the floors not
     changing at all. */
  await page.clock.setFixedTime(new Date(DEMO_NOW.getTime() + 60_000))
  await page.evaluate(() => window.__offwegoTick?.())
  await expect(capsule).toContainText('Gate E19')
  await expect(page.getByRole('button', { name: 'Floor 2 — choose a floor' })).toBeVisible()
  await page.evaluate(() => window.__offwegoTick?.())
  await expect(page.getByRole('button', { name: 'Floor 2 — choose a floor' })).toBeVisible()

  /* Zoomed away, the picker goes with the camera — a control for floors
     nobody can see was sitting over the map of the whole trip — and the
     walk keeps its capsule, which is what to do next wherever the map is.
     Back over the terminal, the picker is back, on the floor that was
     chosen. */
  await page.evaluate(() => window.__offwegoMap?.jumpTo({ center: [4.9, 52.37], zoom: 9 }))
  await expect(page.getByRole('button', { name: /choose a floor/ })).toHaveCount(0)
  await expect(capsule).toContainText('Gate E19')
  await page.evaluate(() => window.__offwegoMap?.jumpTo({ center: [4.7639, 52.3105], zoom: 16 }))
  await expect(page.getByRole('button', { name: 'Floor 2 — choose a floor' })).toBeVisible()
})

/* "Show the gate on the map" lands on the gate. It used to put the camera
   on the airport's pin, a terminal away from gate E19, with nothing to say
   which way to walk; now the terminal opens, the camera goes to the gate on
   the gate's floor, and the line to it is drawn with its capsule. */
test('show the gate on the map goes to the gate itself, not the airport’s pin', async ({
  page,
}) => {
  await serveOverpass(page)
  await page.setViewportSize(PHONE)
  await page.addInitScript(() => {
    window.__offwegoStill = true
    window.__offwegoTravelDay = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.evaluate(() => window.__offwegoMap?.stop())

  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  const flight = page.locator('.ticket').filter({ hasText: 'KL 677' }).first()
  await flight.getByRole('button', { name: 'Open KL 677' }).click()
  await page.getByRole('button', { name: 'Show the gate on the map' }).click()

  /* The fixture's E19 is at 4.7652, 52.3109; the airport's pin is 4.7683,
     52.3105 — three hundred metres east, which is the whole complaint. */
  await expect
    .poll(
      async () => {
        const centre = await page.evaluate(() => {
          const c = window.__offwegoMap?.getCenter()
          return c ? [c.lng, c.lat] : null
        })
        return centre ? Math.hypot(centre[0] - 4.7652, centre[1] - 52.3109) < 0.0006 : false
      },
      { timeout: 20000 },
    )
    .toBe(true)
  const capsule = page
    .getByRole('status')
    .filter({ hasText: 'Gate E19' })
    .or(page.locator('.glass').filter({ hasText: 'Gate E19' }))
  await expect(capsule.first()).toBeVisible({ timeout: 15000 })
  await expect(capsule.first().getByRole('button', { name: 'Clear' })).toBeVisible()
})
