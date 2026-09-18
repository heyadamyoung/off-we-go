import { test, expect } from './fixture.js'
import { atDemoTime } from './demo-clock'

/* Choosing what to add.

   The sheet used to be a thing to read: a grid that looked like a selector but
   was an inspector, a map of one photograph out of however many, and three
   paragraphs about where its coordinates came from. These check the sheet that
   replaced it — see what you chose, take out what you did not mean, add more,
   send — and that it still says the one true thing the essays were for: where
   this batch is going to land. */

test.beforeEach(async ({ page }) => {
  // Freeze the demo's walking traveller: layout and offline assertions need a
  // world that holds still. Set before boot; the router strips query params.
  await page.addInitScript(() => {
    window.__offwegoStill = true
  })
  await page.route('https://en.wikipedia.org/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ query: { pages: {}, geosearch: [] } }),
    }),
  )
})

/* Two photographs: one that knows where it was taken and one that does not —
   which is the pair the whole placement story is about. */
const choose = (page, names = ['tagged.jpg', 'untagged.jpg']) =>
  page.locator('.dlg input[type="file"]').evaluate((input, wanted) => {
    const transfer = new DataTransfer()
    for (const name of wanted) {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, {
        type: 'image/jpeg',
        /* Fixed, because a camera roll hands back the same file with the same
           timestamp every time it is opened — and that sameness is exactly
           what stops a second pick from doubling the selection. Left to
           default, each File here is stamped with the moment it was made and
           no two are ever the same photograph. */
        lastModified: 1_700_000_000_000 + name.length,
      })
      Object.defineProperty(file, 'offwegoMetadata', {
        value: name.startsWith('tagged')
          ? { lng: 4.8852, lat: 52.36, takenAt: '2026-08-31T12:00:00.000Z' }
          : { takenAt: '2026-08-30T12:00:00.000Z' },
      })
      transfer.items.add(file)
    }
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, names)

const openSheet = async page => {
  await atDemoTime(page)
  await page.goto('/trips/sample')
  await expect(page.locator('.mapcanvas canvas')).toBeVisible({ timeout: 9000 })
  await page.getByRole('button', { name: 'Add photos' }).click()
  await expect(page.locator('.dlg')).toBeVisible()
}

test('the sheet says what will happen to the batch, not to one of it', async ({
  page,
  context,
}) => {
  /* With a phone position to hand, a photograph carrying no GPS of its own is
     still placed — near the phone — which is the whole point of the fallback.
     So both of these land, and the sentence says so about both. */
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ longitude: 4.8686, latitude: 52.3664 })
  await openSheet(page)
  await choose(page)

  await expect(page.getByRole('heading', { name: /Add 2 photos/ })).toBeVisible()
  /* One sentence about all of them, in place of a map of the first one. */
  const hint = page.locator('.dlg p.hint')
  await expect(hint).toContainText('All go on the map where they were taken')
  /* And nothing about an itinerary item. It used to promise "2 will be grouped
     at Rijksmuseum" — which the server then did, and the map drew both of them
     on the museum's pin instead of where they were taken. */
  await expect(hint).not.toContainText('grouped')
  await expect(page.locator('.dlg .previews').getByText('No place')).toHaveCount(0)
})

test('a photograph with no location of its own still borrows one', async ({ page }) => {
  /* Even with no permission granted, the sample trip has a position of its
     own to fall back on — which is the fallback working, and is why "No
     place" cannot be staged here at all: it needs a trip that has never
     reported a position, and a browser test cannot make the sample forget.

     So this checks the half a browser can answer — that a photograph carrying
     nothing is placed rather than dropped — and the unplaced sentence, and
     the pip that marks it, are held to account in tests/upload-summary.test.js
     where the counts can be stated outright. */
  await openSheet(page)
  await choose(page)

  await expect(page.locator('.dlg p.hint')).toContainText('go on the map')
  await expect(page.locator('.dlg .previews').getByText('No place')).toHaveCount(0)
})

test('a photograph chosen by mistake can be taken back out', async ({ page }) => {
  /* There was no way to do this at all: the only way back from a misfired
     camera roll was to close the sheet and start again. */
  await openSheet(page)
  await choose(page)
  const tiles = page.locator('.dlg .previews > span')
  await expect(tiles).toHaveCount(2)

  await page.getByRole('button', { name: /Take out untagged\.jpg/ }).click()
  await expect(tiles).toHaveCount(1)
  await expect(page.getByRole('heading', { name: /Add 1 photo/ })).toBeVisible()
  // With it gone, so is the thing that was true only of it.
  await expect(page.locator('.dlg .previews').getByText('No place')).toHaveCount(0)
})

test('choosing again adds to the selection instead of replacing it', async ({ page }) => {
  /* "Choose different photos" used to throw away everything already picked,
     which is not what anybody means by choosing one more. */
  await openSheet(page)
  await choose(page, ['one.jpg'])
  await expect(page.locator('.dlg .previews > span')).toHaveCount(1)

  await choose(page, ['two.jpg'])
  await expect(page.locator('.dlg .previews > span')).toHaveCount(2)

  // And the same file twice is still one file.
  await choose(page, ['two.jpg'])
  await expect(page.locator('.dlg .previews > span')).toHaveCount(2)
})

test('adding hands the batch over and gets out of the way', async ({ page }) => {
  await openSheet(page)
  await choose(page)
  await page.getByRole('button', { name: 'Add 2', exact: true }).click()
  // The sheet closes rather than sitting on the trip while they go up.
  await expect(page.locator('.dlg')).toHaveCount(0)
})

/* ---- thirty at once ------------------------------------------------------

   Reported as the app dying on a selection of thirty or more. Nothing was
   wrong with the sending: it was the looking. A browser decodes what it draws
   at the size the file is, not at the size of the tile, so thirty
   hundred-pixel tiles cost thirty full-size bitmaps — better than a gigabyte
   of them, all alive because they are all on screen — and then the upload bar
   drew the same thirty again.

   Real pictures rather than the four-byte stand-ins above: the whole question
   is what the browser decoded, and it will not decode those. */

const chooseReal = (page, count, edge = 1600) =>
  page.locator('.dlg input[type="file"]').evaluate(
    async (input, { count: many, edge: size }) => {
      const transfer = new DataTransfer()
      for (let index = 0; index < many; index += 1) {
        const canvas = Object.assign(document.createElement('canvas'), {
          width: size,
          height: Math.round(size * 0.75),
        })
        const context = canvas.getContext('2d')
        context.fillStyle = `hsl(${(index * 37) % 360} 70% 50%)`
        context.fillRect(0, 0, canvas.width, canvas.height)
        const blob = await new Promise(done => canvas.toBlob(done, 'image/jpeg', 0.8))
        transfer.items.add(
          new File([blob], `real-${index}.jpg`, {
            type: 'image/jpeg',
            lastModified: 1_700_000_000_000 + index,
          }),
        )
      }
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { count, edge },
  )

/** What each tile actually decoded, which is the thing that costs the memory. */
const decodedWidths = locator =>
  locator.evaluateAll(images => images.map(image => image.naturalWidth))

test('a chosen photograph is drawn from a tile-sized copy, not from the file', async ({ page }) => {
  await openSheet(page)
  await chooseReal(page, 6)
  const tiles = page.locator('.dlg .previews img')
  await expect(tiles).toHaveCount(6)

  // Every one decoded, and every one small: 1600px in, a tile's worth out.
  await expect.poll(() => decodedWidths(tiles)).toEqual([320, 320, 320, 320, 320, 320])
})

/* The bar's own tiles are the other half of the gigabyte — a row per upload,
   each decoding the whole file — and they draw the very same copy now: the
   queue is handed `item.thumb` rather than a fresh URL for the file. Not
   asserted in a browser here, and worth saying why: on the demo trip an
   upload finishes the instant it starts, so the bar is gone before a test can
   open it, and slowing the product down to be watched is not a test. The core
   is covered next door in photo-thumb, and the tile above is the same blob. */
