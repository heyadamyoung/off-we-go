import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // Freeze the demo's walking traveller: layout and placement assertions need
  // a world that holds still. Set before boot; the router strips query params.
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
})

test('a video is chosen, drawn from its own first frame, and plays in the viewer', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ longitude: 4.8686, latitude: 52.3664 })
  await page.route('https://en.wikipedia.org/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
    }),
  )
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await page.getByRole('button', { name: 'Add photos' }).first().click()

  /* A real film, recorded in the page rather than committed to the repository:
     a canvas painted for half a second and taken off it by MediaRecorder. It
     is a genuinely decodable video, so this drives the actual decode-seek-draw
     path a phone's camera roll would — including the awkward part, that a
     recorded file reports no seekable length to draw a poster from. */
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

  /* The chosen tile is the film's own frame, not a placeholder: a poster that
     failed to draw would leave the camcorder stand-in instead. */
  const chosen = page.locator('.dlg .previews img.preview')
  await expect(chosen).toHaveCount(1, { timeout: 30_000 })
  await expect(chosen).toHaveJSProperty('naturalWidth', 320)
  /* The chip says how long it runs, or just "Video" when the file carries no
     seekable length — either way it marks the tile as one that moves. */
  await expect(page.locator('.dlg .previews').getByText(/^(Video|\d+:\d\d)$/)).toBeVisible()

  // A film carries no EXIF, so it is placed from where the phone is now.
  await expect(page.getByText('Videos carry no GPS')).toBeVisible()
  await expect(page.locator('.dlg .mapcanvas canvas')).toBeVisible()

  await page.getByRole('button', { name: 'Add 1 to the map' }).click()

  /* In the grid it is a poster under a play mark, like every camera roll.
     Newest first, so the film just added is the first tile. */
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
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

  // The photograph's tap-to-like button must not sit over a film's scrubber.
  await expect(page.locator('.viewer .vmaintap')).toHaveCount(0)
})
