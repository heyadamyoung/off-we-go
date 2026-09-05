import { test, expect } from '@playwright/test'

/* These cover the things that actually broke while the app was being built:
   double-created stops, a reorder that flung rows to the end, a photo viewer
   holding a stale snapshot, markers that stopped being clickable, and the map
   going blank mid-gesture. Each one is a regression guard, not a smoke test. */

const MAP_READY = 9000
const PHOTOLESS = 'Bikes in Vondelpark' // a stop with no photographs of its own

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
  await page.route('https://en.wikipedia.org/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
    }),
  )
})

async function open(page) {
  // Freeze the demo's walking traveller before the app boots: these are camera
  // and layout regression guards, and they need a world that is not moving
  // underneath them. A global rather than a query param — the router strips
  // unknown search keys before the live layer could read them.
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await expect(page.locator('.mstop')).toHaveCount(8)
  const follow = page.locator('.wc.on') // stop the camera drifting under us
  if (await follow.count()) {
    await follow.click()
    await expect(follow).toHaveCount(0)
  }
  // Cancel the initial follow animation as well as disabling future ones. If it
  // is left running, its moveend can race a camera action performed by a test.
  await page.evaluate(() => window.__offwegoMap?.stop())
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
  /* On a slow runner the follow effect can have been QUEUED before the toggle
     above and only issue its ease after the stop — a 900ms glide that starts
     under the test's feet. Outlive it, then kill anything that started. */
  await page.waitForTimeout(1100)
  await page.evaluate(() => window.__offwegoMap?.stop())
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
}

/* Somewhere on the map with nothing on it. Clicking a fixed fraction of the
   canvas was a bet on where the pins happened to be, and the bet came off
   until the camera started framing into the visible band and moved them: the
   click landed on a marker, selected it, and no editor opened. */
async function emptyMapPoint(page) {
  const box = await page.locator('.mapcanvas').boundingBox()
  const spot = await page.evaluate(({ x, y, width, height }) => {
    const taken = [
      ...document.querySelectorAll('.mstop, .mstack, .mme, .mfind, .glass, .sheet'),
    ].map(el => el.getBoundingClientRect())
    const clear = (px, py) =>
      !taken.some(r => px > r.x - 24 && px < r.right + 24 && py > r.y - 24 && py < r.bottom + 24)
    for (let fy = 0.35; fy <= 0.65; fy += 0.05) {
      for (let fx = 0.25; fx <= 0.75; fx += 0.05) {
        const px = x + width * fx
        const py = y + height * fy
        if (clear(px, py)) return { x: px, y: py }
      }
    }
    return null
  }, box)
  if (!spot) throw new Error('no empty patch of map to click')
  return spot
}

const allDays = page => page.locator('.fdays button').first().click()
const cardTitles = page => page.locator('.fcard .t').allTextContents()
const stopTitles = async page =>
  (
    await page
      .locator('.fcard', { has: page.locator('.t') })
      .all()
      .then(cards =>
        Promise.all(
          cards.map(async card => ({
            title: (await card.locator('.t').textContent())?.trim(),
            // Photographs are told apart by form, not by a chip.
            photo: /\bfcard-photo\b/.test((await card.getAttribute('class')) || ''),
          })),
        ),
      )
  )
    .filter(item => !item.photo)
    .map(item => item.title)

async function centreOnStop(page, name) {
  await allDays(page)
  await page.locator('.fcard', { hasText: name }).first().click()
  const pinCentre = () =>
    page.evaluate(n => {
      const p = [...document.querySelectorAll('.mstop')].find(x =>
        (x.textContent || '').includes(n),
      )
      if (!p) return null
      const q = p.querySelector('.pin').getBoundingClientRect()
      /* Geometry and settledness only — never elementFromPoint. On a travel
         day Maya's LIVE avatar dwells exactly on the museum steps, covering
         the pin's centre for minutes of every lap, and a hit-test proxy for
         "the pin has landed" failed every deploy that crossed her dwell. */
      const c = { x: q.x + q.width / 2, y: q.y + q.height / 2 }
      return {
        point: q.width > 0 ? c : null,
        moving: window.__offwegoMap?.isMoving() ?? true,
      }
    }, name)
  let previous = null
  await expect
    .poll(
      async () => {
        const current = await pinCentre()
        const stable =
          current?.point &&
          previous &&
          Math.abs(current.point.x - previous.x) < 1 &&
          Math.abs(current.point.y - previous.y) < 1 &&
          !current.moving
        previous = current?.point
        return !!stable
      },
      /* Three times the default room: on a cold CI box the ease to the stop
         waits on tiles and glyphs, and this predicate needs two consecutive
         quiet reads. Its only two failures ever were paired retries on one
         box — time, not logic. */
      { intervals: [50, 100, 200], timeout: 45000 },
    )
    .toBe(true)
  return (await pinCentre()).point
}

/* ------------------------------------------------------------- the screen */

/* The ODbL is not satisfied by an attribution that exists in the markup:
   OpenStreetMap's credit must be visible. It was once rendered underneath the
   itinerary bar, where nobody could read it. */
/* The card's trash button read the draft, which is null whenever the card is
   showing — so it opened the editor and deleted nothing, silently, every time. */
test('removing a stop from its card actually removes it', async ({ page }) => {
  await open(page)
  await allDays(page)
  const before = await page.locator('.mstop').count()
  await page.locator('.fcard', { hasText: PHOTOLESS }).first().click()
  await expect(page.getByTitle('Remove this stop')).toBeVisible({ timeout: 8000 })

  await page.getByTitle('Remove this stop').click()

  await expect(page.locator('.mstop')).toHaveCount(before - 1)
  await expect(page.locator('.fcard', { hasText: PHOTOLESS })).toHaveCount(0)
})

/* Two independent Escape listeners closed the viewer and the sheet behind it
   in one press. Escape unwinds one layer at a time. */
test('escape closes the photo viewer without closing what is behind it', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await expect(page).toHaveURL(/view=photos/)
  // The film strip yields to the panel now, at every width: the panel's own
  // grid is where a photo gets opened while a view is up.
  await page.locator('.pgrid-photo').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })

  await page.keyboard.press('Escape')

  await expect(page.locator('.viewer')).toHaveCount(0)
  /* One layer, not two: the trip's own Escape chain used to fire as well and
     clear the selection out from under the panel behind the viewer. */
  await expect(page).toHaveURL(/view=photos/)
  await expect(page).toHaveURL(/sel=/)
})

test('the basemap credit is visible, clear of the bottom bar', async ({ page }) => {
  await open(page)

  // The ODbL wants © OpenStreetMap readable with no interaction, and that is
  // all the corner holds: inert text nobody can mis-tap. The CC-BY design
  // credits live on /credits.html, behind More tools.
  const credit = page.locator('.map-credit')
  await expect(credit).toBeVisible()
  await expect(credit).toContainText('© OpenStreetMap')
  await expect(credit).toHaveCSS('pointer-events', 'none')

  const box = await credit.boundingBox()
  const bar = await page.locator('.tripscreen > .glass.absolute.inset-x-0.bottom-0').boundingBox()
  expect(box, 'the credit has a place on the screen').not.toBeNull()
  if (bar) expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1)

  await page.getByRole('button', { name: 'More tools' }).click()
  await expect(page.getByRole('menuitem', { name: 'Map credits' })).toHaveAttribute(
    'href',
    '/credits.html',
  )
})

test('loads the trip with map, markers and the day strip', async ({ page }) => {
  await open(page)
  await expect(page.locator('.mstop')).toHaveCount(8)
  await expect(page.locator('.mstack')).toHaveCount(5)
  await expect(page.locator('.fcard').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Amsterdam Weekend' })).toBeVisible()
  await expect(page.getByText(/travelling/)).toBeVisible()
})

test('a photo’s notes are readable and writable on a phone', async ({ page }) => {
  // The sidebar was simply display:none below 1080px — every comment and the
  // box for writing one, gone from every phone, reading as broken.
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.locator('.pgrid-photo').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })
  await expect(page.locator('.vcomments')).toBeVisible()
  const input = page.locator('.vinput input')
  await expect(input).toBeVisible()
  // Writable means actually reachable by a tap, not merely rendered.
  await input.click()
  await expect(input).toBeFocused()
})

test('tapping the photograph hearts it, and never un-hearts it', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.locator('.pgrid-photo').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })

  await page.locator('.vmaintap').click()
  await expect(page.locator('.vheart')).toBeVisible()
  await expect(page.locator('.vtop .acts button.liked')).toHaveCount(1)

  // A second tap pops the heart again but the like survives — un-liking is
  // the chrome heart's deliberate job.
  await page.locator('.vmaintap').click()
  await expect(page.locator('.vtop .acts button.liked')).toHaveCount(1)
})

test('deleting a photo takes a held press — a tap does nothing', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.locator('.pgrid-photo').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })
  const count = () => page.locator('.vcap .ct').textContent()
  const before = await count()

  // The destructive act lives behind the deliberate edit context now.
  await page.getByTitle('Edit photo details').click()
  const del = page.locator('.vdel')
  await del.scrollIntoViewIfNeeded()
  // A tap — pointer down and up in a beat — must never take a picture away.
  await del.click()
  await expect.poll(count).toBe(before)

  // Held past the fill, it deletes: the count of photos drops by one.
  await del.hover()
  await page.mouse.down()
  await page.waitForTimeout(850)
  await page.mouse.up()
  const total = Number((before || '').split(' of ')[1])
  await expect(page.locator('.vcap .ct')).toContainText(`of ${total - 1}`)
})

test('the strip interleaves a day’s stops with the photographs taken at them', async ({ page }) => {
  await open(page)
  const titles = await cardTitles(page)
  expect(titles.length).toBeGreaterThan(3)
  await expect(page.locator('.fcard-photo').first()).toBeVisible()
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
  // Occasional tools live behind the More menu now.
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('menuitem', { name: 'Trip settings' }).click()
  await page.locator('.dlg').getByRole('button', { name: 'Close', exact: true }).last().click()

  await page.getByRole('button', { name: 'Place a pin' }).click()
  const spot = await emptyMapPoint(page)
  await page.mouse.click(spot.x, spot.y)
  await expect(page.locator('.editor')).toBeVisible()
})

test('a toast stays horizontally centred throughout its entrance animation', async ({ page }) => {
  await open(page)
  const positions = await page.evaluate(async () => {
    // Follow lives only in the map controls now; the cluster's duplicate is gone.
    const button = [...document.querySelectorAll('button')].find(
      b => b.title === 'Follow the travellers',
    )
    button.click()
    const toast = await new Promise(resolve =>
      requestAnimationFrame(() => resolve(document.querySelector('.toast'))),
    )
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
/* The detail card is anchored to the bottom of a phone screen and grew upwards
   with its own text, so a stop with a real note — a flight with a terminal
   change in it, say — pushed its header, and the only button that closes it,
   up behind the top bar. There was then no way back to the map. */
test('a long note cannot push the detail card off the top of a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)

  await page.locator('.fcard', { hasText: 'Rijksmuseum' }).first().click()
  await expect(page.locator('.detailcard')).toBeVisible()
  await page.locator('.detailcard').getByTitle('Edit this stop').click()
  await page
    .locator('.editor textarea')
    .fill(
      'Air Canada Rouge AC 1924, ref CL7GQW (booked under a different email). Lands Terminal 1: ' +
        'collect bags, take the Terminal Link train to Terminal 3, re-check with the next airline — ' +
        'separate tickets, nothing is through-checked. They want check-in three hours before ' +
        'departure, so there is no time for a sit-down meal between the two.',
    )
  await page.locator('.editor .btn.pri').click()
  await expect(page.locator('.editor')).toHaveCount(0)

  await page.locator('.fcard', { hasText: 'Rijksmuseum' }).first().click()
  const card = page.locator('.detailcard')
  await expect(card).toBeVisible()

  // Below the bar, not merely on the screen: the bar is opaque, so a card that
  // starts underneath it hides its own header just as completely. Every rect
  // goes into the message — a failure here is about geometry, and "not in
  // viewport" on its own does not say which edge went where.
  const close = card.getByRole('button', { name: 'Close' })
  await expect(close).toBeVisible()
  const [bar, box, x] = await Promise.all([
    page.locator('header').first().boundingBox(),
    card.boundingBox(),
    close.boundingBox(),
  ])
  const where = `card ${JSON.stringify(box)} close ${JSON.stringify(x)} bar ${JSON.stringify(bar)}`

  expect(box.y, `the card starts behind the top bar — ${where}`).toBeGreaterThanOrEqual(
    bar.y + bar.height,
  )
  expect(box.y + box.height, `the card runs off the bottom — ${where}`).toBeLessThanOrEqual(845)
  expect(x.y, `the way back to the map is above the screen — ${where}`).toBeGreaterThanOrEqual(0)
  expect(
    x.y + x.height,
    `the way back to the map is below the screen — ${where}`,
  ).toBeLessThanOrEqual(844)

  // Rects alone would not catch the button being clipped by the card's own
  // overflow or covered by the bar above it. Ask the page what is actually
  // under that point.
  const tappable = await close.evaluate(el => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return !!hit && (hit === el || el.contains(hit))
  })
  expect(tappable, `nothing reaches the close button — ${where}`).toBe(true)

  await close.click()
  await expect(card).toHaveCount(0)
})

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

  expect(title.y + title.height, 'the actions overlap the trip name').toBeLessThanOrEqual(
    cluster.y + 1,
  )
  expect(title.x + title.width, 'the trip name runs under the account menu').toBeLessThanOrEqual(
    account.x + 1,
  )
  for (const [what, rect] of [
    ['title', title],
    ['actions', cluster],
    ['account', account],
  ]) {
    expect(rect.x, `the ${what} starts off the left of the screen`).toBeGreaterThanOrEqual(-1)
    expect(rect.x + rect.width, `the ${what} runs off the right of the screen`).toBeLessThanOrEqual(
      391,
    )
  }

  // Everything that floats above the bottom bar has to clear it, at whatever
  // height the bar takes on a phone.
  for (const selector of ['.wctl', '.fdays']) {
    const rect = await box(page.locator(selector))
    expect(rect.y + rect.height, `${selector} sits below the fold`).toBeLessThanOrEqual(845)
  }
  const controls = await box(page.locator('.wctl'))
  expect(
    controls.y + controls.height,
    'the map controls overlap the bottom bar',
  ).toBeLessThanOrEqual(bar.y + 1)
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

/* Asking to follow the travellers used to send two camera commands: the toggle
   flew in to street level, and the effect behind it immediately re-issued the
   move carrying the zoom from before the tap. The second one won, so a phone
   that had been panned away crawled sideways and never zoomed. */
/* Focusing places its subject in the middle of the map you can see rather than
   the middle of the container. Applying that shift to a camera that is only
   changing zoom walks the map a little further away on every press. */
test('zooming does not walk the map away from where it was', async ({ page }) => {
  await open(page)
  const still = () =>
    expect.poll(() => page.evaluate(() => !window.__offwegoMap.isMoving())).toBe(true)
  const centre = () =>
    page.evaluate(() => {
      const c = window.__offwegoMap.getCenter()
      return [c.lng, c.lat]
    })

  /* The drift this test once caught on CI: fitBounds persists object padding
     into the transform, whose 70px vertical bias crawled the map north a
     little on every zoom. The app owns its chrome compensation manually, so
     the transform's padding must always be zero. */
  const padded = await page.evaluate(() => {
    const p = window.__offwegoMap.getPadding()
    return p.top + p.bottom + p.left + p.right
  })
  expect(padded, 'transform padding must never persist').toBe(0)

  const before = await centre()
  for (let round = 0; round < 3; round += 1) {
    // By name, not position: buttons come and go from this cluster.
    await page.getByTitle('Zoom in').click()
    await still()
    await page.getByTitle('Zoom out').click()
    await still()
  }
  const after = await centre()

  expect(Math.abs(after[0] - before[0]), 'the map drifted east or west').toBeLessThan(1e-4)
  expect(Math.abs(after[1] - before[1]), 'the map drifted north or south').toBeLessThan(1e-4)
})

test('following the travellers actually zooms in, and then holds still', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page) // open() leaves follow off

  const camera = () =>
    page.evaluate(() => ({
      zoom: window.__offwegoMap.getZoom(),
      moving: window.__offwegoMap.isMoving(),
    }))
  await page.evaluate(() => window.__offwegoMap.jumpTo({ center: [4.75, 52.32], zoom: 9 }))
  await expect.poll(async () => (await camera()).zoom).toBeLessThan(9.5)

  await page.getByRole('button', { name: 'Follow the travellers' }).click()
  /* Two phones report in the sample now, so following frames them BOTH — a
     box across a couple of kilometres of city sits nearer 13 than 15. The
     guard's job is unchanged: the original bug was a toggle that did not
     move the camera at all, and from zoom 9 any real engagement clears this. */
  await expect
    .poll(async () => (await camera()).zoom, {
      message: 'following should dive toward the travellers',
      timeout: 5000,
    })
    .toBeGreaterThan(11.5)

  // And having arrived it stays: live positions arrive on a timer, and a map
  // that re-frames itself every time one does cannot be read.
  await expect.poll(async () => (await camera()).moving, { timeout: 5000 }).toBe(false)
  const settled = await camera()
  await page.waitForTimeout(1200)
  const later = await camera()
  expect(later.moving, 'the camera started moving again on its own').toBe(false)
  expect(Math.abs(later.zoom - settled.zoom)).toBeLessThan(0.01)
})

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
  const cx = box.x + box.width * 0.6,
    cy = box.y + box.height * 0.55
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 25; i++) await page.mouse.move(cx - i * 8, cy - i * 3)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => !window.__offwegoMap?.isMoving())).toBe(true)
  expect(await page.locator('.detailcard h3').textContent()).toBe(after)
})

test('what is selected is in the URL, so the view can be linked and gone back from', async ({
  page,
}) => {
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

  const spot = await emptyMapPoint(page)
  await page.mouse.click(spot.x, spot.y)
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
  expect(moved.slice().sort()).toEqual(before.slice().sort()) // same set, new order

  await page.locator('.editor .ef .ord').nth(1).click()
  await expect.poll(() => stopTitles(page)).toEqual(before)
})

test('placing a pin is its own mode, and escape leaves it', async ({ page }) => {
  await open(page)
  const place = page.getByRole('button', { name: 'Place a pin' })
  await place.click()
  await expect(
    page.locator('.edithint, .glass', { hasText: 'Click the map where the stop is' }).first(),
  ).toBeVisible()
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
    ['Timeline', 'Timeline'],
    ['Photos', 'Photos'],
    ['People', 'People'],
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
    {
      name: 'camera-one.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    },
    {
      name: 'camera-two.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    },
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
  // Clicking a photograph opens the viewer directly.
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.locator('.grid button').first().click()
  await expect(page.locator('.viewer')).toBeVisible()

  // Caption editing lives behind the pencil's Photo details dialog now.
  const pencil = page.getByTitle('Edit photo details')
  if (await pencil.count()) {
    await pencil.click()
    await page.getByLabel('Caption').fill('A brand new caption')
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.locator('.vcap h2')).toHaveText('A brand new caption')
  }
})

test('a comment posts and can be deleted again', async ({ page }) => {
  await open(page)
  // Clicking a photograph opens the viewer directly.
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.locator('.grid button').first().click()
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

  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('menuitem', { name: 'Day map' }).click()
  await expect(root).toHaveAttribute('data-theme', 'light')

  await page.reload()
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await expect(root).toHaveAttribute('data-theme', 'light')
})

test('the map keeps something painted through zoom and pan', async ({ page }) => {
  await open(page)
  const painted = async () =>
    page.evaluate(() => {
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
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('menuitem', { name: 'Trip settings' }).click()
  await expect(page).toHaveURL(/sheet=settings/)
  await expect(page.getByRole('dialog')).toBeVisible()

  await page.locator('.dlg').getByRole('button', { name: 'People', exact: true }).click()
  await expect(page).toHaveURL(/tab=people/)
  await expect(page.locator('.dlg').getByPlaceholder('them@example.com')).toBeVisible()

  // Scoped and exact: role names match by substring, and any copy anywhere on
  // the screen that mentions a location would otherwise answer to this.
  await page.locator('.dlg').getByRole('button', { name: 'Location', exact: true }).click()
  await expect(page).toHaveURL(/tab=phones/)
})

/* A box that scrolls on one axis computes the other to auto, so a device token
   or a tracker URL turned the settings sheet into a sideways scroller — and the
   two ways of finishing with the sheet, saving and closing, sat on different
   rows with the scrolling content between them. */
/* The stop editor is anchored to the bottom of a phone screen. When the
   keyboard opens, iOS keeps the page at its full height and only shrinks the
   visual viewport — so the panel being typed into sat behind the keyboard, and
   the fields and the save button with it. */
test('the stop editor takes the phone screen and stays above the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await page.locator('.fcard', { hasText: 'Rijksmuseum' }).first().click()
  await page.locator('.detailcard').getByTitle('Edit this stop').click()
  await expect(page.locator('.editor')).toBeVisible()
  await page.waitForTimeout(350) // it rises into place over 220ms

  const geometry = async () =>
    page.evaluate(() => {
      const editor = document.querySelector('.editor').getBoundingClientRect()
      const save = document.querySelector('.editor .btn.pri').getBoundingClientRect()
      const bar = document.querySelector('header').closest('div').getBoundingClientRect()
      return { top: editor.y, bottom: editor.bottom, save: save.bottom, chrome: bar.bottom }
    })

  // On a phone it is the screen, not a card floating over it: with the chrome
  // and the day bar and a keyboard all taking their share there was about a
  // hundred pixels left for the thing being typed into.
  const resting = await geometry()
  expect(resting.top, 'the editor does not start at the top of the screen').toBeLessThanOrEqual(1)
  expect(resting.bottom, 'the editor does not reach the bottom').toBeGreaterThanOrEqual(843)

  // What iOS does when the keyboard opens: the page keeps its height, and this
  // is the part of it that is no longer visible.
  await page.evaluate(() => document.documentElement.style.setProperty('--keyboard', '364px'))
  const lifted = await geometry()

  expect(lifted.bottom, 'the editor runs on behind the keyboard').toBeLessThanOrEqual(844 - 364)
  expect(lifted.save, 'the save button is behind the keyboard').toBeLessThanOrEqual(844 - 364)
  expect(lifted.top, 'the editor lost its header off the top').toBeGreaterThanOrEqual(0)

  const scrolls = await page.evaluate(() => {
    const body = document.querySelector('.editor .eb')
    return body.scrollHeight > body.clientHeight
  })
  expect(scrolls, 'the fields cannot be reached once the keyboard is up').toBe(true)
})

/* The sheet is centred, so when it was sized to whatever tab was showing, its
   title, its tabs and its buttons all moved as you went between them — every
   tab arrived with its controls somewhere new. */
test('the settings chrome does not move when you change tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('menuitem', { name: 'Trip settings' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const chrome = () =>
    page.evaluate(() => {
      const round = box => [Math.round(box.y), Math.round(box.height)]
      return {
        sheet: round(document.querySelector('.dlg').getBoundingClientRect()),
        footer: round(document.querySelector('.dlgfoot').getBoundingClientRect()),
      }
    })

  const seen = []
  for (const tab of ['Trip', 'People', 'Location', 'Trip']) {
    await page.locator('.dlg').getByRole('button', { name: tab, exact: true }).click()
    await page.waitForTimeout(250)
    seen.push(await chrome())
  }

  for (const state of seen.slice(1)) {
    expect(state, 'the sheet changes shape with the tab').toEqual(seen[0])
  }
})

test('the settings sheet finishes on one row and never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('menuitem', { name: 'Trip settings' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // The header carries a Close too, so both of these come from the footer.
  const save = page.locator('.dlgfoot').getByRole('button', { name: 'Save' })
  const close = page.locator('.dlgfoot').getByRole('button', { name: 'Close', exact: true })
  const [saveBox, closeBox] = await Promise.all([save.boundingBox(), close.boundingBox()])

  expect(
    Math.abs(saveBox.y - closeBox.y),
    'saving and closing are on different rows',
  ).toBeLessThanOrEqual(1)
  expect(saveBox.height, 'the two buttons are different heights').toBe(closeBox.height)

  const sideways = await page.evaluate(() => {
    const body = document.querySelector('.dlg .mb')
    return { style: getComputedStyle(body).overflowX, over: body.scrollWidth - body.clientWidth }
  })
  expect(sideways.style, 'the sheet body can scroll sideways').toBe('hidden')
  expect(sideways.over, 'something inside the sheet is wider than it').toBeLessThanOrEqual(1)
})

test('the roster lists people and takes an invite', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('menuitem', { name: 'Trip settings' }).click()
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
  await expect
    .poll(() => page.locator('.editor .f input').first().inputValue(), { timeout: 25000 })
    .not.toBe('')
})

test('the sights panel shows real landmarks with a picture and a description', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Sights', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sights nearby' })).toBeVisible()
  await expect(page.locator('.sight').first()).toBeVisible({ timeout: 25000 })
  await expect(page.locator('.sight .sname').first()).not.toHaveText('')
})

test('attractions are drawn across the map and open into a card', async ({ page }) => {
  await open(page)
  // The layer is drawn by the GPU, so there is nothing in the DOM to count;
  // ask the source what it is holding.
  const drawn = () =>
    page.evaluate(
      () => window.__offwegoMap?.getSource('attr')?.serialize?.().data?.features?.length ?? 0,
    )

  await expect.poll(drawn, { timeout: 30000 }).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('menuitem', { name: 'Hide attractions' }).click()
  await expect.poll(drawn).toBe(0)

  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('menuitem', { name: 'Show attractions' }).click()
  await expect.poll(drawn, { timeout: 30000 }).toBeGreaterThan(0)
})

test('the status capsule takes its own taps — the AI button must not blanket the row', async ({
  page,
}) => {
  // Phone-width chrome is where the AI button once cast an invisible row-wide
  // tap plate (a static hitslop anchors its ::after to the whole row): any tap
  // on the capsule opened the assistant. Playwright's actionability check is
  // the assertion — a covered capsule refuses the click.
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const capsule = page.locator('button:has(b[aria-live=polite])')
  await expect(capsule).toBeVisible()
  await capsule.click()
  await expect(page.getByText('Ask about this trip')).toBeHidden()
})

test('the map answers how far to anywhere — right-click, ask, read the pill', async ({ page }) => {
  await open(page)
  const spot = await emptyMapPoint(page)
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'How far from me' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'from you' })).toBeVisible()
  const drawn = () =>
    page.evaluate(
      () =>
        window.__offwegoMap?.getSource('measure')?.serialize?.().data?.geometry?.coordinates
          ?.length ?? 0,
    )
  await expect.poll(drawn).toBeGreaterThan(1)
})

test('a selected stop answers how far from you, and draws the way', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await page
    .getByRole('button', { name: /Rijksmuseum/ })
    .first()
    .click()
  // The demo has no engine, so the crow answers: a distance and a straight
  // dashed line from Maya's live dot to the museum.
  await expect(page.locator('.detailcard')).toContainText('km direct from you')
  const drawn = () =>
    page.evaluate(
      () =>
        window.__offwegoMap?.getSource('measure')?.serialize?.().data?.geometry?.coordinates
          ?.length ?? 0,
    )
  await expect.poll(drawn, { timeout: 15000 }).toBeGreaterThan(1)
})

test('flying to an airport draws its gates', async ({ page }) => {
  await open(page)
  // Schiphol is a sample stop and richly mapped in OSM. The layer is GPU-drawn,
  // so ask the source what it holds — the night the gates were fetched and
  // never drawn, the source itself was missing.
  await page.evaluate(() => {
    window.__offwegoMap?.jumpTo({ center: [4.7639, 52.3105], zoom: 14.6 })
  })
  const gates = () =>
    page.evaluate(
      () =>
        window.__offwegoMap
          ?.getSource('indoor')
          ?.serialize?.()
          .data?.features?.filter(f => f.properties?.kind === 'gate').length ?? 0,
    )
  await expect.poll(gates, { timeout: 30000 }).toBeGreaterThan(0)
})

test('a flight with seats shows where everyone sits, on a drawn cabin', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  await page.getByRole('button', { name: 'Where we sit' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  // The demo family holds 31A and 31B on the flight home; the cabin is drawn.
  await expect(sheet.getByText('Maya · 31A')).toBeVisible()
  await expect(sheet.getByText('Alex · 31B')).toBeVisible()
  await expect(sheet.getByRole('img', { name: 'Cabin seat map' })).toBeVisible()
})

test('the getting-there chain renders the travel legs with their countdowns', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Getting there' })).toBeVisible()
  // The sample legs are built relative to now, so the demo's travel day is
  // forever tomorrow: the train to Schiphol, then the KLM flight home.
  await expect(page.getByText('IC 3155')).toBeVisible()
  await expect(page.getByText('KL 677')).toBeVisible()
  await expect(page.getByText('R7QWXZ')).toBeVisible()
  await expect(page.getByText(/to change —/)).toBeVisible()
})
