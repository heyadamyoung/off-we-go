import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { leaveNoTrace } from './leave-no-trace.js'

/* One photograph, out of the trip and onto the open web.
 *
 * The server suite proves the routes against an in-memory repository. This
 * proves the parts that only exist for real: the migration that made the
 * table, the SQL that reads and revokes through it, and a public fetch that
 * carries no session at all.
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

test('a shared photograph is readable with no session, until it is taken back', async ({
  page,
  request,
}) => {
  await page.goto(`/trips/${stack.trip.slug}`)
  await page.getByRole('button', { name: 'Add photos' }).first().click()
  await page.locator('.dlg input[type="file"]').evaluate(async input => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 900
    const context = canvas.getContext('2d')
    context.fillStyle = '#c8464a'
    context.fillRect(0, 0, 1200, 900)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'shared.jpg', { type: 'image/jpeg' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.locator('.dlg .previews > span')).toHaveCount(1, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Add 1', exact: true }).click()
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 60_000 })

  const auth = { authorization: `Bearer ${stack.accessToken}` }
  const trip = await (
    await page.request.get(`${stack.apiBase}/trips/current?t=${stack.trip.slug}`, { headers: auth })
  ).json()
  const photo = trip.photos[0]
  expect(photo, 'nothing was uploaded to share').toBeTruthy()

  const where = `${stack.apiBase}/trips/${stack.trip.id}/photos/${photo.id}/share`
  const made = await page.request.post(where, { headers: auth })
  expect(made.status()).toBe(200)
  const { url } = await made.json()
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{20,}$/)

  /* `request` is a context of its own: no session, no cookie, nothing this
     trip ever handed out. Which is the whole claim. */
  const page404 = new URL(url).pathname
  const seen = await request.get(`${stack.webOrigin}${page404}`)
  expect(seen.status()).toBe(200)
  const html = await seen.text()
  /* Something only the share page says. og:image alone was not enough: the
     app shell carries one too, so this test passed against the SPA fallback
     until the live stack learned to route /s the way Caddy does. */
  expect(html, 'that is the app shell, not the share page').toMatch(
    /<meta name="robots" content="noindex, nofollow">/,
  )
  expect(html).toMatch(/<meta property="og:image" content="[^"]+\/media">/)

  const media = await request.get(`${stack.webOrigin}${page404}/media`)
  expect(media.status()).toBe(200)
  expect(media.headers()['content-type']).toContain('image/')

  // And taken back means taken back, page and picture both.
  const gone = await page.request.delete(where, { headers: auth })
  expect(gone.status()).toBe(200)
  expect((await request.get(`${stack.webOrigin}${page404}`)).status()).toBe(404)
  expect((await request.get(`${stack.webOrigin}${page404}/media`)).status()).toBe(404)
})
