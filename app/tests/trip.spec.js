import { test, expect } from '@playwright/test'

/* These cover the things that actually broke while the app was being built:
   double-created stops, a reorder that flung rows to the end, a photo viewer
   holding a stale snapshot, markers that stopped being clickable, and the map
   going blank mid-gesture. Each one is a regression guard, not a smoke test. */

const MAP_READY = 9000
const WIKIPEDIA_TESTS = new Set([
  'finding a place fills in its name, description and picture',
  'stops without a picture get a real one on load',
  'the sights list shows real landmarks with a picture and a description',
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
  await page.goto('/')
  await page.getByRole('link', { name: 'Open Amsterdam Weekend' }).click()
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

const stopNames = page =>
  page.locator('.fcard .t b').allTextContents()

test('the landing page lists accessible trips without opening one automatically', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible()
  const trip = page.getByRole('link', { name: 'Open Amsterdam Weekend' })
  await expect(trip).toBeVisible()
  await expect(trip).toHaveCSS('text-decoration-line', 'none')
  await expect(page.locator('.mapcanvas')).toHaveCount(0)

  await trip.click()
  await expect(page).toHaveURL('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
})

test('human-readable trip and user URLs survive direct navigation', async ({ page }) => {
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })

  await page.getByRole('button', { name: 'People' }).click()
  const alex = page.getByRole('link', { name: '@alex' })
  await expect(alex).toHaveAttribute('href', '/users/alex')
  await alex.click()

  await expect(page).toHaveURL('/users/alex')
  await expect(page.getByRole('heading', { name: 'Alex' })).toBeVisible()
  await expect(page.getByText('@alex', { exact: true })).toBeVisible()
})

test('an unavailable profile stays private and offers a way back', async ({ page }) => {
  await page.goto('/users/missing-person')

  await expect(page.getByRole('heading', { name: 'Profile unavailable' })).toBeVisible()
  await expect(page.getByText('This profile does not exist, or you do not share a trip with this person.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to your trips' })).toHaveAttribute('href', '/')
})

test('legacy trip query links are replaced with the canonical trip URL', async ({ page }) => {
  await page.goto('/?t=sample')

  await expect(page).toHaveURL('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
})

test('the trip menu returns to the landing page', async ({ page }) => {
  await open(page)

  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('menuitem', { name: 'All trips' }).click()

  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible()
  await expect(page.locator('.mapcanvas')).toHaveCount(0)
})

test('the sign-in screen gives the Off We Go icon enough room to be legible', async ({ page }) => {
  await page.goto('/')
  const size = await page.evaluate(() => {
    const screen = document.createElement('div')
    screen.className = 'bootIn'
    screen.innerHTML = '<span class="mk brand"><img src="/offwego-icon.png" alt=""></span>'
    document.body.append(screen)
    const box = screen.querySelector('.mk').getBoundingClientRect()
    screen.remove()
    return { width: box.width, height: box.height }
  })

  expect(size).toEqual({ width: 64, height: 64 })
})

test('the OIDC sign-in action stays inside an older iPhone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  const layout = await page.evaluate(() => {
    const root = document.querySelector('#root')
    root.innerHTML = `
      <div class="boot">
        <div class="bootIn wide">
          <span class="mk brand"><img src="/offwego-icon.png" alt=""></span>
          <b>Sign in to Off We Go</b>
          <p>Continue to Off We Go ID to sign in securely.</p>
          <button class="btn pri" type="button">Continue to sign in</button>
        </div>
      </div>`

    const viewportWidth = document.documentElement.clientWidth
    const action = document.querySelector('button').getBoundingClientRect()
    const card = document.querySelector('.bootIn').getBoundingClientRect()
    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      actionLeft: action.left,
      actionRight: action.right,
      cardLeft: card.left,
      cardRight: card.right,
    }
  })

  expect(layout.documentWidth).toBe(layout.viewportWidth)
  expect(layout.actionLeft).toBeGreaterThanOrEqual(0)
  expect(layout.actionRight).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.cardLeft).toBeGreaterThanOrEqual(0)
  expect(layout.cardRight).toBeLessThanOrEqual(layout.viewportWidth)
})

test('publishes the Off We Go mark for browser and installed web app icons', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(href).toBe('/favicon.ico')

  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/site.webmanifest')

  const response = await request.get(href)
  expect(response.ok()).toBe(true)
  const icon = await response.body()
  expect([...icon.subarray(0, 4)]).toEqual([0, 0, 1, 0])
  expect(icon.readUInt16LE(4)).toBe(4)

  const manifestResponse = await request.get('/site.webmanifest')
  expect(manifestResponse.ok()).toBe(true)
  const manifest = await manifestResponse.json()
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: '/icon-192.png', sizes: '192x192' }),
    expect.objectContaining({ src: '/icon-512.png', sizes: '512x512' }),
  ]))
})

test('an OIDC browser return can hand sign-in back to the installed app', async ({ page }) => {
  const token = 'one-time-login-token-at-least-thirty-two-characters'
  await page.goto(`/auth/native?token=${token}`)

  const openApp = page.getByRole('link', { name: 'Open Off We Go app' })
  await expect(openApp).toBeVisible()
  await expect(openApp).toHaveAttribute('href', `wayfare://auth?token=${token}`)
  await expect(page.getByRole('link', { name: 'Sign in on the website instead' })).toHaveAttribute(
    'href', `/auth/callback?token=${token}`,
  )
})

/* Getting a reliably clickable pin needs care: photo stacks are drawn above and
   to the right of their stop's pin, so at some zooms they cover neighbours. Fly
   to a stop that has no photos and it lands centred and uncovered every time.
   Hunting the DOM for "some pin that happens to be clear" is flaky. */
const PHOTOLESS = 'Bikes in Vondelpark'

async function centreOnStop(page, name) {
  await page.locator('.fdays button').first().click()      // all days
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

test('loads the trip with map, markers and filmstrip', async ({ page }) => {
  await open(page)
  await expect(page.locator('.mstop')).toHaveCount(8)
  await expect(page.locator('.mstack')).toHaveCount(5)
  await expect(page.locator('.fcard').first()).toBeVisible()
  await expect(page.locator('.tflow')).toContainText('km walked')
})

test('a successful action shows a green toast with a green check mark', async ({ page }) => {
  await open(page)
  await page.locator('.fcard').first().click()
  await page.locator('.herocard .btns .wbtn').nth(2).click()

  const toast = page.locator('.toast.success')
  await expect(toast).toContainText('Saved to favourites')
  await expect(toast.locator('span')).toHaveText('✓')
  await expect(toast).toHaveCSS('background-color', 'rgb(15, 42, 28)')
  await expect(toast).toHaveCSS('color', 'rgb(34, 197, 94)')
  await expect(toast.locator('span')).toHaveCSS('color', 'rgb(34, 197, 94)')
})

test('a toast stays horizontally centred throughout its entrance animation', async ({ page }) => {
  await open(page)
  await page.locator('.fcard').first().click()
  const positions = await page.locator('.herocard .btns .wbtn').nth(2).evaluate(async button => {
    button.click()
    const toast = await new Promise(resolve => requestAnimationFrame(
      () => resolve(document.querySelector('.toast.success')),
    ))
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

test('fit the whole trip reveals every stop on the smallest phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await open(page)

  await page.getByTitle('Fit the whole trip').click({ timeout: 5000 })
  await expect(page.locator('.herocard')).toHaveCount(0)

  const allStopsInsideMap = () => page.evaluate(() => {
    const map = document.querySelector('.mapcanvas').getBoundingClientRect()
    return [...document.querySelectorAll('.mstop .pin')].every(pin => {
      const box = pin.getBoundingClientRect()
      return box.left >= map.left && box.right <= map.right
        && box.top >= map.top && box.bottom <= map.bottom
    })
  })
  await expect.poll(allStopsInsideMap).toBe(true)
})

test('the header People action stays compact at tablet widths', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  await open(page)

  const people = await page.getByRole('button', { name: 'People' }).boundingBox()
  expect(people.width).toBeLessThanOrEqual(100)
})

test('the Off We Go mark is legible in the phone header', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await open(page)

  const mark = await page.locator('.tlogo .mk').boundingBox()
  expect(mark.width).toBeGreaterThanOrEqual(28)
  expect(mark.height).toBeGreaterThanOrEqual(28)
})

test('the phone header controls reach the right edge', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await open(page)

  const gap = await page.evaluate(() => {
    const header = document.querySelector('.ticker').getBoundingClientRect()
    const controls = document.querySelector('.tright').getBoundingClientRect()
    return Math.round(header.right - controls.right)
  })
  expect(gap).toBeLessThanOrEqual(1)
})

test('the trip shell and map do not create a wider phone layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await open(page)

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    boxes: Object.fromEntries(
      ['.app', '.ticker', '.stagewrap', '.filmstrip'].map(selector => {
        const element = document.querySelector(selector)
        const rect = element.getBoundingClientRect()
        return [selector, {
          client: element.clientWidth,
          scroll: element.scrollWidth,
          left: rect.left,
          right: rect.right,
        }]
      }),
    ),
    map: (() => {
      const element = document.querySelector('.mapcanvas')
      const rect = element.getBoundingClientRect()
      return { width: rect.width, overflowX: getComputedStyle(element).overflowX }
    })(),
  }))

  expect(layout.document).toBe(layout.viewport)
  for (const [selector, width] of Object.entries(layout.boxes)) {
    expect(width.left, selector).toBeGreaterThanOrEqual(0)
    expect(width.right, selector).toBeLessThanOrEqual(layout.viewport)
    expect(width.scroll, selector).toBeLessThanOrEqual(width.client)
  }
  expect(layout.map.width).toBe(layout.viewport)
  expect(layout.map.overflowX).toBe('hidden')
})

test('phone form controls do not trigger Safari focus zoom', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await open(page)
  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content')
  expect(viewportMeta).toContain('width=device-width')
  expect(viewportMeta).not.toMatch(/maximum-scale|user-scalable/i)
  await page.getByRole('button', { name: 'People' }).click()

  const name = page.locator('.mine input[placeholder="Your name"]')
  await name.focus()
  await expect(name).toBeFocused()

  const fontSizes = await page.locator('.modal input, .modal select, .modal textarea').evaluateAll(
    controls => controls.filter(control => !control.hidden)
      .map(control => Number.parseFloat(getComputedStyle(control).fontSize)),
  )

  expect(fontSizes.length).toBeGreaterThan(0)
  expect(fontSizes.every(size => size >= 16)).toBe(true)

  await page.locator('.modal .mh button').click()
  const layout = await page.evaluate(() => ({
    viewport: window.visualViewport?.width ?? document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    app: document.querySelector('.app').getBoundingClientRect().width,
    map: document.querySelector('.mapcanvas').getBoundingClientRect().width,
  }))
  expect(layout.document).toBe(layout.viewport)
  expect(layout.app).toBe(layout.viewport)
  expect(layout.map).toBe(layout.viewport)
})

test('the People modal fits without horizontal scrolling on an older iPhone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await open(page)
  await page.getByRole('button', { name: 'People' }).click()

  // Real roster content, not a synthetic wide element: an email is the longest
  // unbroken value this modal commonly receives.
  await page.locator('.invite input[type=email]').fill(
    'averylongunbrokeninvitationaddressforanolderiphone@example.com',
  )
  await page.locator('.invite .btn.pri').click()
  await expect(page.locator('.rperson.pend')).toBeVisible()
  await page.locator('.modal').evaluate(
    modal => Promise.all(modal.getAnimations().map(animation => animation.finished)),
  )

  const widths = await page.evaluate(() => {
    const modal = document.querySelector('.modal')
    const body = document.querySelector('.modal .mb')
    const rect = modal.getBoundingClientRect()
    return {
      viewport: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      document: document.documentElement.scrollWidth,
      modalClient: modal.clientWidth,
      modalScroll: modal.scrollWidth,
      bodyClient: body.clientWidth,
      bodyScroll: body.scrollWidth,
      bodyOverflowX: getComputedStyle(body).overflowX,
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    }
  })

  expect(widths.document).toBe(widths.viewport)
  expect(widths.modalScroll).toBeLessThanOrEqual(widths.modalClient)
  expect(widths.bodyScroll).toBeLessThanOrEqual(widths.bodyClient)
  expect(widths.bodyOverflowX).toBe('hidden')
  expect(widths.rect.left).toBeGreaterThanOrEqual(0)
  expect(widths.rect.right).toBeLessThanOrEqual(widths.viewport)
  expect(widths.rect.top).toBeGreaterThanOrEqual(0)
  expect(widths.rect.bottom).toBeLessThanOrEqual(widths.viewportHeight)

  const scrolling = await page.evaluate(() => {
    const body = document.querySelector('.modal .mb')
    const modal = document.querySelector('.modal')
    body.scrollTop = 100
    return {
      modalHeight: modal.clientHeight,
      viewportHeight: document.documentElement.clientHeight,
      bodyScrollTop: body.scrollTop,
    }
  })
  expect(scrolling.modalHeight).toBeLessThanOrEqual(scrolling.viewportHeight)
  expect(scrolling.bodyScrollTop).toBeGreaterThan(0)
})

test('the Off We Go mark opens the app menu', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await open(page)

  const trigger = page.getByRole('button', { name: 'Open menu' })
  await expect(page.locator('.wm')).toHaveText('Off We Go')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()

  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('menu', { name: 'Off We Go menu' })).toBeVisible()

  await page.getByRole('menuitem', { name: 'People' }).click()
  await expect(page.getByRole('menu', { name: 'Off We Go menu' })).toHaveCount(0)
  await expect(page.locator('.modal')).toBeVisible()
})

test('shows who is currently viewing in the header and roster', async ({ page }) => {
  await open(page)
  await expect(page.getByLabel('Viewing now: Alex')).toBeVisible()

  await page.getByRole('button', { name: 'People' }).click()
  const alex = page.locator('.rperson', { hasText: 'Alex' })
  await expect(alex).toContainText('Viewing now')
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
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
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
  await expect.poll(() => stopNames(page)).not.toEqual(before)
  const moved = await stopNames(page)
  expect(moved.slice().sort()).toEqual(before.slice().sort())   // same set, new order

  await page.locator('.editor .ef .ord').nth(1).click()
  await expect.poll(() => stopNames(page)).toEqual(before)
})

test('search matches a stop by its photo caption', async ({ page }) => {
  await open(page)
  await page.locator('.fsearch input').fill('bitterballen')
  await expect.poll(() => stopNames(page)).toEqual(['Foodhallen'])

  await page.locator('.fsearch input').fill('museum')
  await expect.poll(async () => (await stopNames(page)).length).toBeGreaterThan(1)
})

test('photo upload previews multiple Apple Photos selections and lets them be replaced', async ({ page }) => {
  await open(page)
  await page.locator('button[title="Add a photo"]').click()
  await page.locator('.modal input[type="file"]').setInputFiles([
    { name: 'camera-one.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    { name: 'camera-two.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
  ])

  await expect(page.locator('.previews .preview')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Choose different photos' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add 2 to the map' })).toBeEnabled()
})

test('uploading a geotagged iPhone photo brings its map pin into view', async ({ page }) => {
  await open(page)
  await page.locator('button[title="Add a photo"]').click()
  await page.locator('.modal input[type="file"]').evaluate(input => {
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

  await page.getByRole('button', { name: 'Add 1 to the map' }).click()
  await expect(page.locator('.modal')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const center = window.__offwegoMap.getCenter()
    return [Number(center.lng.toFixed(4)), Number(center.lat.toFixed(4))]
  })).toEqual([-3.1883, 55.9533])
})

test('a newly uploaded photo is visible on top of an existing map stack', async ({ page }) => {
  await open(page)
  await page.locator('button[title="Add a photo"]').click()
  await page.locator('.modal input[type="file"]').setInputFiles({
    name: 'foodhallen-now.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  })
  await page.getByRole('button', { name: 'Add 1 to the map' }).click()

  const updatedStack = page.locator('.mstack[title="3 photos"]')
  await expect(updatedStack).toHaveCount(1)
  await expect(updatedStack.locator('.sh img').first()).toHaveAttribute('src', /^blob:/)
})

test('editing a caption shows immediately in the open viewer', async ({ page }) => {
  await open(page)
  await page.locator('.tnav button[title="photos"]').click()
  await page.locator('.masonry .tile').first().click()
  await expect(page.locator('.viewer')).toBeVisible()

  const before = await page.locator('.vcap h2').textContent()
  await page.locator('.vedit input').fill('Recaptioned')
  await expect(page.locator('.vcap h2')).toHaveText('Recaptioned')
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
    expect(await painted()).toBe(100)
  }
  const box = await page.locator('.mapcanvas').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 25; i++) await page.mouse.move(cx - i * 9, cy - i * 4)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
  expect(await painted()).toBe(100)
})

test('theme choice survives a reload', async ({ page }) => {
  await open(page)
  const before = await page.evaluate(() => document.body.dataset.theme)
  await page.locator('.tbtn.ghost[title^="Theme"]').click()
  await expect.poll(() => page.evaluate(() => document.body.dataset.theme)).not.toBe(before)
  const chosen = await page.evaluate(() => document.body.dataset.theme)
  await page.reload()
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  expect(await page.evaluate(() => document.body.dataset.theme)).toBe(chosen)
})

test('theme swaps disable MapLibre style diffing for incompatible sprite atlases', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    const map = window.__offwegoMap
    const setStyle = map.setStyle.bind(map)
    window.__offwegoSetStyleOptions = undefined
    map.setStyle = (style, options) => {
      window.__offwegoSetStyleOptions = options
      return setStyle(style, options)
    }
  })

  const themeButton = page.locator('.tbtn.ghost[title^="Theme"]')
  await themeButton.click()

  // The map follows daylight until the first manual override. If that override
  // chooses the style already on screen, the next click guarantees a real swap.
  if (await page.evaluate(() => window.__offwegoSetStyleOptions === undefined)) {
    await themeButton.click()
  }

  await expect.poll(() => page.evaluate(
    () => window.__offwegoSetStyleOptions?.diff ?? null,
  )).toBe(false)
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

test.describe('Wikipedia-backed discovery', () => {
test.describe.configure({ mode: 'serial' })

test('finding a place fills in its name, description and picture', async ({ page }) => {
  await open(page)
  await page.locator('.fdays button').first().click()
  await page.locator('.fcard', { hasText: 'Rijksmuseum' }).first().click()
  await expect(page.locator('.herocard h2')).toHaveText('Rijksmuseum')

  await page.locator('.tbtn.ghost[title*="Edit"]').click()
  await page.getByRole('button', { name: 'Find places' }).click()
  await expect(page.locator('.mfind').first()).toBeVisible({ timeout: 20_000 })

  // Real destinations, not the streets and neighbourhoods geosearch also returns.
  const names = await page.locator('.mfind span').allTextContents()
  expect(names.length).toBeGreaterThan(2)
  expect(names.join(' ')).not.toMatch(/straat|neighbourhood|district/i)

  const before = await page.locator('.mstop').count()
  const markers = page.locator('.mfind')
  const clickableIndex = await markers.evaluateAll(buttons => buttons.findIndex(button => {
    const box = button.getBoundingClientRect()
    const topmost = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return topmost === button || button.contains(topmost)
  }))
  expect(clickableIndex).toBeGreaterThanOrEqual(0)
  await markers.nth(clickableIndex).click()
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
  await page.getByRole('link', { name: 'Open Amsterdam Weekend' }).click()
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.locator('.fdays button').first().click()

  const names = await stopNames(page)
  const enrichedCount = async () => {
    let real = 0
    for (const n of names) {
      await page.locator('.fcard', { hasText: n }).first().click()
      const src = await page.locator('.herocard img.hero').getAttribute('src')
      if (/wikimedia/.test(src || '')) real++
    }
    return real
  }
  // Not all of them: two of the sample stops have no article and one is not a
  // place at all. Matching is strict on purpose — a wrong photograph of the
  // building next door is worse than the placeholder.
  await expect.poll(enrichedCount, { timeout: 30_000, intervals: [500] }).toBeGreaterThanOrEqual(4)
})

test('the sights list shows real landmarks with a picture and a description', async ({ page }) => {
  await open(page)

  // Reachable without entering edit mode: browsing and authoring are different jobs.
  await page.locator('.tnav button[title="sights"]').click()
  await expect(page.locator('.sight').first()).toBeVisible({ timeout: 30_000 })

  const cards = page.locator('.sight')
  expect(await cards.count()).toBeGreaterThan(15)

  // Every card carries the three things asked for: picture, name, description.
  const shownCards = () => cards.evaluateAll(els => els.map(e => ({
    name: e.querySelector('.sname')?.textContent || '',
    note: (e.querySelector('p')?.textContent || '').trim(),
    pic: !!e.querySelector('.spic img'),
  })))
  await expect.poll(async () => {
    const shown = await shownCards()
    return shown.filter(s => s.pic).length / shown.length
  }, { timeout: 15_000 }).toBeGreaterThan(0.9)
  const shown = await shownCards()
  expect(shown.filter(s => s.pic).length).toBeGreaterThan(shown.length * 0.9)
  expect(shown.every(s => s.name && s.note)).toBe(true)

  /* Ranked by readership, not by distance — the nearest forty articles to the
     middle of Amsterdam are canals and side streets, and an earlier version of
     this listed those instead. */
  const top = shown.slice(0, 12).map(s => s.name).join(' | ')
  expect(top).toMatch(/Rijksmuseum|Anne Frank|Van Gogh|Dam Square|Vondelpark/)
  expect(top).not.toMatch(/straat|neighbourhood|district/i)

  // Somewhere already on the itinerary is marked, not offered again.
  await expect(page.locator('.sight .wbtn.hot:disabled').first()).toHaveText('In your trip')

  // Adding one puts it on the map.
  const before = await page.locator('.mstop').count()
  const name = await page.locator('.sight').filter({ has: page.locator('.wbtn.hot:not(:disabled)') })
    .first().locator('.sname').textContent()
  // Pinned by name: the "first addable card" moves as soon as one is added.
  const card = page.locator('.sight').filter({ has: page.locator('.sname', { hasText: name }) }).first()
  await card.locator('.wbtn.hot').click()
  await expect(page.locator('.toast')).toContainText(name)
  await expect(card.locator('.wbtn.hot')).toHaveText('In your trip')

  await page.locator('.tnav button[title="map"]').click()
  await expect(page.locator('.mstop')).toHaveCount(before + 1)
})

test('attractions are drawn across the map and open into a card', async ({ page }) => {
  await open(page)
  // Drawn by the map itself, not as elements, so ask the map what it rendered.
  const dots = async () => page.evaluate(() => {
    const m = window.__offwegoMap
    return m?.getLayer('attr-dot') ? m.queryRenderedFeatures({ layers: ['attr-dot'] }).length : 0
  })
  await expect.poll(dots, { timeout: 40_000, intervals: [1000] }).toBeGreaterThan(40)

  // They follow the map anywhere, not just where the trip already goes.
  await page.mouse.move(700, 500)
  await page.mouse.down(); await page.mouse.move(660, 470, { steps: 8 }); await page.mouse.up()
  await page.evaluate(() => window.__offwegoMap.jumpTo({ center: [-3.1883, 55.9533], zoom: 13.5 }))
  await expect.poll(dots, { timeout: 60_000, intervals: [1500] }).toBeGreaterThan(30)

  const names = await page.evaluate(() => window.__offwegoMap
    .queryRenderedFeatures({ layers: ['attr-dot'] }).map(f => f.properties.n).join(' | '))
  expect(names).toMatch(/Castle|Museum|Monument|Gallery|Park/)

  // A pin opens a card with the three things worth knowing.
  const hit = await page.evaluate(() => {
    const m = window.__offwegoMap, c = m.getCanvas()
    const fs = m.queryRenderedFeatures({ layers: ['attr-dot'] })
    let best = null, bd = Infinity
    for (const f of fs) {
      const pt = m.project(f.geometry.coordinates)
      const d = (pt.x - c.clientWidth / 2) ** 2 + (pt.y - c.clientHeight / 2) ** 2
      if (d < bd) { bd = d; best = { x: Math.round(pt.x), y: Math.round(pt.y) } }
    }
    return best
  })
  const box = await page.locator('.mapcanvas').boundingBox()
  await page.mouse.click(box.x + hit.x, box.y + hit.y)
  await expect(page.locator('.acard')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.acard b')).not.toHaveText('')
  await expect(page.locator('.acard .kind')).not.toHaveText('')
  await expect(page.locator('.acard p')).not.toHaveText('', { timeout: 15_000 })

  // And the layer can be turned off.
  await page.locator('.tbtn.ghost[title*="Hide attractions"]').click()
  await expect(page.locator('.acard')).toHaveCount(0)
})
})
