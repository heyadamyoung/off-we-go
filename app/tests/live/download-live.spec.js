import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { leaveNoTrace } from './leave-no-trace.js'

/* Saving the photograph you are looking at.
 *
 * This exists because the button it clicks shipped once with no onClick on it
 * at all, and nothing noticed — a control can look completely right in a
 * screenshot, in a unit test and in a type checker while doing nothing
 * whatsoever. The only thing that can tell the difference is a browser that
 * either receives a file or does not.
 *
 * So the assertion is the download event itself, and the name on it, which
 * has come the whole way: the viewer built it from the caption, put it in the
 * query, the server scrubbed it into a Content-Disposition header, and the
 * browser read it back off the wire.
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

test('the viewer hands back a real file, named after the photograph', async ({ page }) => {
  await page.goto(`/trips/${stack.trip.slug}`)
  await page.getByRole('button', { name: 'Add photos' }).first().click()
  await page.locator('.dlg input[type="file"]').evaluate(async input => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 900
    const context = canvas.getContext('2d')
    context.fillStyle = '#2f7d5b'
    context.fillRect(0, 0, 1200, 900)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'keepsake.jpg', { type: 'image/jpeg' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.locator('.dlg .previews > span')).toHaveCount(1, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Add 1', exact: true }).click()
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 60_000 })

  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.locator('.pgrid-photo').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 15_000 })

  const arriving = page.waitForEvent('download', { timeout: 30_000 })
  /* Watched from before the click, because a success toast clears itself
     after three seconds and reading the saved file takes longer than that. */
  const told = expect(page.locator('.toast.success')).toContainText('Saved', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Save this photo' }).click()
  const file = await arriving
  await told

  /* No caption was typed, so the name falls back to the app's own — but the
     date and the tail of the id are the photograph's, which is what stops two
     saved pictures from becoming one file on a phone. */
  expect(file.suggestedFilename()).toMatch(/^off-we-go-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}\.jpg$/)

  /* And there are bytes behind it. A download event fires for a failed
     download too, so the file itself has to be opened to mean anything. */
  const saved = await file.path()
  const bytes = readFileSync(saved)
  expect(bytes.length, 'the download was empty').toBeGreaterThan(1000)
  // Every photograph is re-encoded to JPEG on the way in, so this is one.
  expect(bytes[0], 'that is not a JPEG').toBe(0xff)
  expect(bytes[1]).toBe(0xd8)
})
