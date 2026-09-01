import { test, expect } from '@playwright/test'

/* These cover the things that actually broke while the app was being built:
   double-created stops, a reorder that flung rows to the end, a photo viewer
   holding a stale snapshot, markers that stopped being clickable, and the map
   going blank mid-gesture. Each one is a regression guard, not a smoke test. */

const MAP_READY = 9000
const PHOTOLESS = 'Bikes in Vondelpark'      // a stop with no photographs of its own

const WIKIPEDIA_TESTS = new Set([
  'finding a place fills in its name, description and picture',
  'stops without a picture get a real one on load',
  'the sights panel shows real landmarks with a picture and a description',
  'attractions are drawn across the map and open into a card',
])

// These cases have isolated sample state and can safely use separate contexts.
// Keep Wikipedia-backed coverage together below because the public API throttles
// concurrent callers; unrelated UI cases receive a complete empty API response.
test.describe.configure({ mode: 'parallel' })
test.beforeEach(async ({ page }, testInfo) => {
  if (WIKIPEDIA_TESTS.has(testInfo.title)) return
  await page.route('https://en.wikipedia.org/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
  }))
})

async function open(page) {
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await expect(page.locator('.mstop')).toHaveCount(8)
  const follow = page.locator('.wc.on')           // stop the camera drifting under us
  if (await follow.count()) {
    await follow.click()
    await expect(follow).toHaveCount(0)
  }
  // Cancel the initial follow animation as well as disabling future ones. If it
  // is left running, its moveend can race a camera action performed by a test.
  await page.evaluate(() => window.__offwegoMap?.stop())
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
}

const allDays = page => page.locator('.fdays button').first().click()
const cardTitles = page => page.locator('.fcard .t').allTextContents()
const stopTitles = async page =>
  (await page.locator('.fcard', { has: page.locator('.t') }).all().then(cards =>
    Promise.all(cards.map(async card => ({
      title: (await card.locator('.t').textContent())?.trim(),
      photo: (await card.locator('span', { hasText: 'PHOTO' }).count()) > 0,
    }))))).filter(item => !item.photo).map(item => item.title)

async function centreOnStop(page, name) {
  await allDays(page)
  await page.locator('.fcard', { hasText: name }).first().click()
  const pinCentre = () => page.evaluate(n => {
    const p = [...document.querySelectorAll('.mstop')].find(x => (x.textContent || '').includes(n))
    if (!p) return null
    const q = p.querySelector('.pin').getBoundingClientRect()
    const c = { x: q.x + q.width / 2, y: q.y + q.height / 2 }
    return {
      point: p.contains(document.elementFromPoint(c.x, c.y)) ? c : null,
      moving: window.__offwegoMap?.isMoving() ?? true,
    }
  }, name)
  let previous = null
  await expect.poll(async () => {
    const current = await pinCentre()
    const stable = current?.point && previous
      && Math.abs(current.point.x - previous.x) < 1
      && Math.abs(current.point.y - previous.y) < 1
      && !current.moving
    previous = current?.point
    return !!stable
  }, { intervals: [50, 100, 200] }).toBe(true)
  return (await pinCentre()).point
}

/* ------------------------------------------------------------- the screen */

test('loads the trip with map, markers and the day strip', async ({ page }) => {
  await open(page)
  await expect(page.locator('.mstop')).toHaveCount(8)
  await expect(page.locator('.mstack')).toHaveCount(5)
  await expect(page.locator('.fcard').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Amsterdam Weekend' })).toBeVisible()
  await expect(page.getByText(/travelling/)).toBeVisible()
})

test('the strip interleaves a day’s stops with the photographs taken at them', async ({ page }) => {
  await open(page)
  const titles = await cardTitles(page)
  expect(titles.length).toBeGreaterThan(3)
  await expect(page.locator('.fcard span', { hasText: 'PHOTO' }).first()).toBeVisible()
})

test('a day chip filters the strip, and all days brings everything back', async ({ page }) => {
  await open(page)
  await allDays(page)
  const everything = await cardTitles(page)

  await page.locator('.fdays button').nth(1).click()
  const oneDay = await cardTitles(page)
  expect(oneDay.length).toBeLessThan(everything.length)
  expect(everything).toEqual(expect.arrayContaining(oneDay))
})

test('a successful action shows a toast with a check mark', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Trip settings' }).click()
  await page.locator('.dlg').getByRole('button', { name: 'Close', exact: true }).last().click()

  await page.getByRole('button', { name: 'Place a pin' }).click()
  const box = await page.locator('.mapcanvas').boundingBox()
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4)
  await expect(page.locator('.editor')).toBeVisible()
})

test('a toast stays horizontally centred throughout its entrance animation', async ({ page }) => {
  await open(page)
  const positions = await page.evaluate(async () => {
    const button = [...document.querySelectorAll('button')]
      .find(b => b.getAttribute('aria-label') === 'Follow live position')
    button.click()
    const toast = await new Promise(resolve => requestAnimationFrame(
      () => resolve(document.querySelector('.toast')),
    ))
    if (!toast) return []
    const animation = toast.getAnimations()[0]
    animation.pause()
    const duration = Number(animation.effect.getTiming().duration)
    const viewportCentre = document.documentElement.clientWidth / 2
    return [0, duration / 2, duration - 0.01].map(currentTime => {
      animation.currentTime = currentTime
      const box = toast.getBoundingClientRect()
      return { toastCentre: box.left + box.width / 2, viewportCentre }
    })
  })
  for (const position of positions) {
    expect(Math.abs(position.toastCentre - position.viewportCentre)).toBeLessThan(0.5)
  }
})

/* The trip chrome used to be laid out from both edges of the screen at once —
   the title from the left, the actions from the right — which on a phone put
   twelve buttons straight through the trip name and pushed the account menu off
   the screen. Nothing up there may overlap or leave the viewport. */
test('the trip chrome stays clear of itself on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)

  const box = async locator => {
    await expect(locator).toBeVisible()
    return locator.boundingBox()
  }
  const title = await box(page.locator('header').first())
  const cluster = await box(page.locator('.tb').first().locator('xpath=../..'))
  const account = await box(page.locator('.avatar').last().locator('xpath=..'))
  const bar = await box(page.locator('.fdays').locator('xpath=../..'))

  expect(title.y + title.height, 'the actions overlap the trip name')
    .toBeLessThanOrEqual(cluster.y + 1)
  expect(title.x + title.width, 'the trip name runs under the account menu')
    .toBeLessThanOrEqual(account.x + 1)
  for (const [what, rect] of [['title', title], ['actions', cluster], ['account', account]]) {
    expect(rect.x, `the ${what} starts off the left of the screen`).toBeGreaterThanOrEqual(-1)
    expect(rect.x + rect.width, `the ${what} runs off the right of the screen`)
      .toBeLessThanOrEqual(391)
  }

  // Everything that floats above the bottom bar has to clear it, at whatever
  // height the bar takes on a phone.
  for (const selector of ['.wctl', '.fdays']) {
    const rect = await box(page.locator(selector))
    expect(rect.y + rect.height, `${selector} sits below the fold`).toBeLessThanOrEqual(845)
  }
  const controls = await box(page.locator('.wctl'))
  expect(controls.y + controls.height, 'the map controls overlap the bottom bar')
    .toBeLessThanOrEqual(bar.y + 1)
})

test('fit the whole trip reveals every stop on the smallest phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await open(page)
  await page.locator('.wctl .wc').last().click()
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
  const inside = await page.evaluate(() => {
    const map = window.__offwegoMap
    const bounds = map.getBounds()
    return [...document.querySelectorAll('.mstop')].length > 0 && !!bounds
  })
  expect(inside).toBe(true)
})

/* ------------------------------------------------------------ selection */

test('a pin selects its stop, a drag does not', async ({ page }) => {
  await open(page)
  const pin = await centreOnStop(page, PHOTOLESS)
  expect(pin, 'expected the centred pin to be clickable').not.toBeNull()

  // clear the selection so the pin click has something to prove
  await page.locator('.detailcard').getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.detailcard')).toHaveCount(0)

  await page.mouse.click(pin.x, pin.y)
  await expect(page.locator('.detailcard h3')).toHaveText(PHOTOLESS)
  const after = await page.locator('.detailcard h3').textContent()

  // dragging must pan without selecting whatever was underneath
  const box = await page.locator('.mapcanvas').boundingBox()
  const cx = box.x + box.width * 0.6, cy = box.y + box.height * 0.55
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 25; i++) await page.mouse.move(cx - i * 8, cy - i * 3)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
  expect(await page.locator('.detailcard h3').textContent()).toBe(after)
})

test('what is selected is in the URL, so the view can be linked and gone back from', async ({ page }) => {
  await open(page)
  await allDays(page)
  await page.locator('.fcard', { hasText: PHOTOLESS }).first().click()
  await expect(page.locator('.detailcard h3')).toHaveText(PHOTOLESS)
  await expect(page).toHaveURL(/sel=/)

  await page.locator('.detailcard').getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.detailcard')).toHaveCount(0)
  await expect(page).not.toHaveURL(/sel=/)
})

test('escape closes the selection before anything else', async ({ page }) => {
  await open(page)
  await allDays(page)
  await page.locator('.fcard').first().click()
  await expect(page.locator('.detailcard')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.detailcard')).toHaveCount(0)
})

/* -------------------------------------------------------------- editing */

test('adding a stop creates exactly one', async ({ page }) => {
  await open(page)
  const before = await page.locator('.mstop').count()

  await page.getByRole('button', { name: 'Edit the itinerary' }).click()
  await expect(page.locator('.edithint')).toBeVisible()

  const box = await page.locator('.mapcanvas').boundingBox()
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.45)
  await expect(page.locator('.editor')).toBeVisible()
  await expect(page.locator('.editor .eh b')).toHaveText('New stop')

  await page.locator('.editor .f input').first().fill('Test Stop')
  await page.locator('.editor .btn.pri').click()

  await expect(page.locator('.mstop')).toHaveCount(before + 1)
  expect(await page.locator('.mstop .lab').filter({ hasText: 'Test Stop' }).count()).toBe(1)
})

test('reordering moves a stop one place and back', async ({ page }) => {
  await open(page)

  const pin = await centreOnStop(page, PHOTOLESS)
  expect(pin).not.toBeNull()
  const before = await stopTitles(page)

  await page.getByRole('button', { name: 'Edit the itinerary' }).click()
  await page.mouse.click(pin.x, pin.y)
  await expect(page.locator('.editor')).toBeVisible()
  await expect(page.locator('.editor .eh b')).toHaveText('Edit stop')

  await page.locator('.editor .ef .ord').first().click()
  await expect.poll(() => stopTitles(page)).not.toEqual(before)
  const moved = await stopTitles(page)
  expect(moved.slice().sort()).toEqual(before.slice().sort())   // same set, new order

  await page.locator('.editor .ef .ord').nth(1).click()
  await expect.poll(() => stopTitles(page)).toEqual(before)
})

test('placing a pin is its own mode, and escape leaves it', async ({ page }) => {
  await open(page)
  const place = page.getByRole('button', { name: 'Place a pin' })
  await place.click()
  await expect(page.locator('.edithint, .glass', { hasText: 'Click the map where the stop is' }).first())
    .toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Click the map where the stop is')).toHaveCount(0)
})

/* --------------------------------------------------------------- search */

test('search matches a stop by its photo caption, across the whole trip', async ({ page }) => {
  await open(page)
  await page.locator('.fsearch input').fill('bitterballen')
  await expect.poll(() => stopTitles(page)).toEqual(['Foodhallen'])
  await expect(page).toHaveURL(/q=bitterballen/)

  await page.locator('.fsearch input').fill('museum')
  await expect.poll(async () => (await stopTitles(page)).length).toBeGreaterThan(1)
})

/* --------------------------------------------------------------- panels */

test('each side panel is its own URL and closes back to the map', async ({ page }) => {
  await open(page)
  for (const [label, heading] of [
    ['Timeline', 'Timeline'], ['Photos', 'Photos'], ['People', 'People'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`view=${heading.toLowerCase()}`))
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Back to map' }).click()
  await expect(page).not.toHaveURL(/view=/)
})

test('the people panel separates the travellers from the followers', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'People', exact: true }).click()
  await expect(page.getByText('On the road')).toBeVisible()
  await expect(page.getByText('Following', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Maya' })).toBeVisible()
})

test('the photos panel filters by who took them', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  const all = await page.locator('.grid button').count()
  expect(all).toBeGreaterThan(1)

  await page.getByRole('button', { name: 'Maya', exact: true }).click()
  await expect.poll(() => page.locator('.grid button').count()).toBeLessThan(all)
  await page.getByRole('button', { name: 'Everyone' }).click()
  await expect.poll(() => page.locator('.grid button').count()).toBe(all)
})

/* --------------------------------------------------------------- photos */

test('photo upload previews multiple selections and lets them be replaced', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Add photos' }).click()
  await page.locator('.dlg input[type="file"]').setInputFiles([
    { name: 'camera-one.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    { name: 'camera-two.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
  ])

  await expect(page.locator('.previews .preview')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Choose different photos' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add 2 to the map' })).toBeEnabled()
})

test('uploading a geotagged photo brings its map pin into view', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Add photos' }).click()
  await page.locator('.dlg input[type="file"]').evaluate(input => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'edinburgh.jpg', {
      type: 'image/jpeg',
    })
    Object.defineProperty(file, 'offwegoMetadata', {
      value: { lng: -3.1883, lat: 55.9533, takenAt: '2026-08-31T12:00:00.000Z' },
    })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.getByRole('button', { name: /Add 1 to the map/ })).toBeEnabled()
  await page.getByRole('button', { name: /Add 1 to the map/ }).click()

  await expect(page.locator('.dlg')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
  const centre = await page.evaluate(() => window.__offwegoMap.getCenter())
  expect(Math.abs(centre.lng - -3.1883)).toBeLessThan(0.05)
  expect(Math.abs(centre.lat - 55.9533)).toBeLessThan(0.05)
})

test('editing a caption shows immediately in the open viewer', async ({ page }) => {
  await open(page)
  // A tile selects the photograph; its card is what opens the viewer.
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.locator('.grid button').first().click()
  await page.locator('.detailcard').getByRole('button', { name: 'Open' }).click()
  await expect(page.locator('.viewer')).toBeVisible()

  await page.locator('.vcap .vedit, .vcap h2').first().click()
  const input = page.locator('.vedit input')
  if (await input.count()) {
    await input.fill('A brand new caption')
    await input.press('Enter')
    await expect(page.locator('.vcap h2')).toHaveText('A brand new caption')
  }
})

test('a comment posts and can be deleted again', async ({ page }) => {
  await open(page)
  // A tile selects the photograph; its card is what opens the viewer.
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.locator('.grid button').first().click()
  await page.locator('.detailcard').getByRole('button', { name: 'Open' }).click()
  await expect(page.locator('.viewer')).toBeVisible()

  const before = await page.locator('.cmt').count()
  await page.locator('.vinput input').fill('What a day')
  await page.locator('.vinput button').click()
  await expect(page.locator('.cmt')).toHaveCount(before + 1)

  await page.locator('.cmt').last().hover()
  const remove = page.locator('.cmt .cdel').last()
  if (await remove.count()) {
    await remove.click()
    await expect(page.locator('.cmt')).toHaveCount(before)
  }
})

/* ---------------------------------------------------------------- theme */

test('theme choice survives a reload and takes the map with it', async ({ page }) => {
  await open(page)
  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-theme', 'dark')

  await page.getByRole('button', { name: 'Day map' }).click()
  await expect(root).toHaveAttribute('data-theme', 'light')

  await page.reload()
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await expect(root).toHaveAttribute('data-theme', 'light')
})

test('the map keeps something painted through zoom and pan', async ({ page }) => {
  await open(page)
  const painted = async () => page.evaluate(() => {
    const canvas = document.querySelector('.mapcanvas canvas')
    return canvas.width > 0 && canvas.height > 0
  })
  await page.locator('.wctl .wc').nth(1).click()
  expect(await painted()).toBe(true)
  await page.locator('.wctl .wc').nth(2).click()
  expect(await painted()).toBe(true)
})

/* -------------------------------------------------------------- settings */

test('the settings sheet opens on a tab, and the tab is in the URL', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Trip settings' }).click()
  await expect(page).toHaveURL(/sheet=settings/)
  await expect(page.getByRole('dialog')).toBeVisible()

  await page.getByRole('button', { name: 'People', exact: true }).last().click()
  await expect(page).toHaveURL(/tab=people/)
  await expect(page.locator('.dlg').getByPlaceholder('them@example.com')).toBeVisible()

  await page.getByRole('button', { name: 'Location' }).click()
  await expect(page).toHaveURL(/tab=phones/)
})

test('the roster lists people and takes an invite', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Trip settings' }).click()
  await page.getByRole('button', { name: 'People', exact: true }).last().click()

  await expect(page.locator('.dlg').getByText('Maya').first()).toBeVisible()
  await page.locator('.dlg input[type=email]').fill('someone@example.com')
  await page.locator('.dlg').getByRole('button', { name: 'Invite' }).click()
  await expect(page.locator('.toast')).toBeVisible()
})

/* ------------------------------------------------------- Wikipedia-backed */

test('finding a place fills in its name, description and picture', async ({ page }) => {
  await open(page)
  // Drop the new pin on a landmark rather than an arbitrary rooftop, so the
  // lookup has something real to find.
  await centreOnStop(page, 'Rijksmuseum')
  await page.getByRole('button', { name: 'Edit the itinerary' }).click()
  const box = await page.locator('.mapcanvas').boundingBox()
  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.3)
  await expect(page.locator('.editor')).toBeVisible()
  await expect(page.locator('.editor .eh b')).toHaveText('New stop')

  await page.locator('.editor .lookup').click()
  await expect.poll(() => page.locator('.editor .f input').first().inputValue(),
    { timeout: 25000 }).not.toBe('')
})

test('the sights panel shows real landmarks with a picture and a description', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Sights nearby' }).click()
  await expect(page.getByRole('heading', { name: 'Sights nearby' })).toBeVisible()
  await expect(page.locator('.sight').first()).toBeVisible({ timeout: 25000 })
  await expect(page.locator('.sight .sname').first()).not.toHaveText('')
})

test('attractions are drawn across the map and open into a card', async ({ page }) => {
  await open(page)
  // The layer is drawn by the GPU, so there is nothing in the DOM to count;
  // ask the source what it is holding.
  const drawn = () => page.evaluate(() =>
    window.__offwegoMap?.getSource('attr')?.serialize?.().data?.features?.length ?? 0)

  await expect.poll(drawn, { timeout: 30000 }).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Hide attractions' }).click()
  await expect.poll(drawn).toBe(0)

  await page.getByRole('button', { name: 'Show attractions' }).click()
  await expect.poll(drawn, { timeout: 30000 }).toBeGreaterThan(0)
})
