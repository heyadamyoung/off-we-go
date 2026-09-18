import { expect, test } from '@playwright/test'
import { leaveNoTrace } from './leave-no-trace.js'
import { stack } from './stack.js'

/* Thirty at once, against a real server.

   Reported from the road: choosing thirty or more and the app dies during the
   sending, with the photographs not arriving. The existing live spec sends
   six, which is under every limit worth having and has always been green —
   so whatever breaks at thirty has never been in front of a test.

   Real requests, real multipart, real resizing on the other end. What this
   holds to account is the only thing that matters to somebody standing in a
   hotel lobby: that the tab is still alive at the end of it, and that all
   thirty are on the trip. */

leaveNoTrace(test, stack)

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

const HOW_MANY = 30

/* Noise on a canvas, exported as a JPEG: an actual image, so it decodes, it
   resizes, and it does not compress away to nothing. A buffer of zeros
   between JPEG markers is a file the server refuses, which would prove
   something else entirely. Noise is the worst case for every codec, so
   these are kept small: thirty of them at fourteen hundred pixels across
   had the server resizing for most of the test. */
const chooseMany = (page, count) =>
  page.locator('.dlg input[type="file"]').evaluate(async (input, many) => {
    const canvas = document.createElement('canvas')
    canvas.width = 700
    canvas.height = 500
    const context = canvas.getContext('2d')
    const transfer = new DataTransfer()
    for (let index = 0; index < many; index++) {
      const pixels = context.createImageData(canvas.width, canvas.height)
      for (let at = 0; at < pixels.data.length; at += 4) {
        pixels.data[at] = Math.random() * 255
        pixels.data[at + 1] = Math.random() * 255
        pixels.data[at + 2] = Math.random() * 255
        pixels.data[at + 3] = 255
      }
      context.putImageData(pixels, 0, 0)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      const file = new File([blob], `many-${index}.jpg`, {
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
  }, count)

const onTheTrip = async page => {
  const response = await page.request.get(`${stack.apiBase}/trips/current?t=${stack.trip.slug}`, {
    headers: { authorization: `Bearer ${stack.accessToken}` },
  })
  expect(response.ok(), 'the trip could not be read back').toBe(true)
  return ((await response.json()).photos || []).length
}

test('thirty photographs all arrive, and the tab is alive at the end of it', async ({ page }) => {
  const started = await onTheTrip(page)
  const crashes = []
  const blewUp = []
  page.on('crash', () => crashes.push('the tab crashed'))
  page.on('pageerror', error => blewUp.push(String(error)))

  const refused = []
  page.on('response', response => {
    const { pathname } = new URL(response.url())
    if (response.request().method() === 'POST' && /\/photos$/.test(pathname) && !response.ok())
      refused.push(response.status())
  })

  await page.goto(`/trips/${stack.trip.slug}`)
  await page.getByRole('button', { name: 'Add photos' }).first().click()
  await chooseMany(page, HOW_MANY)
  await expect(page.locator('.dlg .previews > span')).toHaveCount(HOW_MANY, { timeout: 120_000 })

  await page.getByRole('button', { name: `Add ${HOW_MANY}`, exact: true }).click()
  await expect(page.locator('.dlg')).toHaveCount(0)

  // Gone means every one of them landed; the bar stays while anything is left.
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 150_000 })

  expect(crashes, 'the tab crashed').toEqual([])
  expect(blewUp, 'something threw in the page').toEqual([])
  expect(refused, 'the server refused some of them').toEqual([])

  /* And the trip actually holds them, which is the whole point of sending.
     Counted as a difference rather than matched by name: what comes back is a
     row with a signed media link on it, and the filename a browser gave the
     multipart is not part of it. */
  expect(await onTheTrip(page), 'not all thirty are on the trip').toBe(started + HOW_MANY)
})
