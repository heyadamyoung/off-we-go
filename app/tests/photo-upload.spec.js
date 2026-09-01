import { test, expect } from '@playwright/test'

test('selected photo thumbnails reveal their location source and expected map placement', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ longitude: 4.8686, latitude: 52.3664 })
  await page.route('https://en.wikipedia.org/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
  }))
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await page.getByRole('button', { name: 'Add photos' }).click()

  await page.locator('.dlg input[type="file"]').evaluate(input => {
    const tagged = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'tagged.jpg', { type: 'image/jpeg' })
    Object.defineProperty(tagged, 'offwegoMetadata', { value: {
      lng: -3.1883, lat: 55.9533, takenAt: '2026-08-31T12:00:00.000Z',
    } })
    const untagged = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'untagged.jpg', { type: 'image/jpeg' })
    Object.defineProperty(untagged, 'offwegoMetadata', { value: {
      takenAt: '2026-08-30T12:00:00.000Z',
    } })
    const transfer = new DataTransfer()
    transfer.items.add(tagged); transfer.items.add(untagged)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })

  await expect(page.getByText('Embedded photo GPS')).toBeVisible()
  await expect(page.getByText('55.9533° N, 3.1883° W')).toBeVisible()
  await expect(page.locator('.dlg .mapcanvas canvas')).toBeVisible()

  await page.getByRole('button', { name: 'Inspect selected photo 2' }).click()
  await expect(page.getByText('No embedded GPS')).toBeVisible()
  await expect(page.getByText('Trip history will be checked first; the current phone position shown here is the fallback.')).toBeVisible()
})
