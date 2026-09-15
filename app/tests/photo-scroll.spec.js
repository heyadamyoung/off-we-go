import { test, expect } from '@playwright/test'
import { atDemoTime } from './demo-clock'

/* Reported from the road: "scrolling photos can be unresponsive at times,
   especially in the zoom view. It's also a problem in normal view though."
 *
 * Nothing here is slow on its own. What was slow is how often it ran. A finger
 * reports itself a hundred and twenty times a second, and every one of those
 * reports was ending in a bounding rect — which makes the browser stop and lay
 * the page out there and then — and a React render. Several times over for
 * each frame anybody could actually see, and the main thread busy doing the
 * invisible ones at the moment the next touch arrives.
 *
 * So these count the work rather than time it. A stopwatch on a shared CI box
 * measures the box; a count of forced layouts during one drag measures the
 * thing that was wrong.
 */

const MAP_READY = 9000

test.beforeEach(async ({ page }) => {
  await page.route('https://en.wikipedia.org/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
    }),
  )
})

async function openPhotos(page) {
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.evaluate(() => window.__offwegoMap?.stop())
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await expect(page.locator('.pgrid-photo').first()).toBeVisible({ timeout: 8000 })
}

async function openViewer(page) {
  await openPhotos(page)
  await page.locator('.pgrid-photo').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })
}

/* Count the forced layouts an element is put through, and the pointer moves
   that arrive while they happen — so a run where the drag never really
   happened cannot pass by having measured nothing. */
async function watchLayout(page, selector) {
  await page.evaluate(sel => {
    const watched = document.querySelector(sel)
    const rect = Element.prototype.getBoundingClientRect
    window.__layouts = 0
    window.__moves = 0
    window.__unwatch = () => {
      Element.prototype.getBoundingClientRect = rect
      watched?.removeEventListener('pointermove', count, true)
    }
    const count = () => {
      window.__moves++
    }
    watched?.addEventListener('pointermove', count, true)
    Element.prototype.getBoundingClientRect = function measured() {
      if (this === watched || watched?.contains(this)) window.__layouts++
      return rect.call(this)
    }
  }, selector)
}

const layoutTally = page =>
  page.evaluate(() => {
    window.__unwatch?.()
    return { layouts: window.__layouts, moves: window.__moves }
  })

test('a drag across the full-screen picture measures the page once, not once a move', async ({
  page,
}) => {
  /* The zoom view, which is the one it was reported worst in. Every pointer
     move read the stage's bounding rect to work out how far the picture was
     allowed to go — an answer that cannot change while a finger is down,
     because the stage is pinned to the screen and the picture's natural size
     belongs to the file. */
  await page.setViewportSize({ width: 390, height: 844 })
  await openViewer(page)
  await page.locator('.vpane.on .vmaintap').click()
  const stage = page.locator('.vzstage')
  await expect(stage).toBeVisible({ timeout: 8000 })

  /* The one being looked at, not its neighbours: the full-screen view is a
     strip of three, the same as the viewer behind it. */
  const scale = async () => {
    const t = await page.locator('.vzpane.on img').evaluate(el => getComputedStyle(el).transform)
    return t === 'none' ? 1 : Number(t.match(/matrix\(([-\d.]+)/)?.[1] ?? 1)
  }
  // Zoomed in, so a drag pans the picture rather than turning the page.
  await stage.dblclick()
  await expect.poll(scale).toBeGreaterThan(1.5)

  const box = await stage.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)

  await watchLayout(page, '.vzstage')
  await page.mouse.down()
  await page.mouse.move(x - box.width * 0.3, y - box.height * 0.2, { steps: 40 })
  await page.mouse.up()
  const { layouts, moves } = await layoutTally(page)

  expect(moves, 'the drag never happened').toBeGreaterThan(20)
  expect(
    layouts,
    `the stage was measured ${layouts} times across ${moves} pointer moves`,
  ).toBeLessThanOrEqual(3)
})

test('the strip along the bottom is read once a frame, not once a scroll event', async ({
  page,
}) => {
  /* The normal view. A flicked strip fires scroll events faster than the
     screen paints, and each one read the row's layout back and could hand it a
     new slice of the trip to build. */
  await page.setViewportSize({ width: 700, height: 800 })
  await openViewer(page)
  const film = page.locator('.vfilm')
  await expect(film).toBeVisible()

  const reads = await page.evaluate(async () => {
    const row = document.querySelector('.vfilm')
    if (!row) return null
    const own = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft')
    let counted = 0
    Object.defineProperty(row, 'scrollLeft', {
      configurable: true,
      get() {
        counted++
        return own.get.call(this)
      },
      set(to) {
        own.set.call(this, to)
      },
    })

    /* A flick's worth of scroll events in one go: the browser coalesces its
       own, so they are dispatched by hand to be sure there are more of them
       than there are frames. */
    const fired = 60
    for (let step = 0; step < fired; step++) {
      own.set.call(row, step * 4)
      row.dispatchEvent(new Event('scroll', { bubbles: false }))
    }
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))
    delete row.scrollLeft
    return { counted, fired }
  })

  expect(reads, 'the strip is not on the page').not.toBeNull()
  expect(
    reads.counted,
    `the strip read its own layout ${reads.counted} times for ${reads.fired} scroll events`,
  ).toBeLessThan(10)
})

test('the photo grid recalculates its style once a frame, not once a scroll event', async ({
  page,
}) => {
  /* The Photos tab itself — the normal view. Every scroll event read the
     grid's computed padding back, which is a style recalculation the browser
     has to do there and then, and then set a scroll offset that changes on
     every single event, which re-rendered the whole window of tiles. Several
     times for each frame anybody sees.

     Padding does not move while a thumb does, so it is read when the shape of
     the thing changes and not otherwise. */
  await page.setViewportSize({ width: 390, height: 844 })
  await openPhotos(page)

  const styles = await page.evaluate(async () => {
    /* The scroller the grid finds for itself: the nearest ancestor of a tile
       that actually scrolls. */
    let node = document.querySelector('.pgrid-photo')
    while (node && node !== document.body) {
      const overflow = getComputedStyle(node).overflowY
      if (overflow === 'auto' || overflow === 'scroll') break
      node = node.parentElement
    }
    if (!node || node === document.body) return null

    const real = window.getComputedStyle
    let counted = 0
    window.getComputedStyle = function counting(...args) {
      counted++
      return real.apply(this, args)
    }

    const fired = 60
    for (let step = 0; step < fired; step++) {
      node.scrollTop = step * 6
      node.dispatchEvent(new Event('scroll', { bubbles: false }))
    }
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))
    window.getComputedStyle = real
    return { counted, fired }
  })

  expect(styles, 'no scroller was found under the photo grid').not.toBeNull()
  expect(
    styles.counted,
    `the page recalculated style ${styles.counted} times for ${styles.fired} scroll events`,
  ).toBeLessThan(10)
})
