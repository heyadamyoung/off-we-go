import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_PAGE_SCALE, pageScale, paperKind } from '../src/paper-kind-core.ts'

/* What a document gets drawn as, and how big.
 *
 * The viewer used to ask `mime.includes('pdf')` and, when that was false and
 * the mime was not an image, give up with "this one is a file — it opens in
 * its own viewer". Two things wrong with that. A ticket is very often a PDF
 * and handing it to another tab is the one behaviour this screen exists to
 * replace. And the test itself is fragile: plenty of real attachments arrive
 * as application/octet-stream with the answer sitting in the filename.
 */

test('a picture is a picture, whatever kind', () => {
  assert.equal(paperKind('image/png', 'pass.png'), 'image')
  assert.equal(paperKind('image/jpeg', 'scan.jpg'), 'image')
  assert.equal(paperKind('image/svg+xml', 'boarding-pass.svg'), 'image')
})

test('a PDF is a PDF by its type', () => {
  assert.equal(paperKind('application/pdf', 'ticket.pdf'), 'pdf')
  assert.equal(paperKind('application/x-pdf', 'ticket'), 'pdf')
})

test('a PDF that arrives badly labelled is still a PDF', () => {
  /* Mail attachments and a good many booking sites send octet-stream, or
     nothing at all. The name is the only thing left and it is usually right —
     and being wrong here costs a traveller the document. */
  assert.equal(paperKind('application/octet-stream', 'Train ticket.pdf'), 'pdf')
  assert.equal(paperKind('', 'boarding pass.PDF'), 'pdf')
  assert.equal(paperKind(null, 'itinerary.pdf'), 'pdf')
})

test('anything else is handed over, honestly', () => {
  assert.equal(paperKind('application/zip', 'tickets.zip'), 'file')
  assert.equal(paperKind('', ''), 'file')
  assert.equal(paperKind(), 'file')
})

test('a name that merely mentions pdf is not a pdf', () => {
  assert.equal(paperKind('image/png', 'my pdf scan.png'), 'image')
  assert.equal(paperKind('', 'pdf-notes.txt'), 'file')
})

/* A page is rasterised once, at the size it will actually be seen. */
const A4 = { width: 595, height: 842 }

test('a page is drawn to fill the sheet at the screen’s own density', () => {
  /* Anything less is a blurry barcode, which is the one thing this screen
     may not produce. */
  assert.equal(Math.round(pageScale(A4, 390, 3) * 1000), 1966)
  assert.equal(Math.round(pageScale(A4, 900, 1) * 1000), 1513)
})

test('a page is never drawn so large it cannot be allocated', () => {
  /* A 3x phone against a poster-sized page asks for a canvas no browser will
     give, and the failure is a blank screen rather than an error. */
  const poster = { width: 2384, height: 3370 }
  const scale = pageScale(poster, 390, 3)
  assert.ok(poster.width * scale * (poster.height * scale) <= 4_000_000)
  assert.ok(scale > 0)
})

test('the scale has a ceiling, so a tiny page does not become a mural', () => {
  const stamp = { width: 40, height: 60 }
  assert.equal(pageScale(stamp, 390, 3), MAX_PAGE_SCALE)
})

test('a page that will not say how big it is still draws', () => {
  assert.equal(pageScale({ width: 0, height: 0 }, 390, 3), 1)
  assert.equal(pageScale({ width: Number.NaN, height: 100 }, 390, 3), 1)
})
