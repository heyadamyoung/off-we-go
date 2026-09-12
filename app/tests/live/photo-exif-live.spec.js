import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { leaveNoTrace } from './leave-no-trace.js'

/* Where a photograph says it was taken, against where it was uploaded from.
 *
 * This is the bug in one test. A picture carrying Amsterdam in its EXIF is
 * chosen on a device sitting in London, and it has to land in Amsterdam. It
 * used to land in London: the iOS picker re-encoded the image and lost the
 * block, the client could not tell that from a picture that never had one, and
 * so it offered the only position it had — the current one — and the server
 * took it.
 *
 * Both halves of the repair are load-bearing here and neither is enough alone.
 * The client has to stop passing off the upload position as the answer, and
 * the server has to read the file for itself. Only a real browser talking to a
 * real server exercises the pair.
 */

const stack = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../dist/live-stack.json'), 'utf8'),
)

const AMSTERDAM = { lat: 52.3620666, lng: 4.8852888 }
const LONDON = { latitude: 51.5072, longitude: -0.1276 }

/* libvips numbers the blocks: IFD2 is the Exif IFD, IFD3 is GPS. */
const amsterdamPhotograph = () =>
  sharp({ create: { width: 1200, height: 900, channels: 3, background: '#2f7d5b' } })
    .withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone' },
      IFD2: { DateTimeOriginal: '2026:09:05 14:22:31' },
      IFD3: {
        GPSLatitude: '52/1 21/1 4344/100',
        GPSLatitudeRef: 'N',
        GPSLongitude: '4/1 53/1 704/100',
        GPSLongitudeRef: 'E',
      },
    })
    .jpeg()
    .toBuffer()

leaveNoTrace(test, stack)

/* The device is in London and will say so when asked, which is what makes the
   assertion mean something: there is a wrong answer available and close to
   hand. */
test.use({ geolocation: LONDON, permissions: ['geolocation'] })

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

test('a photograph is filed where it was taken, not where it was uploaded', async ({ page }) => {
  const bytes = (await amsterdamPhotograph()).toString('base64')

  await page.goto(`/trips/${stack.trip.slug}`)
  await page.getByRole('button', { name: 'Add photos' }).first().click()
  await page.locator('.dlg input[type="file"]').evaluate((input, base64) => {
    const binary = atob(base64)
    const buffer = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i)
    const transfer = new DataTransfer()
    transfer.items.add(new File([buffer], 'amsterdam.jpg', { type: 'image/jpeg' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, bytes)
  await expect(page.locator('.dlg .previews > span')).toHaveCount(1, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Add 1', exact: true }).click()
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 60_000 })

  const auth = { authorization: `Bearer ${stack.accessToken}` }
  const trip = await (
    await page.request.get(`${stack.apiBase}/trips/current?t=${stack.trip.slug}`, { headers: auth })
  ).json()
  const photo = trip.photos.find(value => value.caption !== undefined || true)
  expect(photo, 'nothing was uploaded').toBeTruthy()

  expect(Math.abs(photo.lat - AMSTERDAM.lat), `filed at ${photo.lat}, ${photo.lng}`).toBeLessThan(
    0.001,
  )
  expect(Math.abs(photo.lng - AMSTERDAM.lng)).toBeLessThan(0.001)
  /* And not merely "somewhere that is not London" — the position has to have
     come from the file, and say so. */
  expect(photo.locationSource).toBe('exif')
  expect(Math.abs(photo.lat - LONDON.latitude)).toBeGreaterThan(0.5)
})
