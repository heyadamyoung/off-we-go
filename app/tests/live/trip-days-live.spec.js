import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

/* A trip whose days are dates, drawn by the real client against the real API.

   Every other browser test runs against the sample, and the sample's stops say
   September while its range floats around today — deliberately, so its printed
   dates stay the fiction's own calendar. Nothing on it can be placed on a date,
   which means the whole ISO path is exercised only by unit tests. This trip has
   real dates and the four spellings the database actually holds:

     '2026-09-04'  a date from the picker
     'Fri 4 Sep'   the label the app used to write
     'Tue 4 Sep'   a label whose weekday went stale
     '4'           what somebody typed before there was anywhere to pick

   Three of those are the fourth of September. One day, not four. */

const stack = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../dist/live-stack.json'), 'utf8'),
)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([token, email]) => {
      window.localStorage.setItem(
        'wayfare-session',
        JSON.stringify({ accessToken: token, user: { email } }),
      )
      window.__offwegoStill = true
    },
    [stack.accessToken, 'owner@example.com'],
  )
})

const open = async page => {
  await page.goto(`/trips/${stack.trip.slug}`)
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.mstop').first()).toBeVisible({ timeout: 30_000 })
}

const flat = text => text.trim().toLowerCase()

test('four spellings of two days make two chips', async ({ page }) => {
  await open(page)
  const chips = (await page.locator('.fdays .chip').allInnerTexts())
    .map(flat)
    .filter(chip => chip !== 'all days')
  /* Drawn as labels and ordered by date — the whole point of storing the date.
     Sorting the text would put Friday above Saturday by luck and Thursday
     below both by spelling. */
  expect(chips).toEqual(['fri 4 sep', 'sat 5 sep'])
})

test('the timeline heads those days the same way, in the same order', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  const headings = (await page.locator('.sheet .flex.items-baseline b').allInnerTexts()).map(flat)
  expect(headings).toEqual(['fri 4 sep', 'sat 5 sep'])

  /* And the four stops of the fourth are all under the first heading — read as
     the panel reads, top to bottom, because that is what somebody scrolling it
     sees. Four spellings of one day filed together under one date. */
  const order = flat(await page.locator('.sheet').innerText())
  const secondHeading = order.indexOf('sat 5 sep')
  expect(secondHeading).toBeGreaterThan(-1)
  for (const name of ['anne frank house', 'rijksmuseum', 'westerkerk', 'vondelpark']) {
    const at = order.indexOf(name)
    expect(at, `${name} is missing from the timeline`).toBeGreaterThan(-1)
    expect(at, `${name} is below the second day's heading`).toBeLessThan(secondHeading)
  }
  expect(order.indexOf('centraal')).toBeGreaterThan(secondHeading)
})

test('choosing a day selects every stop on it, however each one spells it', async ({ page }) => {
  await open(page)
  await page.locator('.fdays .chip', { hasText: /Fri 4 Sep/i }).click()
  await expect(page.locator('.fcard')).toHaveCount(4)
  await page.locator('.fdays .chip', { hasText: /Sat 5 Sep/i }).click()
  await expect(page.locator('.fcard')).toHaveCount(1)
})

test('a stop added on a day is stored as that date and joins it', async ({ page }) => {
  /* Through the real editor to the real API and back. The picker writes a
     date now, so what the server stores is what the chip compares against —
     no label to read back, no year to guess. */
  await open(page)
  await page.locator('.fdays .chip', { hasText: /Sat 5 Sep/i }).click()
  await page.getByRole('button', { name: 'Edit the itinerary' }).click()
  const canvas = await page.locator('.mapcanvas canvas').boundingBox()
  await page.mouse.click(canvas.x + canvas.width * 0.2, canvas.y + canvas.height * 0.25)
  await expect(page.locator('.editor')).toBeVisible()
  // Seeded from the chosen day, and the calendar can show it because it is a date.
  await expect(page.locator('.editor input[type="date"]')).toHaveValue('2026-09-05')

  await page.locator('.editor .f input').first().fill('Added On The Fifth')
  await page.locator('.editor .btn.pri').click()
  await expect(page.locator('.fcard')).toHaveCount(2)

  /* Read back from the server rather than from the screen: what matters is
     what was WRITTEN. A label would read back the same to a client that can
     still parse labels, and would rot the moment the trip's dates moved. */
  const stored = await page.evaluate(
    async ([base, token, slug]) => {
      const response = await fetch(`${base}/trips/current?t=${encodeURIComponent(slug)}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const body = await response.json()
      return (body.stops || []).find(stop => stop.name === 'Added On The Fifth')?.day
    },
    [stack.apiBase, stack.accessToken, stack.trip.slug],
  )
  expect(stored).toBe('2026-09-05')
})
