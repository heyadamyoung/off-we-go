import { test, expect } from './fixture.js'
import { atDemoTime } from './demo-clock'

/* The swipe a thumb actually makes.
 *
 * Reported from the road: "you swipe a bunch and they work fine, then you use
 * the same gesture and the photo only partially swipes and then snaps back."
 *
 * A thumb does not travel in a straight line. It pivots from the base of the
 * hand, so a swipe across a phone arcs downwards — gently at first and most at
 * the end, which is exactly when the decision gets made. Both halves of the
 * reader asked "more across than down?" of the total displacement every time
 * they were asked, so a gesture could be horizontal for its whole visible life
 * and vertical at the one instant that counted.
 *
 * Both surfaces read the same rule, so both are held to it here: the picture
 * that follows the finger has to be the picture that turns the page.
 */

const MAP_READY = 9000
const PHONE = { width: 390, height: 844 }

test.beforeEach(async ({ page }) => {
  await page.route('https://en.wikipedia.org/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
    }),
  )
})

async function openViewer(page) {
  await page.setViewportSize(PHONE)
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: MAP_READY })
  await page.evaluate(() => window.__offwegoMap?.stop())
  await page.getByRole('button', { name: 'Photos', exact: true }).click()
  await page.locator('.pgrid-photo').first().click()
  await expect(page.locator('.viewer')).toBeVisible({ timeout: 8000 })
}

/* How far the picture nearest the middle of a stage sits from that middle.
 *
 * Asked of whatever is on the stage rather than of any particular class, so it
 * is a question about the photograph and not about the markup. The one nearest
 * the middle is the one being looked at: at rest it is centred, and mid-drag it
 * is still it, further away, with its neighbours a stage width further out. */
const offCentre = (page, which, box) =>
  page.evaluate(
    ({ selector, left, width }) => {
      const mid = left + width / 2
      /* null, not 0, and an explicit test for it. Zero is the answer this
         function exists to see — a picture sitting exactly in the middle —
         and `!nearest` reads that as "nothing found yet", so the next
         photograph along, a full stage width out, replaced it. A settle that
         landed perfectly then measured 390 instead of 0 and the test failed
         for the app behaving exactly as asked. */
      let nearest = null
      for (const image of document.querySelectorAll(`${selector} img`)) {
        const at = image.getBoundingClientRect()
        if (!at.width) continue
        const off = at.x + at.width / 2 - mid
        if (nearest === null || Math.abs(off) < Math.abs(nearest)) nearest = off
      }
      return Math.abs(nearest ?? 0)
    },
    { selector: which, left: box.x, width: box.width },
  )

/** The viewer's counter — the same one behind the full-screen picture. */
const counter = page => page.locator('.vcap .ct').innerText()

/* One thumb's worth of swipe on whichever stage, and what it did.
 *
 * Leftwards at a steady rate and downwards as the SQUARE of how far through it
 * is, which is the shape a hinged joint draws: barely falling at the start and
 * falling away at the end. It ends up further down than across — that is the
 * case being tested, and it is an ordinary one-handed swipe, not a contrived
 * one.
 *
 * Paced, so this is a carry rather than a flick: 210 pixels across a 390 stage
 * is past the halfway mark the rule asks for, and it has to turn the page on
 * that distance alone with the finger's own speed adding nothing. */
async function arcSwipe(page, which) {
  const box = await page.locator(which).boundingBox()
  const x = box.x + box.width * 0.88
  const y = box.y + box.height * 0.35
  await page.mouse.move(x, y)
  await page.mouse.down()
  const followed = []
  for (let step = 1; step <= 8; step++) {
    const part = step / 8
    await page.mouse.move(x - 210 * part, y + 240 * part * part)
    await page.waitForTimeout(40)
    followed.push(await offCentre(page, which, box))
  }
  await page.mouse.up()
  return { box, followed }
}

async function arcTurnsThePage(page, which) {
  const before = await counter(page)
  const { box, followed } = await arcSwipe(page, which)

  expect(
    Math.max(...followed),
    'the picture never followed the finger, so this is not the gesture that was reported',
  ).toBeGreaterThan(box.width * 0.15)

  await expect
    .poll(() => counter(page), {
      message: 'the picture followed the finger and then snapped back without turning the page',
    })
    .not.toBe(before)
  // And it settled in the middle rather than parking where the finger left it.
  await expect.poll(() => offCentre(page, which, box)).toBeLessThan(2)
}

test('an arced thumb swipe turns the page in the gallery', async ({ page }) => {
  await openViewer(page)
  await arcTurnsThePage(page, '.vbody')
})

test('an arced thumb swipe turns the page full screen', async ({ page }) => {
  await openViewer(page)
  await page.locator('.vpane.on .vmaintap').click()
  await expect(page.locator('.vzstage')).toBeVisible({ timeout: 8000 })
  await arcTurnsThePage(page, '.vzstage')
})

test('a finger that set off downwards still never turns the page', async ({ page }) => {
  /* The rule the axis replaces, and the reason it existed — reading a comment
     thread must not take the gallery with it. Committing has to cut both ways
     or it is not a commitment: a gesture that set off downwards keeps the page
     where it is however far sideways it wanders afterwards. */
  await openViewer(page)
  const before = await counter(page)
  const box = await page.locator('.vbody').boundingBox()
  const x = box.x + box.width * 0.5
  const y = box.y + box.height * 0.3

  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step++) {
    const part = step / 8
    // Down first, then wandering a long way sideways: the mirror of the arc.
    await page.mouse.move(x - 260 * part * part, y + 120 * part)
    await page.waitForTimeout(40)
  }
  await page.mouse.up()

  await page.waitForTimeout(600)
  expect(await counter(page), 'a gesture that set off downwards turned the page').toBe(before)
})

test('a second finger touching down does not steal the swipe from the first', async ({ page }) => {
  /* The other half of the same report. A phone is held as well as swiped, and
     a second contact — the finger resting on the edge, a palm, a knuckle —
     used to overwrite where the gesture began. So when the swiping finger
     lifted, its travel was measured from wherever the second one had landed:
     a few pixels, and the picture springs home mid-swipe.

     Two pointers cannot be driven through a mouse, so they are dispatched by
     hand. Real ids, real coordinates, real order. */
  await openViewer(page)
  const before = await counter(page)

  const turned = await page.evaluate(async () => {
    const stage = document.querySelector('.vbody')
    if (!stage) return 'no stage'
    const at = stage.getBoundingClientRect()
    const y = at.y + at.height * 0.4
    const from = at.x + at.width * 0.9
    const send = (type, pointerId, x) =>
      stage.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: 'touch',
          isPrimary: pointerId === 1,
          clientX: x,
          clientY: y,
        }),
      )
    const frame = () => new Promise(done => requestAnimationFrame(() => done()))

    send('pointerdown', 1, from)
    for (let step = 1; step <= 6; step++) {
      send('pointermove', 1, from - (at.width * 0.75 * step) / 6)
      await frame()
    }
    // The hand catching up with the thumb, a third of the way down the glass.
    send('pointerdown', 2, at.x + at.width * 0.15)
    await frame()
    send('pointerup', 1, from - at.width * 0.75)
    return 'sent'
  })
  expect(turned).toBe('sent')

  await expect
    .poll(() => counter(page), {
      message: 'a second finger landing mid-swipe took the page turn with it',
    })
    .not.toBe(before)
})
