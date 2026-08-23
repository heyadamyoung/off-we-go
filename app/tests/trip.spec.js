import { test, expect } from '@playwright/test'

/* These cover the things that actually broke while the app was being built:
   double-created stops, a reorder that flung rows to the end, a photo viewer
   holding a stale snapshot, markers that stopped being clickable, and the map
   going blank mid-gesture. Each one is a regression guard, not a smoke test. */

const MAP_READY = 9000

async function open(page) {
  await page.goto('/')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.waitForTimeout(3500)                 // let tiles and markers settle
  const follow = page.locator('.wc.on')           // stop the camera drifting under us
  if (await follow.count()) await follow.click()
  await page.waitForTimeout(600)
}

const stopNames = page =>
  page.locator('.fcard .t b').allTextContents()

/* Getting a reliably clickable pin needs care: photo stacks are drawn above and
   to the right of their stop's pin, so at some zooms they cover neighbours. Fly
   to a stop that has no photos and it lands centred and uncovered every time.
   Hunting the DOM for "some pin that happens to be clear" is flaky. */
const PHOTOLESS = 'Bikes in Vondelpark'

async function centreOnStop(page, name) {
  await page.locator('.fdays button').first().click()      // all days
  await page.waitForTimeout(400)
  await page.locator('.fcard', { hasText: name }).first().click()
  await page.waitForTimeout(1800)
  const pin = await page.evaluate(n => {
    const p = [...document.querySelectorAll('.mstop')].find(x => (x.textContent || '').includes(n))
    if (!p) return null
    const q = p.querySelector('.pin').getBoundingClientRect()
    const c = { x: q.x + q.width / 2, y: q.y + q.height / 2 }
    return p.contains(document.elementFromPoint(c.x, c.y)) ? c : null
  }, name)
  return pin
}

test('loads the trip with map, markers and filmstrip', async ({ page }) => {
  await open(page)
  await expect(page.locator('.mstop')).toHaveCount(8)
  await expect(page.locator('.mstack')).toHaveCount(5)
  await expect(page.locator('.fcard').first()).toBeVisible()
  await expect(page.locator('.tflow')).toContainText('km walked')
})

test('a pin selects its stop, a drag does not', async ({ page }) => {
  await open(page)
  const pin = await centreOnStop(page, PHOTOLESS)
  expect(pin, 'expected the centred pin to be clickable').not.toBeNull()

  // clear the selection so the pin click has something to prove
  await page.locator('.herocard .x').click()
  await expect(page.locator('.herocard')).toHaveCount(0)

  await page.mouse.click(pin.x, pin.y)
  await expect(page.locator('.herocard h2')).toHaveText(PHOTOLESS)
  const after = await page.locator('.herocard h2').textContent()

  // dragging must pan without selecting whatever was underneath
  const box = await page.locator('.mapcanvas').boundingBox()
  const cx = box.x + box.width * 0.6, cy = box.y + box.height * 0.55
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 25; i++) await page.mouse.move(cx - i * 8, cy - i * 3)
  await page.mouse.up()
  await page.waitForTimeout(1000)
  expect(await page.locator('.herocard h2').textContent()).toBe(after)
})

test('adding a stop creates exactly one', async ({ page }) => {
  await open(page)
  const before = await page.locator('.mstop').count()

  await page.locator('.tbtn.ghost[title*="Edit"]').click()
  await expect(page.locator('.edithint')).toBeVisible()

  const box = await page.locator('.mapcanvas').boundingBox()
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.6)
  await expect(page.locator('.editor')).toBeVisible()
  await expect(page.locator('.editor .eh b')).toHaveText('New stop')

  await page.locator('.editor .f input').first().fill('Test Stop')
  await page.locator('.editor .btn.pri').click()
  await page.waitForTimeout(1200)

  await expect(page.locator('.mstop')).toHaveCount(before + 1)
  expect(await page.locator('.mstop .lab').filter({ hasText: 'Test Stop' }).count()).toBe(1)
})

test('reordering moves a stop one place and back', async ({ page }) => {
  await open(page)

  const pin = await centreOnStop(page, PHOTOLESS)
  expect(pin).not.toBeNull()
  const before = await stopNames(page)

  await page.locator('.tbtn.ghost[title*="Edit"]').click()
  await page.mouse.click(pin.x, pin.y)
  await expect(page.locator('.editor')).toBeVisible()
  await expect(page.locator('.editor .eh b')).toHaveText('Edit stop')

  await page.locator('.editor .ef .ord').first().click()
  await page.waitForTimeout(1000)
  const moved = await stopNames(page)
  expect(moved).not.toEqual(before)
  expect(moved.slice().sort()).toEqual(before.slice().sort())   // same set, new order

  await page.locator('.editor .ef .ord').nth(1).click()
  await page.waitForTimeout(1000)
  expect(await stopNames(page)).toEqual(before)
})

test('search matches a stop by its photo caption', async ({ page }) => {
  await open(page)
  await page.locator('.fsearch input').fill('bitterballen')
  await page.waitForTimeout(600)
  const names = await stopNames(page)
  expect(names).toEqual(['Foodhallen'])

  await page.locator('.fsearch input').fill('museum')
  await page.waitForTimeout(600)
  expect((await stopNames(page)).length).toBeGreaterThan(1)
})

test('editing a caption shows immediately in the open viewer', async ({ page }) => {
  await open(page)
  await page.locator('.tnav button[title="photos"]').click()
  await page.locator('.masonry .tile').first().click()
  await expect(page.locator('.viewer')).toBeVisible()

  const before = await page.locator('.vcap h2').textContent()
  await page.locator('.vedit input').fill('Recaptioned')
  await page.waitForTimeout(900)
  expect(await page.locator('.vcap h2').textContent()).toBe('Recaptioned')
  expect(before).not.toBe('Recaptioned')
})

test('deleting a photo removes it and keeps the viewer open', async ({ page }) => {
  await open(page)
  await page.locator('.tnav button[title="photos"]').click()
  await page.locator('.masonry .tile').first().click()
  await expect(page.locator('.viewer')).toBeVisible()

  const before = await page.locator('.vfilm button').count()
  // clicked through the DOM: the control sits at the very bottom of a fixed
  // panel, which Playwright's actionability check treats as out of view
  await page.evaluate(() => document.querySelector('.vedit .del').click())
  await page.waitForTimeout(1300)
  await expect(page.locator('.vfilm button')).toHaveCount(before - 1)
  await expect(page.locator('.viewer')).toBeVisible()
})

test('a comment posts and can be deleted again', async ({ page }) => {
  await open(page)
  await page.locator('.tnav button[title="photos"]').click()
  await page.locator('.masonry .tile').first().click()
  await expect(page.locator('.viewer')).toBeVisible()

  const before = await page.locator('.cmt').count()
  await page.locator('.vinput input').fill('Lovely.')
  await page.locator('.vinput input').press('Enter')
  await expect(page.locator('.cmt')).toHaveCount(before + 1)

  await page.evaluate(() => document.querySelector('.cmt .cdel').click())
  await expect(page.locator('.cmt')).toHaveCount(before)
})

test('the map keeps something painted through zoom and pan', async ({ page }) => {
  await open(page)
  const painted = () => page.evaluate(() => {
    const c = document.querySelector('.mapcanvas').getBoundingClientRect()
    const canvas = document.querySelector('.mapcanvas canvas')
    if (!canvas) return 0
    const q = canvas.getBoundingClientRect()
    return q.width >= c.width - 2 && q.height >= c.height - 2 ? 100 : 0
  })

  for (let i = 0; i < 4; i++) {
    await page.locator('.wctl .wc').first().click()
    await page.waitForTimeout(220)
    expect(await painted()).toBe(100)
  }
  const box = await page.locator('.mapcanvas').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 25; i++) await page.mouse.move(cx - i * 9, cy - i * 4)
  await page.mouse.up()
  await page.waitForTimeout(900)
  expect(await painted()).toBe(100)
})

test('theme choice survives a reload', async ({ page }) => {
  await open(page)
  await page.locator('.tbtn.ghost[title^="Theme"]').click()
  await page.waitForTimeout(2200)
  const chosen = await page.evaluate(() => document.body.dataset.theme)
  await page.reload()
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  expect(await page.evaluate(() => document.body.dataset.theme)).toBe(chosen)
})

test('the roster lists people and takes an invite', async ({ page }) => {
  await open(page)
  await page.locator('.tbtn.hot').click()
  await expect(page.locator('.modal')).toBeVisible()
  expect(await page.locator('.rperson').count()).toBeGreaterThan(0)

  const before = await page.locator('.rperson').count()
  await page.locator('.invite input').first().fill('Grandma Jo')
  await page.locator('.invite input[type=email]').fill('jean@example.com')
  await page.locator('.invite .btn.pri').click()
  await expect(page.locator('.rperson.pend')).toHaveCount(1)
  await page.locator('.rperson.pend .rm').click()
  await expect(page.locator('.rperson')).toHaveCount(before)
})

test('finding a place fills in its name, description and picture', async ({ page }) => {
  await open(page)
  await page.locator('.fdays button').first().click()
  await page.locator('.fcard', { hasText: 'Rijksmuseum' }).first().click()
  await page.waitForTimeout(1800)

  await page.locator('.tbtn.ghost[title*="Edit"]').click()
  await page.getByRole('button', { name: 'Find places' }).click()
  await expect(page.locator('.mfind').first()).toBeVisible({ timeout: 20_000 })

  // Real destinations, not the streets and neighbourhoods geosearch also returns.
  const names = await page.locator('.mfind span').allTextContents()
  expect(names.length).toBeGreaterThan(2)
  expect(names.join(' ')).not.toMatch(/straat|neighbourhood|district/i)

  const before = await page.locator('.mstop').count()
  await page.locator('.mfind').first().click()
  await expect(page.locator('.editor')).toBeVisible()

  await expect(page.locator('.editor .f input').first()).not.toHaveValue('')
  await expect(page.locator('.editor textarea')).not.toHaveValue('')
  await expect(page.locator('.editor .epic img')).toBeVisible({ timeout: 15_000 })
  // the day filter's "all" sentinel must never land in a real field
  await expect(page.locator('.editor .frow .f input').first()).not.toHaveValue(/all-days/)

  await page.locator('.editor .btn.pri').click()
  await expect(page.locator('.mstop')).toHaveCount(before + 1)
  // a stop with no time used to crash the filmstrip on render
  await expect(page.locator('.ticker')).toBeVisible()
  await expect(page.locator('.fcard').first()).toBeVisible()
})

test('stops without a picture get a real one on load', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.waitForTimeout(14_000)          // load, then the lookups land
  await page.locator('.fdays button').first().click()
  await page.waitForTimeout(800)

  const names = await stopNames(page)
  let real = 0
  for (const n of names) {
    await page.locator('.fcard', { hasText: n }).first().click()
    await page.waitForTimeout(700)
    const src = await page.locator('.herocard img.hero').getAttribute('src')
    if (/wikimedia/.test(src || '')) real++
  }
  // Not all of them: two of the sample stops have no article and one is not a
  // place at all. Matching is strict on purpose — a wrong photograph of the
  // building next door is worse than the placeholder.
  expect(real).toBeGreaterThanOrEqual(4)
})
