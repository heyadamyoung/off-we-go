import { test, expect } from './fixture.js'
import { atDemoTime } from './demo-clock'

/* The one rule the place search must never break.

   A typeahead in the name field is an offer. The moment it becomes a gate —
   nothing saveable until you pick one of its answers — half the stops on a
   real trip become unwritable, because "Gran's house", "the campsite by the
   lake" and "Alex's gate check" are in no open dataset and never will be.

   So this is a browser test rather than a core one: the gate, if it ever
   appears, appears in the wiring between the search, the name field and the
   Save button, which is exactly the seam a unit test cannot see. */

const MAP_READY = 9000
const ANY_STOP = 'Foodhallen'
const OWN_WORDS = "Gran's house"

async function openTrip(page) {
  await atDemoTime(page)
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await expect(page.locator('.mstop')).toHaveCount(8)
  const follow = page.locator('.wc.on')
  if (await follow.count()) {
    await follow.click()
    await expect(follow).toHaveCount(0)
  }
}

async function editStop(page, name) {
  await page.locator('.fcard', { hasText: name }).first().click()
  await expect(page.locator('.detailcard')).toBeVisible()
  await page.locator('.detailcard').getByTitle('Edit this stop').click()
  await expect(page.locator('.editor')).toBeVisible()
}

test('a stop can still be called whatever the traveller likes', async ({ page }) => {
  await openTrip(page)
  await editStop(page, ANY_STOP)

  const name = page.locator('.editor .placesearch input')
  await expect(name).toHaveAttribute('role', 'combobox')

  await name.fill(OWN_WORDS)
  /* It answers, and the answer is not a refusal: no match, your own words are
     fine. The demo runs without a backend, so this is also the shape of every
     search that finds nothing anywhere. */
  await expect(page.locator('.editor .psnone')).toContainText('your own words are fine')

  // And the way out is open: Save is live, and it saves what was typed.
  await page.locator('.editor .btn.pri').click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await expect(page.locator('.detailcard')).toContainText(OWN_WORDS)
})
