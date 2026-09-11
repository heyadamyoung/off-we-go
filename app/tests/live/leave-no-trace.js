/* The live suite shares one trip.

   Every spec here talks to the same server and the same trip, one after
   another, because standing a whole stack up per test would cost minutes. That
   is fine until a test plants something and walks away: the day tests count
   the cards on a day, and a photograph left behind by an upload test is a card
   they never agreed to.

   It went unnoticed for as long as it did because a photograph filed nowhere
   used to have no day at all — so anything planted here fell out of the day
   strip and was invisible to the tests it was polluting. Fixing that made the
   litter visible, which is the right way round.

   So: note what is there, and take away whatever you added. */

const photoIds = async (page, stack) => {
  const response = await page.request.get(`${stack.apiBase}/trips/current?t=${stack.trip.slug}`, {
    headers: { authorization: `Bearer ${stack.accessToken}` },
  })
  if (!response.ok()) return []
  return ((await response.json()).photos || []).map(photo => photo.id)
}

/**
 * Registers a before/after pair that removes any photograph the test added.
 *
 * Call it once at the top of a spec that uploads. Anything already on the trip
 * is left exactly as it was found — this takes away litter, not luggage.
 */
export function leaveNoTrace(test, stack) {
  let before = []
  test.beforeEach(async ({ page }) => {
    before = await photoIds(page, stack)
  })
  test.afterEach(async ({ page }) => {
    const now = await photoIds(page, stack)
    const known = new Set(before)
    for (const id of now.filter(value => !known.has(value))) {
      await page.request
        .delete(`${stack.apiBase}/trips/${stack.trip.id}/photos/${id}`, {
          headers: { authorization: `Bearer ${stack.accessToken}` },
        })
        .catch(() => {
          /* A tidy-up that cannot run is not a test failure; the next run
             notes whatever is there as its own starting point. */
        })
    }
  })
}
