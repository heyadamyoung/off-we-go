import { test, expect } from '@playwright/test'

/* Two things the stop editor claimed to do and did not. Both were reported
   from a real trip, and neither had a browser test — the status was written to
   the server correctly and painted over on the way back to the screen, and the
   picture field could only ever be emptied. A core test would have caught
   neither: the first bug was two modules downstream of the save, and the
   second was a missing button. */

const MAP_READY = 9000
/* The stop the demo's own walking traveller is heading to. Marking it Visited
   is the strongest form of the bug: the status has to survive the live overlay
   AND the overlay has to stop calling it the destination, or the card says
   Done while the strip still says UP NEXT. */
const NEXT_STOP = 'Anne Frank House'
const ANY_STOP = 'Foodhallen'
const WITH_PHOTOS = 'Rijksmuseum'

async function open(page) {
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

test('marking a stop Visited actually marks it visited', async ({ page }) => {
  /* The reported bug. You open a stop, tap Visited, watch it save, and it
     comes back Planned. The write was never wrong: the itinerary is drawn
     from a list with live GPS progress written over it, and that overlay said
     'planned' about every stop it had no opinion on — which, with nobody
     sharing a location, is all of them. */
  await open(page)
  await expect(page.locator('.fcard', { hasText: NEXT_STOP }).first()).toContainText('Up next')
  await editStop(page, NEXT_STOP)
  await expect(page.locator('.editor .seg button.on')).toHaveText('Up next')

  await page.locator('.editor .seg button', { hasText: 'Visited' }).click()
  await page.locator('.editor .btn.pri').click()
  await expect(page.locator('.editor')).toHaveCount(0)

  /* The stop stays selected, so its card comes back by itself. Read the answer
     there rather than off the strip, whose cards are unmounted as they scroll
     out — the assertion would be about windowing, not about the status.

     Both halves in one line: 'Done' means the status somebody set survived the
     live overlay, and the absence of 'Up next' means the overlay stopped
     calling a stop they have been to the place they are heading. */
  const card = page.locator('.detailcard')
  await expect(card).toContainText(NEXT_STOP)
  await expect(card).toContainText('Done')
  await expect(card).not.toContainText('Up next')

  // And it is still Visited when the editor is opened again, not just on the card.
  await card.getByTitle('Edit this stop').click()
  await expect(page.locator('.editor .seg button.on')).toHaveText('Visited')
})

test('a stop can wear a photograph from the trip', async ({ page }) => {
  /* The other half: the stop's picture could be looked up from Wikipedia or
     removed, and that was the whole of it. The trip is full of pictures of
     these places, taken by the people who went, and none of them could be
     used. */
  await open(page)
  await editStop(page, ANY_STOP)

  await page.locator('.editor .usepic').click()
  const grid = page.locator('.editor .epickg')
  await expect(grid).toBeVisible()
  await expect(grid.locator('button').first()).toBeVisible()

  await grid.locator('button').first().click()
  // The picker closes and the chosen picture is now the stop's.
  await expect(page.locator('.editor .epick')).toHaveCount(0)
  const picture = page.locator('.editor .epic img')
  await expect(picture).toBeVisible()
  const chosen = await picture.getAttribute('src')
  expect(chosen).toBeTruthy()

  await page.locator('.editor .btn.pri').click()
  await expect(page.locator('.editor')).toHaveCount(0)

  // It survives the save, which is the part a core test cannot reach.
  await page.locator('.fcard', { hasText: ANY_STOP }).first().click()
  await expect(page.locator('.detailcard img')).toHaveAttribute('src', chosen)
})

test('the pictures already filed at a stop are the ones offered first', async ({ page }) => {
  /* On a real trip the grid is thousands long. The ones somebody already filed
     at this stop are marked and lead, because a stop's picture is meant to be
     a picture of the stop. */
  await open(page)
  await editStop(page, WITH_PHOTOS)

  await page.locator('.editor .usepic').click()
  const grid = page.locator('.editor .epickg')
  await expect(grid).toBeVisible()

  const marked = grid.locator('button.on')
  await expect(marked.first()).toBeVisible()
  const count = await marked.count()
  // Whatever is marked is at the front, with nothing unmarked before it.
  for (let i = 0; i < count; i++) {
    await expect(grid.locator('button').nth(i)).toHaveClass(/\bon\b/)
  }
  await expect(page.locator('.editor .epickh')).toContainText('from this stop')
})
