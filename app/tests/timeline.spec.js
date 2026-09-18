import { test, expect } from './fixture.js'
import { atDemoTime } from './demo-clock'

/* The timeline, as the one screen where the plan and what happened meet.
 *
 * It used to be two features in one coat — an itinerary AND a photo feed, with
 * every picture on the trip as its own text row — and it rendered the whole
 * trip at once because a nest of days holding stops holding photographs cannot
 * be windowed.
 *
 * What is proved here is the part that only exists in a browser: that the row
 * really does carry both facts, that a phone still somewhere says so and does
 * not invent a departure, that an afternoon of photographs is one row, and
 * that the window is actually wired to the scroller rather than merely
 * written. The arithmetic behind all of it is proved in tests/timeline-rows
 * and tests/stop-visit.
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

async function openTimeline(page, size = PHONE) {
  await page.setViewportSize(size)
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.evaluate(() => window.__offwegoMap?.stop())
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await expect(page.locator('.tline')).toBeVisible()
}

test('a stop says what was planned and when they actually got there', async ({ page }) => {
  /* The whole point of the screen. A planner cannot write this line — it has
     no idea where anybody was — and a location history cannot write it either,
     because it has no plan to hold the answer against. */
  await openTimeline(page)
  const rijks = page.locator('.trow').filter({ hasText: 'Rijksmuseum' })
  await expect(rijks).toHaveCount(1)
  await expect(rijks.locator('.ttime')).toHaveText(/09:30/)
  await expect(rijks.locator('.tsaid')).toHaveText(/arrived 10:05, left 12:40/)
  await expect(rijks.locator('.tdrift')).toHaveText('35 min late')
})

test('a stop they are still in has an arrival and no departure', async ({ page }) => {
  /* A phone that goes quiet has not left anywhere, and the row must not imply
     that it has. Inventing a departure is the one thing this must never do. */
  await openTimeline(page)
  const said = page.locator('.trow').filter({ hasText: 'Foodhallen' }).locator('.tsaid')
  await expect(said).toHaveText(/arrived 13:12/)
  await expect(said).not.toHaveText(/left/)
})

test('early reads as early, and a few minutes either way is on time', async ({ page }) => {
  await openTimeline(page)
  await expect(
    page.locator('.trow').filter({ hasText: 'Canal cruise' }).locator('.tdrift'),
  ).toHaveText('on time')
  await expect(page.locator('.trow').filter({ hasText: 'Schiphol' }).locator('.tdrift')).toHaveText(
    '11 min late',
  )
})

test('a stop nobody has reached yet says nothing rather than guessing', async ({ page }) => {
  await openTimeline(page)
  const next = page.locator('.trow').filter({ hasText: 'Anne Frank' })
  await expect(next).toHaveCount(1)
  await expect(next.locator('.tsaid')).toHaveCount(0)
  await expect(next.locator('.tdrift')).toHaveCount(0)
})

test('an afternoon of photographs is one row, not one row each', async ({ page }) => {
  /* This is what made the screen unusable: every picture on the trip as a text
     row carrying a thumbnail, which is neither a gallery nor an itinerary. */
  await openTimeline(page)
  const strips = page.locator('.tshots')
  expect(await strips.count()).toBeGreaterThan(0)
  const shots = await page.locator('.tshot').count()
  // Journeys are rows too; this is about there not being one row per picture.
  const rows = await page.locator('.trow:not(.tgo)').count()
  expect(rows, 'a stop per row and no more').toBeLessThanOrEqual(8)
  expect(shots, 'a strip shows a handful, never the whole afternoon').toBeLessThanOrEqual(
    (await strips.count()) * 5,
  )
})

test('a thumbnail opens the picture, not a screen about the picture', async ({ page }) => {
  await openTimeline(page)
  await page.locator('.tshot').first().click()
  await expect(page.locator('.viewer, .vzwrap, [role="dialog"]').first()).toBeVisible()
})

test('today is marked, so it is findable without counting headings', async ({ page }) => {
  await openTimeline(page)
  const today = page.locator('.tday.now')
  await expect(today).toHaveCount(1)
  await expect(today.locator('.tnow')).toHaveText('Today')
})

test('the window is wired to the scroller, not merely written', async ({ page }) => {
  /* The spacers standing in for undrawn rows have to be real boxes in the
     document, or the scrollbar lies about how long the trip is. */
  await openTimeline(page)
  const measured = await page.evaluate(() => {
    const line = document.querySelector('.tline')
    if (!line) return null
    const children = [...line.children]
    const first = children[0]
    const last = children[children.length - 1]
    return {
      spacers: [first, last].every(node => node?.tagName === 'DIV' && !node.className),
      height: line.getBoundingClientRect().height,
      rows: line.querySelectorAll('.trow').length,
    }
  })
  expect(measured, 'the timeline did not render').not.toBeNull()
  expect(measured.spacers, 'the window has no spacers either side').toBe(true)
  expect(measured.height).toBeGreaterThan(100)
  expect(measured.rows).toBeGreaterThan(0)
})

test('every row is the height the window thinks it is', async ({ page }) => {
  /* The arithmetic that decides which rows exist and the boxes the browser
     lays out have to agree exactly. A row taller than the sum believes slides
     the window faster than the rows inside it, and the drift grows the further
     down a long trip somebody reads. */
  await openTimeline(page)
  const off = await page.evaluate(() => {
    const wanted = { tday: 36, trow: 62, tshots: 96, tleg: 26 }
    const wrong = []
    for (const [kind, height] of Object.entries(wanted))
      for (const node of document.querySelectorAll(`.${kind}`)) {
        const drawn = Math.round(node.getBoundingClientRect().height)
        if (drawn !== height) wrong.push(`${kind}: ${drawn} not ${height}`)
      }
    return wrong
  })
  expect(off, 'a row is not the height the window was told').toEqual([])
})

test('the timeline opens at today, not at the first morning of the trip', async ({ page }) => {
  /* The screen's whole subject is when things happened. On the fourth day of a
     fortnight "where are we" was eleven rows of scrolling away. */
  await openTimeline(page)
  const placed = await page.evaluate(() => {
    const today = document.querySelector('.tday.now')
    const line = document.querySelector('.tline')
    if (!today || !line) return null
    const scroller = today.closest('.sheet')?.querySelector('div.flex-1.overflow-y-auto')
    return {
      moved: (scroller?.scrollTop ?? 0) > 0,
      onScreen: today.getBoundingClientRect().top < window.innerHeight,
    }
  })
  expect(placed, 'today was never drawn').not.toBeNull()
  expect(placed.moved, 'the timeline opened at the top of the trip').toBe(true)
  expect(placed.onScreen).toBe(true)
})

test('a traveller can start a stop from the day it belongs to', async ({ page }) => {
  /* Planning a day used to mean going to the map and remembering to choose the
     right chip first. The button does both and hands the map over for a pin,
     which is still where a place comes from. */
  await openTimeline(page)
  const add = page.locator('.tday .tadd').first()
  await expect(add).toHaveCount(1)
  await add.click()
  /* The panel is out of the way and the map is waiting for a pin. */
  await expect(page.locator('.tline')).toHaveCount(0)
  await expect(page.getByText(/Esc cancels/)).toBeVisible()
})

test('every day offers it, and it lives on the day it adds to', async ({ page }) => {
  /* One per heading and inside it, so the day it would add to is never in
     doubt. A follower gets none at all, which is held to account where the
     rows are built rather than here — there is no way to be a follower of the
     demo, and a test that cannot fail is worse than no test. */
  await openTimeline(page)
  const headings = await page.locator('.tday').count()
  expect(headings).toBeGreaterThan(0)
  await expect(page.locator('.tday .tadd')).toHaveCount(headings)
  await expect(page.locator('.tadd')).toHaveCount(headings)
})

test('the flight and the train are days of the trip, not a separate tab', async ({ page }) => {
  /* A travel day read as a gap between two hotels: the one screen whose
     subject is the order of a day said nothing about the thing the whole day
     is for. This is the plainest thing every itinerary app does. */
  await openTimeline(page)
  await page.evaluate(() => {
    const scroller = document.querySelector('.sheet div.flex-1.overflow-y-auto')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  const going = page.locator('.trow.tgo')
  await expect(going).toHaveCount(2)
  await expect(going.filter({ hasText: 'KL 677' })).toHaveCount(1)
  await expect(going.filter({ hasText: 'AMS → YYC' })).toHaveCount(1)
})

test('a journey opens where its seats and its boarding pass are', async ({ page }) => {
  await openTimeline(page)
  await page.evaluate(() => {
    const scroller = document.querySelector('.sheet div.flex-1.overflow-y-auto')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await page.locator('.trow.tgo').first().click()
  await expect(page.getByRole('heading', { name: 'Travel' })).toBeVisible()
})
