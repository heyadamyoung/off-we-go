import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

/* The day bar on a phone, on a trip the size of a real one.
 *
 * Every ordering check until now was arithmetic or a two-day trip. This is the
 * bar somebody actually looks at: a week of chips in a scroller, drawn as
 * labels, sorted by the date underneath — and a stop with no day at all, which
 * must not appear as a chip because "All days" already holds it.
 */
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

const DAYS = [
  'fri 4 sep',
  'sat 5 sep',
  'sun 6 sep',
  'mon 7 sep',
  'tue 8 sep',
  'wed 9 sep',
  'thu 10 sep',
]

for (const [where, width, height] of [
  ['a phone', 390, 844],
  ['a desktop', 1440, 900],
]) {
  test(`the day bar runs in date order on ${where}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto(`/trips/${stack.trip.slug}`)
    await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.mstop').first()).toBeVisible({ timeout: 30_000 })

    const chips = (await page.locator('.fdays .chip').allInnerTexts()).map(chip =>
      chip.trim().toLowerCase(),
    )
    expect(chips[0]).toBe('all days')
    /* Every day in date order, and no chip for the stop that has no day —
       "All days" is already where that one lives. */
    expect(chips.slice(1)).toEqual(DAYS)
  })
}

test('every chip is reachable, however many there are', async ({ page }) => {
  /* Seven chips do not fit across a phone, so the row scrolls. A chip that
     cannot be scrolled to is a day of the trip nobody can select. */
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/trips/${stack.trip.slug}`)
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.mstop').first()).toBeVisible({ timeout: 30_000 })

  const last = page.locator('.fdays .chip').last()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeVisible()
  await last.click()
  await expect(last).toHaveClass(/sel/)
})
