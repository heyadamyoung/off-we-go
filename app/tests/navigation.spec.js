import { test, expect } from '@playwright/test'

/* The shell: which URL shows what, and that the pieces around the trip screen
   survive a direct visit and a narrow phone. */

test.describe.configure({ mode: 'parallel' })
test.beforeEach(async ({ page }) => {
  await page.route('https://en.wikipedia.org/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
  }))
})

const MAP_READY = 9000

test('home leads with a trip and does not open it by itself', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Amsterdam Weekend' })).toBeVisible()
  await expect(page.locator('.mapcanvas')).toHaveCount(0, 'the globe is not the trip map')
  await expect(page.locator('.world canvas')).toBeVisible({ timeout: MAP_READY })

  await page.getByRole('link', { name: 'Open the trip' }).click()
  await expect(page).toHaveURL('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
})

test('an ordinary trip link carries no query string', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Open the trip' }).click()
  await expect(page).toHaveURL('/trips/sample')
})

test('human-readable trip and user URLs survive direct navigation', async ({ page }) => {
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await expect(page.getByRole('heading', { name: 'Amsterdam Weekend' })).toBeVisible()

  await page.goto('/users/maya')
  await expect(page.getByRole('heading', { name: 'Maya' })).toBeVisible()
  await expect(page.getByText('@maya')).toBeVisible()
})

test('an unavailable profile stays private and offers a way back', async ({ page }) => {
  await page.goto('/users/nobody-here')
  await expect(page.getByRole('heading', { name: 'Profile unavailable' })).toBeVisible()
  await expect(page.getByText(/do not share a trip/i)).toBeVisible()
  await page.getByRole('link', { name: 'Back to your trips' }).click()
  await expect(page).toHaveURL('/')
})

test('legacy trip query links are replaced with the canonical trip URL', async ({ page }) => {
  await page.goto('/?t=sample')
  await expect(page).toHaveURL('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
})

test('the account menu reaches every screen that is not a trip', async ({ page }) => {
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })

  await page.getByRole('button', { name: 'Account' }).first().click()
  await page.getByRole('menuitem', { name: 'Profile & settings' }).click()
  await expect(page).toHaveURL('/profile')
  await expect(page.getByRole('heading', { name: /^Profile/ }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Account' }).first().click()
  await page.getByRole('menuitem', { name: 'Your trips' }).click()
  await expect(page).toHaveURL('/')
})

test('the settings page keeps its notification and privacy choices in the URL-free store', async ({ page }) => {
  await page.goto('/profile')
  const digest = page.getByText('Daily digest while a trip is live')
  await expect(digest).toBeVisible()

  const row = page.locator('label.sw', { hasText: 'Daily digest' })
  const toggle = row.locator('input')
  await expect(toggle).not.toBeChecked()
  await row.click()
  await expect(toggle).toBeChecked()

  // Privacy defaults to the middle option rather than the most open one.
  await expect(page.locator('label', { hasText: "People I've travelled or followed with" })
    .locator('input')).toBeChecked({ timeout: 5000 })
})

test('the new trip wizard walks three steps and can be left at any of them', async ({ page }) => {
  await page.goto('/new')
  await expect(page.getByRole('heading', { name: 'Where to?' })).toBeVisible()

  const next = page.getByRole('button', { name: /Continue/ })
  await expect(next).toBeDisabled()
  await page.getByPlaceholder('Where are you off to?').fill('Lisbon in spring')
  await next.click()

  await expect(page).toHaveURL('/new?step=2')
  await expect(page.getByRole('heading', { name: "Who's coming?" })).toBeVisible()
  await page.getByRole('button', { name: /Continue/ }).click()

  await expect(page).toHaveURL('/new?step=3')
  await expect(page.getByRole('heading', { name: 'Almost there.' })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveURL('/new?step=2')
})

test('invitations and past trips are their own pages, reachable from home', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /Invitations/ }).click()
  await expect(page).toHaveURL('/invitations')
  await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible()
  await expect(page.getByText('Nothing waiting.')).toBeVisible()

  await page.goto('/')
  await page.getByRole('link', { name: /Past trips/ }).click()
  await expect(page).toHaveURL('/past')
  await expect(page.getByRole('heading', { name: 'Past trips' })).toBeVisible()
})

test('publishes the Off We Go mark for browser and installed web app icons', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.ico')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/site.webmanifest')

  for (const path of ['/favicon.ico', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png']) {
    const response = await request.get(path)
    expect(response.status(), path).toBe(200)
  }
})

test('the dashboard keeps its brandmark compact beside the wordmark', async ({ page }) => {
  await page.goto('/')
  const brandmark = page.getByRole('link', { name: 'Off We Go' }).locator('img')
  await expect(brandmark).toBeVisible()

  const bounds = await brandmark.boundingBox()
  expect(bounds?.height).toBeLessThanOrEqual(48)
})

test('the viewport allows pinch zoom and covers the notch', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content', 'width=device-width, initial-scale=1, viewport-fit=cover')
})

test('an OIDC browser return can hand sign-in back to the installed app', async ({ page }) => {
  await page.goto('/auth/native?token=handoff-token-value-long-enough-to-be-real')
  await expect(page.getByRole('heading', { name: 'Open Off We Go' })).toBeVisible()
  const open = page.getByRole('link', { name: 'Open Off We Go app' })
  await expect(open).toHaveAttribute('href', /^wayfare:\/\/auth\?token=handoff-token-value-long-enough-to-be-real$/)
  await expect(page.getByRole('link', { name: 'Sign in on the website instead' }))
    .toHaveAttribute('href', '/auth/callback?token=handoff-token-value-long-enough-to-be-real')
})

test('a failed sign-in return explains itself rather than looping', async ({ page }) => {
  await page.goto('/auth/native?error=access_denied')
  await expect(page.getByRole('heading', { name: 'Sign-in did not finish' })).toBeVisible()
  // The app is still offered, so it can show the same failure and start again.
  await expect(page.getByRole('link', { name: 'Sign in on the website instead' })).toBeVisible()
})

/* The shell is prerendered into index.html and hydrated on arrival. When the
   two disagree React throws the prerendered markup away and rebuilds the page
   from scratch — which still looks right, so nothing catches it but this. */
test('the prerendered shell hydrates instead of being thrown away', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto('/')
  // Hydration runs once the bundle has landed, which is well after `goto`
  // resolves — assert too early and this passes against a broken build.
  await expect(page.locator('#root')).not.toBeEmpty()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  const react = errors.filter(message => /Minified React error|hydrat/i.test(message))
  expect(react, 'React rejected the prerendered shell and client-rendered instead').toEqual([])
})

test('form controls do not trigger Safari focus zoom on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/profile')
  const input = page.locator('input:visible').first()
  await expect(input).toBeVisible()
  const size = await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
  expect(size, 'a control below 16px makes iOS zoom the viewport').toBeGreaterThanOrEqual(16)
})

test('no screen creates a wider layout than the phone it is on', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/', '/profile', '/new', '/past', '/invitations']) {
    await page.goto(path)
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1)
  }
})
