import { test, expect } from '@playwright/test'
import { atDemoTime } from './demo-clock'

test.beforeEach(async ({ page, context }) => {
  // Freeze the demo's walking traveller: layout and placement assertions need
  // a world that holds still. Set before boot; the router strips query params.
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ longitude: 4.8686, latitude: 52.3664 })
  await page.route('https://en.wikipedia.org/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
    }),
  )
})

/* A real film, recorded in the page rather than committed to the repository:
   a canvas painted for half a second and taken off it by MediaRecorder. It is
   a genuinely decodable video, so this drives the actual decode-seek-draw path
   a phone's camera roll would — including the awkward part, that a recorded
   file reports no seekable length to draw a poster from. */
const chooseFilm = async page => {
  await page.getByRole('button', { name: 'Add photos' }).first().click()
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const context = canvas.getContext('2d')
    const recorder = new MediaRecorder(canvas.captureStream(20), { mimeType: 'video/webm' })
    const chunks = []
    recorder.ondataavailable = event => chunks.push(event.data)
    const stopped = new Promise(resolve => {
      recorder.onstop = resolve
    })
    recorder.start()
    for (let frame = 0; frame < 12; frame++) {
      context.fillStyle = frame % 2 ? '#c87842' : '#2f6f4f'
      context.fillRect(0, 0, 320, 240)
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    recorder.stop()
    await stopped
    window.__film = new File(chunks, 'funicular.webm', {
      type: 'video/webm',
      lastModified: Date.now(),
    })
  })

  await page.locator('.dlg input[type="file"]').evaluate(input => {
    const transfer = new DataTransfer()
    transfer.items.add(window.__film)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.locator('.dlg .previews img')).toHaveCount(1, { timeout: 30_000 })
}

test('a video is chosen, drawn from its own first frame, and plays in the viewer', async ({
  page,
}) => {
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await chooseFilm(page)

  /* The chosen tile is the film's own frame, not a placeholder: a poster that
     failed to draw would leave the camcorder stand-in instead. */
  const chosen = page.locator('.dlg .previews img')
  await expect(chosen).toHaveJSProperty('naturalWidth', 320)
  /* The chip says how long it runs, or just "Video" when the file carries no
     seekable length — either way it marks the tile as one that moves. */
  await expect(page.locator('.dlg .previews').getByText(/^(Video|\d+:\d\d)$/)).toBeVisible()
  /* And the play mark, which is what says "this one moves" at a glance rather
     than on reading. The same mark the gallery draws, on the same tile. */
  await expect(page.locator('.dlg .previews svg')).toHaveCount(2, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Add 1', exact: true }).click()

  /* In the grid it is a poster under a play mark, like every camera roll.

     Asked for by date rather than by place: the grid groups by itinerary item
     now, so the film just added is inside the card for wherever it was taken,
     which is not the top of the list and may not be on screen at all. By date
     is the chronological view, and newest is still first there. */
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.getByRole('button', { name: 'By date' }).click()
  const tile = page.locator('.pgrid-photo').first()
  await expect(tile).toHaveAttribute('aria-label', 'Video', { timeout: 15_000 })
  await expect(tile.locator('svg')).toBeVisible()
  await tile.click()

  // And in the viewer it is a video element with its own controls.
  const player = page.locator('.viewer video.main')
  await expect(player).toBeVisible()
  await expect(player).toHaveJSProperty('controls', true)
  await expect(async () => {
    expect(await player.evaluate(video => video.readyState)).toBeGreaterThan(0)
  }).toPass({ timeout: 15_000 })
  expect(await player.evaluate(video => video.videoWidth)).toBe(320)

  /* The photograph's tap-to-like button must not sit over a film's scrubber.
     The pane being looked at, specifically: the strip holds the neighbours
     either side as well, and those are photographs with buttons of their own
     — off the stage, out of the tab order, and deaf to a pointer. */
  await expect(page.locator('.viewer .vpane.on .vmaintap')).toHaveCount(0)
  await expect(page.locator('.viewer .vpane:not(.on) .vmaintap').first()).toHaveCSS(
    'pointer-events',
    'none',
  )
})

test('the gallery can be narrowed to the films, or to everything but them', async ({ page }) => {
  /* Reported from a trip that had been going a fortnight: the films were in
     there somewhere. A photograph is scrolled past on the way to something
     else, but a film is looked for on purpose — the forty seconds of the
     funicular, the one where she finally let go of the handlebars — and there
     was no way to ask for just those.

     The control only exists once the trip holds both kinds, so this has to
     make one before it can drive it. */
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await chooseFilm(page)
  await page.getByRole('button', { name: 'Add 1', exact: true }).click()

  /* Chronological, where the film just added is first and the grid is one
     plain card — so the counts below are the whole trip rather than whatever
     the window happened to be holding. */
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.getByRole('button', { name: 'By date' }).click()
  const tiles = page.locator('.pgrid-photo')
  const films = page.locator('.pgrid-photo[aria-label="Video"]')
  await expect(tiles.first()).toHaveAttribute('aria-label', 'Video', { timeout: 15_000 })
  const everything = await tiles.count()
  expect(everything).toBeGreaterThan(5)

  await page.getByRole('button', { name: 'Videos only' }).click()
  await expect(tiles).toHaveCount(1)
  await expect(films).toHaveCount(1)

  /* And the grouping is built from what is left rather than filtered after the
     fact: one film means one card, not a column of empty itinerary items. */
  await page.getByRole('button', { name: 'By place' }).click()
  await expect(page.locator('.pgrid-head')).toHaveCount(1)
  await page.getByRole('button', { name: 'By date' }).click()

  await page.getByRole('button', { name: 'Photos only' }).click()
  await expect(tiles).toHaveCount(everything - 1)
  await expect(films).toHaveCount(0)

  await page.getByRole('button', { name: 'All media' }).click()
  await expect(tiles).toHaveCount(everything)
  await expect(films).toHaveCount(1)
})

test('asking for videos opens a picker that will show videos', async ({ page }) => {
  /* Reported from the iPhone app: video upload does not work.

     The sheet's `accept` was React state, written on the next render, and the
     picker was opened from a microtask — which does not wait for one. So it
     opened carrying whatever the previous tap had left behind. On a desktop
     that is invisible, because the file dialog lets you widen the filter by
     hand. On iOS the system picker honours the attribute absolutely: tap Add
     photos once, which asks for `image/*` on a phone, and every Add videos
     after it offers a library with no film in it at all.

     So this drives the two buttons in the order a person does, and reads the
     attribute off the element the picker is actually opened from. Every other
     test here reaches past the buttons and sets the input directly, which is
     how the one door videos can be reached by went untested. */
  await page.addInitScript(() => {
    // The video button is the native app's; the web sheet asks for both at once.
    window.__offwegoNative = true
  })
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await page.getByRole('button', { name: 'Add photos' }).first().click()

  const input = page.locator('.dlg input[type="file"]')
  await expect(input).toHaveCount(1)

  // Photographs first, which is what leaves the attribute narrowed on a phone.
  await page.getByRole('button', { name: /Choose photos from your photo library/ }).click()
  await expect(input).toHaveJSProperty('accept', 'image/*')

  /* Then films. Before this fix the element still read `image/*` here, and the
     phone's picker showed a library of photographs. */
  await page.getByRole('button', { name: 'Choose videos instead' }).click()
  await expect(input).toHaveJSProperty('accept', 'video/*')
})
