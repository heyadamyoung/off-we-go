import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

/* Uploading several photographs, against a real server, slowly.

   The two things a person said were wrong: uploads "just sit there", and they
   all seem to go at once. Neither can be checked in sample mode — nothing
   leaves the tab there, so every upload is instant and there is no wire to
   count requests on. Here there is a server, so the requests are real, and a
   delay in front of it makes the bar observable at human speed.

   What this holds to account is exactly what was complained about: that the
   bar exists, that it counts the batch, that it moves, that it goes when the
   last one lands — and that a few go at a time rather than one or twenty. */

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

const HOW_MANY = 6

/* Six real photographs, drawn here rather than committed.

   A buffer of zeros between JPEG markers is a file the sample build will
   happily preview and the real server will refuse — which it did, six times,
   and the bar dutifully said so. Noise on a canvas exported as a JPEG is an
   actual image: it decodes, it resizes, and it does not compress to nothing,
   so each one is a few hundred kilobytes of genuine upload for the bar to
   count. */
const chooseSix = page =>
  page.locator('.dlg input[type="file"]').evaluate(async (input, count) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1400
    canvas.height = 1000
    const context = canvas.getContext('2d')
    const transfer = new DataTransfer()
    for (let index = 0; index < count; index++) {
      const pixels = context.createImageData(canvas.width, canvas.height)
      for (let at = 0; at < pixels.data.length; at += 4) {
        pixels.data[at] = Math.random() * 255
        pixels.data[at + 1] = Math.random() * 255
        pixels.data[at + 2] = Math.random() * 255
        pixels.data[at + 3] = 255
      }
      context.putImageData(pixels, 0, 0)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      const file = new File([blob], `holiday-${index}.jpg`, {
        type: 'image/jpeg',
        lastModified: 1_700_000_000_000 + index,
      })
      Object.defineProperty(file, 'offwegoMetadata', {
        value: { takenAt: '2026-09-05T12:00:00.000Z' },
      })
      transfer.items.add(file)
    }
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, HOW_MANY)

test('a batch says how far it has got, and a few go at a time', async ({ page }) => {
  /* Counted on the wire rather than intercepted. Holding each request at the
     proxy would make the uploads observably slow — and would also stop the
     browser handing the body over, which is when `upload.onprogress` fires,
     so the bar would be truthfully indeterminate for the whole test and the
     thing under test would never run. Real requests, then, and big enough
     ones that six of them take a few seconds. */
  let inFlight = 0
  let mostAtOnce = 0
  let sent = 0
  const isUpload = request =>
    request.method() === 'POST' && /\/photos$/.test(new URL(request.url()).pathname)
  page.on('request', request => {
    if (!isUpload(request)) return
    sent += 1
    inFlight += 1
    mostAtOnce = Math.max(mostAtOnce, inFlight)
  })
  const landed = request => {
    if (isUpload(request)) inFlight -= 1
  }
  page.on('requestfinished', landed)
  page.on('requestfailed', landed)

  await page.goto(`/trips/${stack.trip.slug}`)
  await page.getByRole('button', { name: 'Add photos' }).first().click()
  await chooseSix(page)
  await expect(page.locator('.dlg .previews > span')).toHaveCount(HOW_MANY, { timeout: 60_000 })

  /* Every state the bar passes through, recorded in the page rather than
     sampled from out here. A bar read twice from a test is a bar racing the
     upload; this way a batch that finishes between two polls still leaves the
     whole series behind to be argued with. */
  await page.evaluate(() => {
    window.__barStates = []
    const look = () => {
      const track = document.querySelector('[role="progressbar"]')
      const bar = track?.closest('[role="status"]')
      if (!bar) return
      const value = track.getAttribute('aria-valuenow')
      const state = { value: value == null ? null : Number(value), text: bar.innerText }
      const last = window.__barStates[window.__barStates.length - 1]
      if (!last || last.value !== state.value || last.text !== state.text)
        window.__barStates.push(state)
    }
    window.__barWatch = new MutationObserver(look)
    window.__barWatch.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    look()
  })

  await page.getByRole('button', { name: `Add ${HOW_MANY}`, exact: true }).click()

  /* The bar, which is the whole complaint: an upload that says nothing is an
     upload that has stopped, as far as anybody looking at it can tell. */
  const bar = page.getByRole('status')
  await expect(bar).toBeVisible()
  await expect(bar).toContainText(`of ${HOW_MANY} photos`)

  // Done is gone: the photographs on the map say more than a tick would.
  await expect(bar).toHaveCount(0, { timeout: 120_000 })
  await page.evaluate(() => window.__barWatch?.disconnect())

  const states = await page.evaluate(() => window.__barStates)
  const numbers = states.map(state => state.value).filter(value => value != null)
  const captions = states.map(state => state.text)

  /* And they actually went up. Without this everything above would pass just
     as well on six photographs the server refused — which is exactly how the
     first draft of this test went, six times over. */
  expect(
    captions.filter(text => /did not go up/.test(text)),
    'the bar reported failures',
  ).toEqual([])

  /* It claimed a number rather than spinning. An indeterminate bar is honest
     when the browser will not say how big the body is, and a cop-out when it
     will. */
  expect(numbers.length, 'the bar never claimed a number').toBeGreaterThan(0)

  /* And the number moved. A bar that draws one number and then sits there is
     the same as no bar at all, which is what was being complained about. */
  expect(Math.max(...numbers), 'the bar never got past where it started').toBeGreaterThan(
    Math.min(...numbers),
  )
  expect(numbers.every((value, at) => at === 0 || value >= numbers[at - 1])).toBe(true)

  /* The count climbs through the whole batch rather than resetting as each
     one finishes — "1 of 12", then "1 of 11", was the shape of the old one. */
  const counted = captions
    .map(text => text.match(/Adding (\d+) of (\d+)/))
    .filter(Boolean)
    .map(found => [Number(found[1]), Number(found[2])])
  expect(counted.length, 'the bar never counted the batch').toBeGreaterThan(0)
  expect(
    counted.every(([, total]) => total === HOW_MANY),
    'the total shrank as photographs finished',
  ).toBe(true)
  expect(Math.max(...counted.map(([done]) => done))).toBeGreaterThan(1)

  expect(sent, 'every photograph was sent').toBe(HOW_MANY)
  expect(
    mostAtOnce,
    'more than one at a time, or twenty photographs take twenty turns',
  ).toBeGreaterThan(1)
  expect(
    mostAtOnce,
    'but not all of them at once, which is how a phone on one bar of signal saturates',
  ).toBeLessThanOrEqual(3)
})
