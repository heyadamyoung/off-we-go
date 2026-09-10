import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

/* A film, uploaded by the app, to a server.

   The sample-mode twin of this test proves the client half — chosen, drawn
   from, shown, played — and never makes a request. The server suite proves
   the server half and builds its own multipart by hand. This is the join:
   the bundle's own `uploadPhoto`, its own FormData, its own poster field,
   against the real endpoint, with the real converter behind it. */

const stack = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../dist/live-stack.json'), 'utf8'),
)

test.beforeEach(async ({ page }) => {
  /* Signed in before the first script runs. On the web the session store is
     localStorage, and the client reads it once at module load — set it after
     boot and the app has already decided nobody is here. */
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

/** A genuinely decodable film, recorded in the page rather than committed. */
const recordFilm = page =>
  page.evaluate(async () => {
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

test('a film chosen in the app reaches the server, and comes back playable', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ longitude: 4.8839, latitude: 52.3752 })

  /* Every request the app makes, kept: if the upload never happens, the
     failure should say that rather than "a tile did not appear". */
  const uploads = []
  page.on('request', request => {
    if (request.method() === 'POST' && /\/photos$/.test(new URL(request.url()).pathname))
      uploads.push(request)
  })
  const failures = []
  page.on('response', response => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
  })

  await page.goto(`/trips/${stack.trip.slug}`)
  await page.getByRole('button', { name: 'Add photos' }).first().click()
  await recordFilm(page)

  await page.locator('.dlg input[type="file"]').evaluate(input => {
    const transfer = new DataTransfer()
    transfer.items.add(window.__film)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })

  const chosen = page.locator('.dlg .previews img.preview')
  await expect(chosen).toHaveCount(1, { timeout: 60_000 })
  await page.getByRole('button', { name: /^Add 1 to the map$/ }).click()

  /* The request itself, before anything about what it produced: this is the
     assertion the sample-mode suite structurally cannot make. */
  await expect(async () => {
    expect(uploads.length, `no upload was sent; failed responses: ${failures.join(', ')}`).toBe(1)
  }).toPass({ timeout: 60_000 })

  /* What was in it is asked of the server rather than the request: a body
     assembled from a File is streamed, and the browser does not hand it back
     for inspection. The row it produced is the better evidence anyway. */
  expect(uploads[0].headers()['content-type'] || '').toContain('multipart/form-data')

  // What the server made of it, asked of the server rather than the screen.
  const onServer = async () => {
    const response = await page.request.get(`${stack.apiBase}/trips/current?t=${stack.trip.slug}`, {
      headers: { authorization: `Bearer ${stack.accessToken}` },
    })
    return (await response.json()).photos || []
  }
  const theFilm = async () => (await onServer()).find(photo => photo.kind === 'video') || null

  await expect
    .poll(async () => Boolean(await theFilm()), {
      timeout: 60_000,
      message: 'the upload was sent but no video row ever appeared on the server',
    })
    .toBe(true)

  const landed = await theFilm()
  expect(landed.src, 'the film is served from somewhere').toBeTruthy()
  expect(landed.posterSrc, 'a poster landed with it').toBeTruthy()

  /* And it converts. A film arrives 'pending' with a job behind it; a worker
     that never ran would leave it there for ever, which on the grid is a
     spinner nobody can explain. */
  await expect
    .poll(async () => (await onServer()).find(photo => photo.id === landed.id)?.status, {
      timeout: 120_000,
      message: 'the film never finished converting — the usual cause is no ffmpeg on this machine',
    })
    .toBe('ready')

  /* Converted, and provably so. A server with no converter marks a film ready
     the moment it lands — correct behaviour, and it would let the assertion
     above pass on a box that never transcoded anything. The ladder cannot
     exist unless the worker really ran.

     It arrives after 'ready' rather than with it: converting and laddering are
     two jobs, and the film is watchable as a file between them. So this waits
     rather than asserting, which is also the honest description of what the
     app sees. */
  await expect
    .poll(async () => Boolean((await onServer()).find(photo => photo.id === landed.id)?.hlsSrc), {
      timeout: 120_000,
      message: 'the converter never built the ladder',
    })
    .toBe(true)
  const done = (await onServer()).find(photo => photo.id === landed.id)

  // The bytes come back, signed, without a session — which is how a player asks.
  const bytes = await page.request.get(landed.src)
  expect(bytes.status(), 'the film itself is served').toBeLessThan(300)

  /* And the stream is walkable: the master names a rendition, which names a
     segment, which is a real transport packet. That is what a player does. */
  const master = await (await page.request.get(done.hlsSrc)).text()
  const variant = master
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'))
  expect(variant, 'the master names a rendition').toBeTruthy()
  const variantText = await (await page.request.get(variant)).text()
  const segment = variantText
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'))
  expect(segment, 'the rendition names a segment').toBeTruthy()
  const packet = await (await page.request.get(segment)).body()
  expect(packet[0], 'a real MPEG-TS packet came back').toBe(0x47)
})
