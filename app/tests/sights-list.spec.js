import { expect, test } from './fixture.js'
import { atDemoTime } from './demo-clock'
import { serveWikipedia } from './wikipedia-fixture.js'

/* The Sights panel as a list: a word narrows it, the sort is what it says
   and is remembered, the count says what is shown of what was found, and
   the ones already on the trip can be hidden. Wikipedia is answered from
   the fixture: six Amsterdam landmarks with their readership. */

const MAP_READY = 9000

test.beforeEach(async ({ page }) => {
  await serveWikipedia(page)
})

async function openSights(page) {
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.getByRole('button', { name: 'Sights', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sights', exact: true })).toBeVisible()
  await expect(page.locator('.sight').first()).toBeVisible({ timeout: 25000 })
}

const names = page => page.locator('.sight .sname').allInnerTexts()

test('the sights are found by a word, sorted as asked, and counted', async ({ page }) => {
  await openSights(page)
  /* Most visited first, as the search ranks them. */
  const popular = await names(page)
  expect(popular[0]).toBe('Rijksmuseum')
  expect(popular).toHaveLength(6)
  await expect(page.locator('.scount')).toHaveText('6 sights')

  await page.getByLabel('Filter the sights').fill('museum')
  await expect(page.locator('.sight')).toHaveCount(3)
  await expect(page.locator('.scount')).toHaveText('3 of 6 sights')
  expect(await names(page)).toEqual(['Rijksmuseum', 'Anne Frank House', 'Van Gogh Museum'])

  await page.getByLabel('Filter the sights').fill('nothing of the sort')
  await expect(page.locator('.sight')).toHaveCount(0)
  await expect(page.getByText('Nothing here matches “nothing of the sort”.')).toBeVisible()
  await page.getByLabel('Filter the sights').fill('')

  await page.getByLabel('Sort the sights').selectOption('name')
  expect(await names(page)).toEqual([
    'Amsterdam Centraal station',
    'Anne Frank House',
    'Rijksmuseum',
    'Van Gogh Museum',
    'Vondelpark',
    'Westerkerk',
  ])
  await page.getByLabel('Sort the sights').selectOption('kind')
  expect((await names(page))[0]).toBe('Van Gogh Museum') // "Art museum" sorts first by kind

  /* Remembered: the panel opens the way it was left. */
  await page.reload()
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.getByRole('button', { name: 'Sights', exact: true }).click()
  await expect(page.locator('.sight').first()).toBeVisible({ timeout: 25000 })
  await expect(page.getByLabel('Sort the sights')).toHaveValue('kind')
})

test('the sights already on the trip can be hidden, and the count says so', async ({ page }) => {
  await openSights(page)
  /* The sample trip already visits the Rijksmuseum and the Vondelpark. */
  const rijks = page.locator('.sight').filter({ hasText: 'Rijksmuseum' })
  await expect(rijks.getByRole('button', { name: 'In your trip' })).toBeVisible()
  const hide = page.getByLabel(/Hide the \d+ on the trip/)
  await expect(hide).toBeVisible()
  await hide.check()
  await expect(rijks).toHaveCount(0)
  await expect(page.locator('.scount')).toContainText('of 6 sights')
  await hide.uncheck()
  await expect(rijks).toHaveCount(1)
})
