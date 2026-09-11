import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { leaveNoTrace } from './leave-no-trace.js'

/* Photographs on the map, including the ones that know nothing.

   A picture sent over WhatsApp, scanned, or taken with location off has no
   coordinates, and unless somebody has filed it at a stop it has no place
   either. The map used to drop those — silently, for ever — so on a trip
   where most pictures arrive that way the map showed stops and nothing else,
   and "photos on the map" looked like a feature that did not exist.

   This is the whole path in one: a real upload with no location of its own,
   to a real server, read back by the real client, and drawn where the trip
   was on the day it was taken. Sample mode cannot ask any of it — nothing
   leaves the tab there, so nothing ever comes back with a day on it. */

const stack = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../dist/live-stack.json'), 'utf8'),
)

/* This spec plants photographs in a trip every other spec also reads. */
leaveNoTrace(test, stack)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([token, email]) => {
      window.localStorage.setItem(
        'wayfare-session',
        JSON.stringify({ accessToken: token, user: { email } }),
      )
      window.__offwegoStill = true
    },
    [stack.accessToken, 'owner@example.com'],
  )
})

/* Two real photographs carrying a date and nothing else — no EXIF position,
   which is what a phone with location off, or anything sent over a messaging
   app, actually produces. */
const chooseTwoWithNoPlace = (page, day) =>
  page.locator('.dlg input[type="file"]').evaluate(async (input, when) => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 600
    const context = canvas.getContext('2d')
    const transfer = new DataTransfer()
    for (let index = 0; index < 2; index++) {
      context.fillStyle = index ? '#2f6f4f' : '#c87842'
      context.fillRect(0, 0, 800, 600)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      const file = new File([blob], `nowhere-${index}.jpg`, {
        type: 'image/jpeg',
        lastModified: 1_700_000_000_000 + index,
      })
      // A date and nothing else. No lng, no lat, no stop.
      Object.defineProperty(file, 'offwegoMetadata', { value: { takenAt: when } })
      transfer.items.add(file)
    }
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, day)

test('a photograph with no location of its own is still on the map', async ({ page }) => {
  /* No permission granted and none asked for, so the app has no phone
     position to lend them either — which is the case that used to end with
     nothing on the map at all. */
  const when = `${stack.trip.startsOn || '2026-09-05'}T11:00:00.000Z`

  await page.goto(`/trips/${stack.trip.slug}`)
  await page.getByRole('button', { name: 'Add photos' }).first().click()
  await chooseTwoWithNoPlace(page, when)
  await expect(page.locator('.dlg .previews > span')).toHaveCount(2, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Add 2', exact: true }).click()

  // Up, and gone from the bar.
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 60_000 })

  /* And on the map, as a stack that says it was placed by its day rather than
     by where it was taken. */
  const guessed = page.locator('.mstack.guess')
  await expect(guessed).toHaveCount(1, { timeout: 30_000 })
  await expect(guessed).toHaveAttribute(
    'title',
    /2 photos from .* no location of their own, shown where the trip was that day/,
  )

  /* Tapping it opens them — which is the point of drawing it at all: it is
     the thing you reach for to file them somewhere exact. */
  await guessed.click()
  await expect(page.locator('.viewer, .vbody').first()).toBeVisible({ timeout: 15_000 })
})
