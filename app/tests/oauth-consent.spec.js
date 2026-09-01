import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { buildServer } from '../server/src/app.js'
import { createMemoryRepository } from '../server/test/memory-repository.js'

const root = 'https://offwego.example.com'

async function disclosureContrast(page, foreground, background) {
  const [color, surface] = await Promise.all([
    page.locator(foreground).first().evaluate(element => getComputedStyle(element).color),
    page.locator(background).first().evaluate(element => getComputedStyle(element).backgroundColor),
  ])
  const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number)
  const luminance = value => {
    const linear = channels(value).map(channel => {
      const component = channel / 255
      return component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4
    })
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]
  }
  const [lighter, darker] = [luminance(color), luminance(surface)].sort((a, b) => b - a)
  return (lighter + .05) / (darker + .05)
}

async function expectReadableDisclosures(page) {
  for (const [foreground, background] of [
    ['.unverified', '.unverified'],
    ['.connection-route span', '.connection-route'],
    ['.technical-details summary', '.card'],
    ['.label', '.card'],
    ['.fine', '.card'],
  ]) expect(await disclosureContrast(page, foreground, background)).toBeGreaterThanOrEqual(4.5)
}

async function hostConsent() {
  const app = await buildServer({
    repository: createMemoryRepository({ allowedEmails: ['owner@example.com'] }),
    mailer: { async send() {} },
    publicUrl: root,
    sessionSecret: 'test-secret-that-is-long-enough',
  })
  app.get('/offwego-icon.png', async (_request, reply) => reply.type('image/png')
    .send(await readFile(new URL('../public/offwego-icon.png', import.meta.url))))
  const registration = await app.inject({
    method: 'POST',
    url: '/oauth/register',
    payload: {
      client_name: 'Codex Desktop',
      redirect_uris: ['http://127.0.0.1:3210/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  })
  const verifier = 'offwego-test-pkce-verifier-that-is-more-than-forty-three-characters'
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: registration.json().client_id,
    redirect_uri: 'http://127.0.0.1:3210/callback',
    scope: 'trips:read trips:write',
    state: 'client-state',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: `${root}/mcp`,
  })
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  return { app, client: registration.json(), url: `${address}/oauth/authorize?${query}` }
}

test('uses Off We Go styling and keeps permission controls aligned', async ({ page }) => {
  const fixture = await hostConsent()
  try {
    const response = await page.goto(fixture.url)
    expect(response.headers()['content-security-policy']).toContain("img-src 'self'")

    await expect.poll(() => page.locator('.brand img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
    await expect(page.locator('.approve')).toHaveCSS('background-color', 'rgb(255, 122, 61)')
    await expect(page.locator('.connection-route')).toContainText('Returns to Codex Desktop on this device')
    await expect(page.locator('.connection-route')).toContainText('http://127.0.0.1:3210')
    await expect(page.locator('.technical-details')).not.toHaveAttribute('open', '')
    await expect(page.locator('.technical-details')).toContainText(fixture.client.client_id)
    await expectReadableDisclosures(page)

    for (const row of await page.locator('.permission').all()) {
      const [rowBox, iconBox, glyphBox, controlBox] = await Promise.all([
        row.boundingBox(),
        row.locator('.permission-icon').boundingBox(),
        row.locator('.permission-icon svg').boundingBox(),
        row.locator('input[type=checkbox]').boundingBox(),
      ])
      expect(rowBox && iconBox && glyphBox && controlBox).toBeTruthy()
      expect(Math.abs(iconBox.x + iconBox.width / 2 - (glyphBox.x + glyphBox.width / 2))).toBeLessThan(1)
      expect(Math.abs(iconBox.y + iconBox.height / 2 - (glyphBox.y + glyphBox.height / 2))).toBeLessThan(1)
      expect(Math.abs(rowBox.y + rowBox.height / 2 - (controlBox.y + controlBox.height / 2))).toBeLessThan(1)
      expect(controlBox.width).toBeGreaterThanOrEqual(24)
      expect(controlBox.height).toBeGreaterThanOrEqual(24)
    }

    const writeScope = page.locator('#write-scope')
    await writeScope.focus()
    await expect(writeScope).toHaveCSS('outline-style', 'solid')

    await page.evaluate(() => localStorage.setItem('wf-theme', 'light'))
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(238, 241, 245)')
    await expectReadableDisclosures(page)
    await page.locator('.message').evaluate(element => { element.textContent = 'Authorization failed.' })
    expect(await disclosureContrast(page, '.message', '.card')).toBeGreaterThanOrEqual(4.5)
    await page.locator('.identity').evaluate(element => element.classList.add('good'))
    expect(await disclosureContrast(page, '.identity.good', '.identity.good')).toBeGreaterThanOrEqual(4.5)
    const loginButton = page.getByRole('link', { name: 'Continue to sign in' })
    await expect(loginButton).toHaveAttribute('href', /^\/\?continue=%2Foauth%2Fauthorize/)
    await loginButton.hover()
    expect(await disclosureContrast(page, '.login a', '.login a')).toBeGreaterThanOrEqual(4.5)

    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    await fixture.app.close()
  }
})
