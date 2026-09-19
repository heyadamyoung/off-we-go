import { test, expect } from './fixture.js'

import { atDemoTime } from './demo-clock'

/* Settled: the network quiet, the fonts in, and two frames drawn. The
   network is sealed and motion is reduced for every test, so this is what
   the sleeps that used to sit here were waiting for.

   Watched from out here rather than asked of Playwright's networkidle, which
   is half a second of silence by definition: nineteen times a sweep, most of
   it spent watching a page that had nothing left to fetch. A quarter of a
   second since the page last started or finished a request is the same
   certainty on a sealed network. Silence rather than a count of what is
   open: a request still in flight when the next screen is opened is torn
   down with its frame and never reported as finished, and a count that
   waited for it waited for ever. */
const traffic = new WeakMap()
function watch(page) {
  const state = { lastEvent: Date.now() }
  const seen = () => {
    state.lastEvent = Date.now()
  }
  page.on('request', seen)
  page.on('requestfinished', seen)
  page.on('requestfailed', seen)
  traffic.set(page, state)
}
async function settled(page) {
  const state = traffic.get(page)
  await expect.poll(() => Date.now() - state.lastEvent >= 250, { timeout: 30_000 }).toBe(true)
  await page.evaluate(() =>
    document.fonts.ready.then(
      () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    ),
  )
}

test.beforeEach(async ({ page }) => {
  watch(page)
  // Freeze the demo's walking traveller: layout and offline assertions need a
  // world that holds still. Set before boot; the router strips query params.
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
})

/* A sweep rather than another one-off: every screen this app has, at the two
   phone widths that matter, checking the two faults that kept being reported —
   something sticking out through the side of what contains it, and a control
   nothing can actually tap. Both come from the same place: a flex item will not
   shrink below its content unless it is told it may. */

const PHONES = [
  ['a modern phone', 390, 844],
  ['the smallest phone', 320, 568],
]

const SWEEP = scope => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)})
  if (!root) return [{ kind: 'missing', el: ${JSON.stringify(scope)} }]
  const findings = []
  const name = el => {
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(' ').filter(Boolean).slice(0, 3).join('.') : ''
    return el.tagName.toLowerCase() + cls
  }
  const scrolls = el => {
    const s = getComputedStyle(el)
    return s.overflowX === 'auto' || s.overflowX === 'scroll'
  }
  const box = root.getBoundingClientRect()
  const right = Math.min(box.right, innerWidth)
  const left = Math.max(box.left, 0)

  for (const el of root.querySelectorAll('*')) {
    // The map draws its pins where the world puts them, most of it off screen.
    if (el.closest('.mapcanvas, .world, .maplibregl-map, .globe')) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.opacity === '0') continue

    let inScroller = false
    for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
      if (scrolls(p)) { inScroller = true; break }
    }
    if (!inScroller && (r.right > right + 1 || r.left < left - 1)) {
      findings.push(name(el) + ' sticks out to ' + Math.round(r.right) + ', past ' + Math.round(right))
      continue
    }

    if (el.matches('button, a[href], input, select, textarea')) {
      let onShow = true
      for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
        if (getComputedStyle(p).overflow === 'visible') continue
        const pr = p.getBoundingClientRect()
        if (r.bottom > pr.bottom + 1 || r.top < pr.top - 1
            || r.right > pr.right + 1 || r.left < pr.left - 1) { onShow = false; break }
      }
      const hit = onShow && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        findings.push(name(el) + ' cannot be tapped: ' + name(hit) + ' is over it')
      }
    }
  }
  return findings
})()`

const STATES = [
  [
    'the dashboard',
    'main',
    async page => {
      await page.goto('/')
      await settled(page)
    },
  ],
  [
    'your profile',
    'main',
    async page => {
      await page.goto('/profile')
      await settled(page)
    },
  ],
  [
    'a new trip',
    'main',
    async page => {
      await page.goto('/new')
      await settled(page)
    },
  ],
  [
    'past trips',
    'main',
    async page => {
      await page.goto('/past')
      await settled(page)
    },
  ],
  [
    'the trip chrome',
    'header',
    async page => {
      await atDemoTime(page)
      await page.goto('/trips/sample')
      await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20_000 })
      await settled(page)
    },
  ],
  [
    'the day bar',
    '.fdays',
    async page => {
      await settled(page)
    },
  ],
  [
    'the timeline',
    'aside',
    async page => {
      await page.getByRole('button', { name: 'Timeline', exact: true }).click()
      await expect(page.locator('aside')).toBeVisible()
    },
  ],
  [
    'the photos panel',
    'aside',
    async page => {
      await page.getByRole('button', { name: 'Photos', exact: true }).click()
      await settled(page)
    },
  ],
  [
    'the people panel',
    'aside',
    async page => {
      /* Back to the map first. The gallery is a screen rather than a side
         panel now — it covers the trip's own navigation while it is open — so
         the next panel is reached the way somebody actually reaches it. */
      await page.keyboard.press('Escape')
      await expect(page).not.toHaveURL(/view=/)
      await page.getByRole('button', { name: 'People', exact: true }).click()
      await settled(page)
    },
  ],
  [
    'a stop',
    '.detailcard',
    async page => {
      await page.getByRole('button', { name: 'Map', exact: true }).click()
      await settled(page)
      await page.locator('.fcard').first().click()
      await expect(page.locator('.detailcard')).toBeVisible()
    },
  ],
  [
    'the stop editor',
    '.editor',
    async page => {
      await page.locator('.detailcard').getByTitle('Edit this stop').click()
      await expect(page.locator('.editor')).toBeVisible()
    },
  ],
  [
    'trip settings',
    '.dlg',
    async page => {
      await page.keyboard.press('Escape')
      await settled(page)
      await page.getByRole('button', { name: 'More tools' }).click()
      await page.getByRole('menuitem', { name: 'Trip settings' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  ],
  [
    'the people tab',
    '.dlg',
    async page => {
      await page.locator('.dlg').getByRole('button', { name: 'People', exact: true }).click()
      await settled(page)
    },
  ],
  [
    'the location tab',
    '.dlg',
    async page => {
      await page.locator('.dlg').getByRole('button', { name: 'Location', exact: true }).click()
      await settled(page)
    },
  ],
  [
    'adding photos',
    '.dlg',
    async page => {
      await page.locator('.dlgfoot').getByRole('button', { name: 'Close', exact: true }).click()
      await settled(page)
      await page.getByRole('button', { name: 'Add photos' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  ],
]

/* Edit mode unlocks dragging pins, drawing the route and searching for places,
   and every one of those controls is on a hint bar that hides below 768px. What
   was left of the pencil on a phone was "tap the map to add a stop" — which is
   what the pin beside it already says, and says out loud. */
test('the pencil is not offered where the things it unlocks are hidden', async ({ page }) => {
  const pencil = () => page.getByRole('button', { name: 'Edit the itinerary' })
  const pin = () => page.getByRole('button', { name: 'Place a pin' })

  await page.setViewportSize({ width: 390, height: 844 })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20_000 })
  await expect(
    pencil(),
    'the pencil is on a phone, where it can do almost none of its job',
  ).toBeHidden()
  await expect(pin(), 'the one control that does add a stop on a phone has gone too').toBeVisible()

  await page.setViewportSize({ width: 1024, height: 800 })
  await settled(page)
  await expect(
    pencil(),
    'the pencil is missing where the hint bar it belongs to is shown',
  ).toBeVisible()

  // And it may not vanish while it is on, or there is no way back out.
  await pencil().click()
  await expect(page.locator('.edithint')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await settled(page)
  await expect(
    page.getByRole('button', { name: 'Done editing' }),
    'edit mode is on with no way to turn it off',
  ).toBeVisible()
})

/* A box that scrolls sideways computes its other axis to auto as well, so every
   horizontal strip in the app could also be dragged up and down — and the top
   chrome ended up with its buttons half out of their own bar. */
test('the strips that scroll sideways do not also scroll up and down', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20_000 })
  await settled(page)

  const strips = await page.evaluate(() => {
    const found = [
      ['the action strip', document.querySelector('.tb')?.parentElement],
      ['the day chips', document.querySelector('.fdays')],
      ['the card row', document.querySelector('.fcard')?.parentElement],
    ]
    return found.map(([what, el]) => {
      if (!el) return { what, missing: true }
      el.scrollTop = 60
      const moved = el.scrollTop
      el.scrollTop = 0
      return { what, moved, spare: el.scrollHeight - el.clientHeight }
    })
  })

  for (const strip of strips) {
    expect(strip.missing, `${strip.what} is not there to check`).toBeUndefined()
    expect(strip.moved, `${strip.what} scrolled vertically`).toBe(0)
    expect(strip.spare, `${strip.what} has content hanging below it`).toBeLessThanOrEqual(0)
  }
})

/* The bar is a fixed height and the cards fill it, so trimming the bar to suit
   one thing clipped another: first the times were cut mid-line, then the names
   were. A name half visible is worse than no name. */
test('a card on the day bar shows its whole name', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20_000 })
  await settled(page)

  const cards = await page.evaluate(() => {
    const row = document.querySelector('.fcard').parentElement.getBoundingClientRect()
    return [...document.querySelectorAll('.fcard')].slice(0, 4).map(card => {
      const name = card.querySelector('.t').getBoundingClientRect()
      return {
        text: card.querySelector('.t').textContent.slice(0, 20),
        cut: Math.round(name.bottom - row.bottom),
        lines: Math.round(name.height),
      }
    })
  })

  for (const card of cards) {
    expect(card.cut, `"${card.text}" is cut off by the bottom of the bar`).toBeLessThanOrEqual(0)
    expect(card.lines, `"${card.text}" has no room to be read at all`).toBeGreaterThan(10)
  }
})

/* Two sweeps a phone rather than one: the first four screens are each a
   page of their own, and the rest are one trip walked through state by
   state, each built on the last. Apart, the two halves run on two workers
   and neither is the longest test in the suite by a distance.

   Four tests written out rather than made in a loop: the shards are dealt
   by file and line (see scripts/shard-tests.mjs), and four tests on one
   line are one card in that deal — every sweep, the heaviest tests in the
   suite, landed on the same shard. */
const AROUND = ['the screens around the trip', STATES.slice(0, 4)]
const ITSELF = ['the trip itself', STATES.slice(4)]
const [MODERN, SMALLEST] = PHONES

const title = ([phone], [which]) => `nothing sticks out or hides from a tap on ${phone}: ${which}`

const sweep =
  ([, width, height], [, states]) =>
  async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.route('https://en.wikipedia.org/**', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
      }),
    )

    const trouble = []
    for (const [what, scope, reach] of states) {
      await reach(page)
      /* The screen is there before it is measured. A quiet network is not a
         drawn page: the index.html served is an empty shell that React fills
         once the route's chunk has been evaluated, and on a runner with six
         workers booting pages at once that took longer than the silence the
         five stand-alone screens waited for — so the sweep found no root,
         and reported it as an object nobody could read. */
      await expect(page.locator(scope).first(), `${what} never appeared`).toBeAttached()
      for (const finding of await page.evaluate(SWEEP(scope))) {
        trouble.push(`${what}: ${typeof finding === 'string' ? finding : JSON.stringify(finding)}`)
      }
    }

    expect(trouble, `${width}px is wider than these are behaving`).toEqual([])
  }

test(title(MODERN, AROUND), sweep(MODERN, AROUND))
test(title(MODERN, ITSELF), sweep(MODERN, ITSELF))
test(title(SMALLEST, AROUND), sweep(SMALLEST, AROUND))
test(title(SMALLEST, ITSELF), sweep(SMALLEST, ITSELF))

/* The grabber at the top of the day bar follows a finger: pull it down and
   the bar collapses to the map, pull it up and the day's cards come back, a
   short pull settles where it was, and a tap still toggles. */
test('the day bar is dragged open and closed by its grabber, and still taps', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  const grabber = page.locator('.grabber')
  await expect(grabber).toBeVisible()
  const pull = async by => {
    const box = await grabber.boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + by / 2, { steps: 3 })
    await page.mouse.move(x, y + by, { steps: 3 })
    await page.mouse.up()
  }
  if ((await grabber.getAttribute('aria-expanded')) !== 'true') await grabber.click()
  await expect(grabber).toHaveAttribute('aria-expanded', 'true')
  await pull(60)
  await expect(grabber).toHaveAttribute('aria-expanded', 'false')
  await pull(-60)
  await expect(grabber).toHaveAttribute('aria-expanded', 'true')
  /* Short of the threshold the bar settles back where it was. */
  await pull(12)
  await expect(grabber).toHaveAttribute('aria-expanded', 'true')
  await grabber.click()
  await expect(grabber).toHaveAttribute('aria-expanded', 'false')
  await grabber.click()
  await expect(grabber).toHaveAttribute('aria-expanded', 'true')
})

/* Pulled up from its peek, the bar's top edge comes with the finger and its
   feet never leave the bottom of the screen: it is one tall sheet hung from
   the edge, moved by a transform, with the part past its stage below the
   edge. Sliding a short bar up left a strip of map under it and then snapped
   it back before growing it, which read as the chrome coming loose. */
test('pulled up from its peek, the bar rises from the bottom edge and never lifts off it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  const grabber = page.locator('.grabber')
  const bar = page.locator('.tripbar')
  if ((await grabber.getAttribute('aria-expanded')) !== 'false') await grabber.click()
  await expect(grabber).toHaveAttribute('aria-expanded', 'false')
  await expect(bar).toHaveAttribute('data-stage', 'peek')
  const visible = async () => 844 - (await bar.boundingBox()).y
  await expect.poll(visible).toBe(80)
  const box = await grabber.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y - 30, { steps: 3 })
  await page.mouse.move(x, y - 60, { steps: 3 })
  /* One for one with the finger, and the bar reaches below the edge: no gap. */
  expect(Math.round(await visible())).toBe(140)
  const held = await bar.boundingBox()
  expect(held.y + held.height).toBeGreaterThanOrEqual(844)
  /* The day is in it as it rises, not a stretch of empty glass. */
  await expect(bar.locator('.fcard').first()).toBeVisible()
  /* The chrome standing on the bar rides its top edge, the same sixteen
     pixels above it as at rest. */
  const chrome = await page.locator('.mapchrome').boundingBox()
  expect(Math.round(held.y - (chrome.y + chrome.height))).toBe(16)
  await page.mouse.up()
  await expect(grabber).toHaveAttribute('aria-expanded', 'true')
  await expect(bar).toHaveAttribute('data-stage', 'open')
  await expect.poll(async () => Math.round(await visible())).toBe(208)
  expect(await bar.evaluate(el => el.style.transform)).toBe('')
  const rested = await page.locator('.mapchrome').boundingBox()
  expect(Math.round((await bar.boundingBox()).y - (rested.y + rested.height))).toBe(16)
})

/* Pulled up past its open height the bar keeps going, to the top chrome and
   no further, and the cards wrap into a grid with pictures big enough to
   look at. A pull down brings it back to open; a pull down that went past
   the threshold never snaps back. */
test('pulled up past open, the bar covers the map up to the top chrome, and comes back down', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  const grabber = page.locator('.grabber')
  const bar = page.locator('.tripbar')
  await expect(bar).toHaveAttribute('data-stage', 'open')
  const pull = async by => {
    const box = await grabber.boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + by / 2, { steps: 4 })
    await page.mouse.move(x, y + by, { steps: 4 })
    await page.mouse.up()
  }
  await pull(-300)
  await expect(bar).toHaveAttribute('data-stage', 'tall')
  /* Up to the top chrome — the title and the row of tabs — and no further:
     a sheet that covers them is a screen you are stuck in. */
  const tabs = await page.locator('.tbv').first().boundingBox()
  await expect
    .poll(async () => Math.round((await bar.boundingBox()).y))
    .toBeGreaterThanOrEqual(Math.round(tabs.y + tabs.height) - 1)
  expect(Math.round((await bar.boundingBox()).y)).toBeLessThanOrEqual(
    Math.round(tabs.y + tabs.height) + 12,
  )
  /* What stood on the bar is gone, not standing over the title. */
  const chrome = page.locator('.mapchrome')
  await expect.poll(() => chrome.evaluate(el => getComputedStyle(el).opacity)).toBe('0')
  expect(await chrome.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')
  /* The cards, two to a row, with room. */
  const cards = bar.locator('.fcard')
  const first = await cards.nth(0).boundingBox()
  const second = await cards.nth(1).boundingBox()
  expect(Math.round(first.y)).toBe(Math.round(second.y))
  expect(first.x + first.width).toBeLessThanOrEqual(second.x + 1)
  expect(first.width).toBeGreaterThan(150)
  /* Down again: past the threshold it goes to open and stays there. */
  await pull(80)
  await expect(bar).toHaveAttribute('data-stage', 'open')
  await expect.poll(async () => Math.round(844 - (await bar.boundingBox()).y)).toBe(208)
  /* And the chrome is back on the bar, where it was. */
  await expect.poll(() => chrome.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
  const rested = await chrome.boundingBox()
  expect(Math.round((await bar.boundingBox()).y - (rested.y + rested.height))).toBe(16)
  await pull(80)
  await expect(bar).toHaveAttribute('data-stage', 'peek')
})
