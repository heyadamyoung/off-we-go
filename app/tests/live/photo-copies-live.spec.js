import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { leaveNoTrace } from './leave-no-trace.js'

/* The right copy of a photograph, and the next one already on the screen.
 *
 * The server has made two of every picture since uploads began: a display
 * copy 2048 across and a small one 480 across. The client asked for the big
 * one everywhere — sixty grid tiles, a map marker forty pixels wide, the
 * little strip along the bottom of the viewer — because the field carrying
 * the small one was on the wire, in the types, and used by nothing.
 *
 * That is why paging looked like loading. It was: the photograph somebody
 * was actually looking at came down a phone connection behind a screenful of
 * thumbnails that were each a megapixel, so the one ahead had not arrived by
 * the time they swiped to it, and it faded up in front of them.
 *
 * Sample mode cannot ask this. Nothing there has a second copy, because
 * nothing there has ever been to a server.
 */

const stack = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../dist/live-stack.json'), 'utf8'),
)

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

/* Four real photographs, each a different colour so a swap between them is
   visible to a person and to a pixel reader alike. Drawn rather than
   fabricated: the server resizes with a real decoder and refuses anything it
   cannot read. */
const chooseFour = (page, day) =>
  page.locator('.dlg input[type="file"]').evaluate(async (input, when) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1600
    canvas.height = 1200
    const context = canvas.getContext('2d')
    const transfer = new DataTransfer()
    const colours = ['#c8464a', '#46c87a', '#4a6ac8', '#c8a246']
    for (let index = 0; index < colours.length; index++) {
      context.fillStyle = colours[index]
      context.fillRect(0, 0, 1600, 1200)
      context.fillStyle = '#ffffff'
      context.fillRect(120 * index, 0, 100, 1200)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      const file = new File([blob], `copies-${index}.jpg`, {
        type: 'image/jpeg',
        lastModified: 1_700_000_000_000 + index,
      })
      Object.defineProperty(file, 'offwegoMetadata', { value: { takenAt: when } })
      transfer.items.add(file)
    }
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, day)

test('the grid draws the small copy, and the viewer has the next one already', async ({ page }) => {
  const when = `${stack.trip.startsOn || '2026-09-05'}T09:00:00.000Z`

  await page.goto(`/trips/${stack.trip.slug}`)
  await page.getByRole('button', { name: 'Add photos' }).first().click()
  await chooseFour(page, when)
  await expect(page.locator('.dlg .previews > span')).toHaveCount(4, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Add 4', exact: true }).click()
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 120_000 })

  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  const tiles = page.locator('.pgrid-photo img.im')
  await expect(tiles.first()).toBeVisible({ timeout: 30_000 })

  /* A grid tile is a hundred and fifty pixels across. Asking for the 2048 is
     ten times the bytes for detail nobody can see, down the same connection
     the photograph being looked at has to come. */
  const drawn = await tiles.evaluateAll(images =>
    images.map(image => (image.currentSrc || image.src).replace(/\?.*$/, '')),
  )
  expect(drawn.length, 'the gallery drew nothing').toBeGreaterThan(0)
  expect(
    drawn.every(src => src.endsWith('.thumb.jpg')),
    `the gallery is still asking for full-size copies: ${drawn.slice(0, 3).join(' ')}`,
  ).toBe(true)

  /* And in the viewer the two either side are already decoded — that is the
     whole claim behind a strip of three, and the thing a person means when
     they say the next picture "should already be there". */
  await page.locator('.pgrid-photo').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 15_000 })

  const ready = async () =>
    page.locator('.vpane img.main').evaluateAll(images =>
      images.map(image => ({
        middle: !!image.closest('.vpane.on'),
        complete: image.complete && image.naturalWidth > 0,
        /* `up` is the arrival fade, and it is only ever put on a picture that
           kept somebody waiting. On one that was already in hand it is the
           thing that made a preloaded strip look exactly like loading. */
        fading: image.classList.contains('up'),
      })),
    )

  await expect
    .poll(async () => (await ready()).every(pane => pane.complete), {
      timeout: 30_000,
      message: 'a photograph beside the one on screen had not loaded before the swipe',
    })
    .toBe(true)

  // Page on, and the one that arrives is the one that was already there.
  await page.locator('.vnav.n').click()
  await expect(page.locator('.vcap .ct')).toHaveText(/^2 of/, { timeout: 15_000 })
  const arrived = (await ready()).find(pane => pane.middle)
  expect(arrived?.complete, 'the photograph that arrived was being fetched as it landed').toBe(true)
  expect(arrived?.fading, 'a photograph that was already loaded faded in anyway').toBe(false)
})
