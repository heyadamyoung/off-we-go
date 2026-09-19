import { expect, test } from '../fixture.js'
import { stack } from './stack.js'

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

test('many stops on one date make one chip', async ({ page }) => {
  await open(page)
  const chips = (await page.locator('.fdays .chip').allInnerTexts())
    .map(flat)
    .filter(chip => chip !== 'all days')
  /* Drawn as labels and ordered by date — the whole point of storing the date.
     Sorting the text would put Friday above Saturday by luck and Thursday
     below both by spelling. */
  expect(chips.slice(0, 2)).toEqual(['fri 4 sep', 'sat 5 sep'])
})

test('the timeline heads those days the same way, in the same order', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await page.locator('.tline').waitFor()
  /* Every heading it holds, not just the ones on screen. The timeline draws
     the rows near the fold and stands spacers in for the rest, so reading the
     document once would report a trip that ends wherever the window does. */
  const scroller = page.locator('.sheet div.flex-1.overflow-y-auto')
  const headingsInOrder = async () => {
    const seen = []
    for (let guard = 0; guard < 40; guard += 1) {
      for (const heading of await page.locator('.tday b').allInnerTexts()) {
        const day = flat(heading)
        if (!seen.includes(day)) seen.push(day)
      }
      const moved = await scroller.evaluate(node => {
        const was = node.scrollTop
        node.scrollTop = was + node.clientHeight
        return node.scrollTop > was
      })
      if (!moved) return seen
      await page.waitForTimeout(150)
    }
    return seen
  }
  /* Newest first by default — the days turned round, the undated tail still
     last — and the chips' own order once the control flips it. */
  const newest = await headingsInOrder()
  expect(newest.at(-1)).toBe('no date yet', 'the stop with no day is drawn last either way')
  await page.getByRole('button', { name: /Newest first/ }).click()
  await page.locator('.sheet div.flex-1.overflow-y-auto').evaluate(node => {
    node.scrollTop = 0
  })
  const headings = await headingsInOrder()
  expect(headings.slice(0, 2)).toEqual(['fri 4 sep', 'sat 5 sep'])
  expect(headings.at(-1)).toBe('no date yet', 'and the stop with no day is drawn, last')
  const dated = list => list.filter(day => day !== 'no date yet')
  expect(dated(newest)).toEqual(dated(headings).slice().reverse())

  /* And the four stops of the fourth are all under the first heading — read as
     the panel reads, top to bottom, because that is what somebody scrolling it
     sees. Four spellings of one day filed together under one date. */
  await page.locator('.sheet div.flex-1.overflow-y-auto').evaluate(node => {
    node.scrollTop = 0
  })
  await page.waitForTimeout(150)
  const order = flat(await page.locator('.tline').innerText())
  const secondHeading = order.indexOf('sat 5 sep')
  expect(secondHeading).toBeGreaterThan(-1)
  for (const name of ['anne frank house', 'rijksmuseum', 'westerkerk', 'vondelpark']) {
    const at = order.indexOf(name)
    expect(at, `${name} is missing from the timeline`).toBeGreaterThan(-1)
    expect(at, `${name} is below the second day's heading`).toBeLessThan(secondHeading)
  }
  expect(order.indexOf('centraal')).toBeGreaterThan(secondHeading)
})

test('choosing a day selects every stop on it', async ({ page }) => {
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
     what was WRITTEN. A label used to read back the same to a client that
     could still parse one, which is how a wrong value stayed invisible. */
  const stored = await page.evaluate(
    async ([base, token, slug]) => {
      const response = await fetch(`${base}/trips/current?t=${encodeURIComponent(slug)}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const body = await response.json()
      const added = (body.stops || []).find(stop => stop.name === 'Added On The Fifth')
      return added ? { id: added.id, day: added.day } : null
    },
    [stack.apiBase, stack.accessToken, stack.trip.slug],
  )
  expect(stored?.day).toBe('2026-09-05')

  /* Taken away again: the fifth has one stop on it, and the test above that
     counts on that could run after this one on the same trip. */
  const removed = await page.request.delete(
    `${stack.apiBase}/trips/${stack.trip.id}/stops/${stored.id}`,
    { headers: { authorization: `Bearer ${stack.accessToken}` } },
  )
  expect(removed.ok()).toBe(true)
})
