import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
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
      await page.waitForTimeout(2500)
    },
  ],
  [
    'your profile',
    'main',
    async page => {
      await page.goto('/profile')
      await page.waitForTimeout(1200)
    },
  ],
  [
    'a new trip',
    'main',
    async page => {
      await page.goto('/new')
      await page.waitForTimeout(1000)
    },
  ],
  [
    'past trips',
    'main',
    async page => {
      await page.goto('/past')
      await page.waitForTimeout(1000)
    },
  ],
  [
    'invitations',
    'main',
    async page => {
      await page.goto('/invitations')
      await page.waitForTimeout(1000)
    },
  ],
  [
    'the trip chrome',
    'header',
    async page => {
      await page.goto('/trips/sample')
      await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(1500)
    },
  ],
  [
    'the day bar',
    '.fdays',
    async page => {
      await page.waitForTimeout(200)
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
      await page.waitForTimeout(600)
    },
  ],
  [
    'the people panel',
    'aside',
    async page => {
      await page.getByRole('button', { name: 'People', exact: true }).click()
      await page.waitForTimeout(600)
    },
  ],
  [
    'a stop',
    '.detailcard',
    async page => {
      await page.getByRole('button', { name: 'Map', exact: true }).click()
      await page.waitForTimeout(400)
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
      await page.waitForTimeout(300)
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
      await page.waitForTimeout(500)
    },
  ],
  [
    'the location tab',
    '.dlg',
    async page => {
      await page.locator('.dlg').getByRole('button', { name: 'Location', exact: true }).click()
      await page.waitForTimeout(500)
    },
  ],
  [
    'adding photos',
    '.dlg',
    async page => {
      await page.locator('.dlgfoot').getByRole('button', { name: 'Close', exact: true }).click()
      await page.waitForTimeout(400)
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
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20_000 })
  await expect(
    pencil(),
    'the pencil is on a phone, where it can do almost none of its job',
  ).toBeHidden()
  await expect(pin(), 'the one control that does add a stop on a phone has gone too').toBeVisible()

  await page.setViewportSize({ width: 1024, height: 800 })
  await page.waitForTimeout(300)
  await expect(
    pencil(),
    'the pencil is missing where the hint bar it belongs to is shown',
  ).toBeVisible()

  // And it may not vanish while it is on, or there is no way back out.
  await pencil().click()
  await expect(page.locator('.edithint')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
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
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1500)

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
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1500)

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

for (const [phone, width, height] of PHONES) {
  test(`nothing sticks out or hides from a tap on ${phone}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.route('https://en.wikipedia.org/**', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
      }),
    )

    const trouble = []
    for (const [what, scope, reach] of STATES) {
      await reach(page)
      for (const finding of await page.evaluate(SWEEP(scope))) {
        trouble.push(`${what}: ${finding}`)
      }
    }

    expect(trouble, `${width}px is wider than these are behaving`).toEqual([])
  })
}
