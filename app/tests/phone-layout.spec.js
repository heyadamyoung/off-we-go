import { test, expect } from '@playwright/test'

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
  ['the dashboard', 'main', async page => { await page.goto('/'); await page.waitForTimeout(2500) }],
  ['your profile', 'main', async page => { await page.goto('/profile'); await page.waitForTimeout(1200) }],
  ['a new trip', 'main', async page => { await page.goto('/new'); await page.waitForTimeout(1000) }],
  ['past trips', 'main', async page => { await page.goto('/past'); await page.waitForTimeout(1000) }],
  ['invitations', 'main', async page => { await page.goto('/invitations'); await page.waitForTimeout(1000) }],
  ['the trip chrome', 'header', async page => {
    await page.goto('/trips/sample')
    await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(1500)
  }],
  ['the day bar', '.fdays', async page => { await page.waitForTimeout(200) }],
  ['the timeline', 'aside', async page => {
    await page.locator('button[title="timeline"]').click()
    await expect(page.locator('aside')).toBeVisible()
  }],
  ['the photos panel', 'aside', async page => {
    await page.locator('button[title="photos"]').click(); await page.waitForTimeout(600)
  }],
  ['the people panel', 'aside', async page => {
    await page.locator('button[title="people"]').click(); await page.waitForTimeout(600)
  }],
  ['a stop', '.detailcard', async page => {
    await page.locator('button[title="map"]').click(); await page.waitForTimeout(400)
    await page.locator('.fcard').first().click()
    await expect(page.locator('.detailcard')).toBeVisible()
  }],
  ['the stop editor', '.editor', async page => {
    await page.locator('.detailcard').getByTitle('Edit this stop').click()
    await expect(page.locator('.editor')).toBeVisible()
  }],
  ['trip settings', '.dlg', async page => {
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Trip settings' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }],
  ['the people tab', '.dlg', async page => {
    await page.locator('.dlg').getByRole('button', { name: 'People', exact: true }).click()
    await page.waitForTimeout(500)
  }],
  ['the location tab', '.dlg', async page => {
    await page.locator('.dlg').getByRole('button', { name: 'Location', exact: true }).click()
    await page.waitForTimeout(500)
  }],
  ['adding photos', '.dlg', async page => {
    await page.locator('.dlgfoot').getByRole('button', { name: 'Close', exact: true }).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Add photos' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }],
]

for (const [phone, width, height] of PHONES) {
  test(`nothing sticks out or hides from a tap on ${phone}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.route('https://en.wikipedia.org/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
    }))

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
