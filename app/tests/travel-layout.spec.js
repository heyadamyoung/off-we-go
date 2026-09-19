import { expect, test } from './fixture.js'
import { atDemoTime } from './demo-clock'

/* The Travel tab at the widths people hold it at.
 *
 * A card that laid out on the developer's phone wrapped "2 h 57" onto a line
 * of its own on a narrower one, dealt six phases as four and two, floated
 * one button alone on a row, and cut a folded leg's route to "YQR …". So the
 * layout is proved at a small phone, a large phone and a desktop, in both
 * faces: nothing in a ticket runs past its edge, a headline breaks only
 * between its phrases, the phases come in equal rows, no button is alone
 * on a row on a phone, and a folded leg says where it goes.
 */

const SIZES = [
  { name: 'a small phone', width: 360, height: 740 },
  { name: 'a large phone', width: 430, height: 932 },
  { name: 'a desktop', width: 1280, height: 800 },
]

async function openTravel(page, { width, height, travelDay }) {
  await page.setViewportSize({ width, height })
  await page.addInitScript(day => {
    window.__offwegoStill = true
    if (day) window.__offwegoTravelDay = true
  }, travelDay)
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Travel' })).toBeVisible()
}

/** Every element of a card that runs past the card's own edges. */
const spills = (page, selector) =>
  page.evaluate(sel => {
    const out = []
    for (const card of document.querySelectorAll(sel)) {
      const box = card.getBoundingClientRect()
      for (const el of card.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width && (r.right > box.right + 1 || r.left < box.left - 1)) {
          out.push(`${el.tagName} "${(el.textContent || '').trim().slice(0, 30)}"`)
        }
      }
    }
    return out
  }, selector)

/** How many items sit on each row, by their top edge (to within a few pixels). */
const rowsOf = (page, selector) =>
  page.evaluate(sel => {
    const tops = new Map()
    for (const el of document.querySelectorAll(sel)) {
      const top = Math.round(el.getBoundingClientRect().top / 6)
      tops.set(top, (tops.get(top) || 0) + 1)
    }
    return [...tops.values()]
  }, selector)

for (const size of SIZES) {
  test(`on ${size.name}, the day's ticket keeps its shape`, async ({ page }) => {
    await openTravel(page, { ...size, travelDay: true })
    const flight = page.locator('.ticket').filter({ hasText: 'KL 677' }).first()
    await expect(flight).toHaveAttribute('data-face', 'day')
    expect(await spills(page, '.ticket, .legfold')).toEqual([])
    /* The headline is one line, or breaks between phrases: no phrase is
       ever split, so its own words never run past their span. */
    const head = flight.locator('.tkhead')
    await expect(head).toContainText('On time · gate E19 · check-in closes in 2 h')
    for (const piece of await head.locator('span.whitespace-nowrap').all()) {
      const box = await piece.boundingBox()
      expect(box.width).toBeLessThan(size.width)
    }
    /* The columns: five known on this ticket, dealt three and two, each row's
       columns the same width to the pixel and centred — not three headings
       spread by the lengths of their words with one alone under them. */
    await expect(flight.locator('.tkcol')).toHaveCount(5)
    expect(await rowsOf(page, '.ticket[data-face="day"] .tkcol')).toEqual([3, 2])
    const widths = await flight
      .locator('.tkrow')
      .evaluateAll(rows =>
        rows.map(row =>
          [...row.children].map(cell => Math.round(cell.getBoundingClientRect().width)),
        ),
      )
    for (const row of widths) expect(new Set(row).size, `uneven columns: ${row}`).toBe(1)
    /* Six phases: two rows of three, not four and two. */
    await expect(flight.locator('.tkphase')).toHaveCount(6)
    expect(await rowsOf(page, '.ticket[data-face="day"] .tkphase')).toEqual([3, 3])
    await expect(flight.locator('.tkphases')).not.toContainText('—')
    /* The buttons: on a phone two to a row, filling it; at a desk, a row. */
    const buttons = flight.locator('.tkactions > button')
    await expect(buttons).toHaveCount(4)
    const rows = await rowsOf(page, '.ticket[data-face="day"] .tkactions > button')
    if (size.width < 640) expect(rows).toEqual([2, 2])
    else expect(rows.length).toBeLessThanOrEqual(2)
    /* And every label fits its button: "Show gate on the ma" was cut on a
       small phone when the label could not wrap inside its half of the row. */
    for (const one of await buttons.all()) {
      const fits = await one.evaluate(el => el.scrollWidth <= el.clientWidth + 1)
      expect(fits, `${await one.textContent()} runs out of its button`).toBe(true)
    }
    await expect(flight.getByRole('button', { name: 'Where we sit' })).toBeVisible()
    /* The cost and the board share one quiet line. */
    await expect(flight.locator('.tkcost')).toHaveText('1284 EUR')
    await expect(flight.locator('.tksource')).toHaveText('Schiphol · 2 min ago')
  })

  test(`on ${size.name}, the evening's tickets and folded legs keep their shape`, async ({
    page,
  }) => {
    await openTravel(page, { ...size, travelDay: false })
    /* The folded flight says what it is, when, and where it goes, in full. */
    const fold = page.locator('.legfold').filter({ hasText: 'KL 677' }).first()
    await expect(fold.locator('.legname')).toHaveText('KL 677')
    await expect(fold.locator('.legroute')).toHaveText('AMS → YYC')
    expect(await spills(page, '.ticket, .legfold')).toEqual([])
    await fold.getByRole('button', { name: /KL 677/ }).click()
    const flight = page.locator('.ticket').filter({ hasText: 'KL 677' }).first()
    await expect(flight).toHaveAttribute('data-face', 'eve')
    expect(await spills(page, '.ticket, .legfold')).toEqual([])
    /* Three buttons on a phone: two, then one across the whole row. */
    const buttons = flight.locator('.tkactions > button')
    await expect(buttons).toHaveCount(3)
    if (size.width < 640) {
      expect(await rowsOf(page, '.legfold .ticket .tkactions > button')).toEqual([2, 1])
      const last = await buttons.nth(2).boundingBox()
      const card = await flight.boundingBox()
      expect(last.width).toBeGreaterThan(card.width * 0.8)
    }
    await expect(flight.locator('.tkbags')).toContainText('Checked 1 × 23 kg · Carry-on 1 × 12 kg')
  })
}
