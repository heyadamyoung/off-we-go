import assert from 'node:assert/strict'
import test from 'node:test'
import {
  downloadName,
  downloadOutcome,
  downloadUrl,
  downloadWay,
  extensionFor,
  oursToServe,
} from '../src/download-core.ts'

test('the phone app writes the file rather than clicking a link at it', () => {
  /* The whole reason this module exists. A WKWebView ignores the download
     attribute — no error, no file — so reaching the anchor rung inside the
     app is a button that does nothing while looking like it worked. */
  assert.equal(downloadWay({ native: true, anchor: true }), 'device')
})

test('a browser uses a link with a download on it', () => {
  assert.equal(downloadWay({ native: false, anchor: true }), 'anchor')
})

test('and somewhere with neither says so rather than pretending', () => {
  assert.equal(downloadWay({}), null)
  assert.equal(downloadOutcome(null), 'Saving is not available in this browser')
})

test('saying where it went, because a phone hides it otherwise', () => {
  /* "Saved" on its own is a file somebody cannot find and will conclude was
     never written. */
  assert.equal(downloadOutcome('device', 'ios'), 'Saved to Files, under Off We Go')
  assert.equal(downloadOutcome('device', 'android'), 'Saved to your Documents folder')
  assert.equal(downloadOutcome('anchor'), 'Saved')
})

test('the extension comes from what is in the file, not what we assume', () => {
  /* A QuickTime film named .mp4 is a file some desktops refuse to open. */
  assert.equal(extensionFor('video/quicktime', true), 'mov')
  assert.equal(extensionFor('image/png'), 'png')
  assert.equal(extensionFor('image/jpeg'), 'jpg')
})

test('a content type with parameters on it is still a content type', () => {
  assert.equal(extensionFor('image/jpeg; charset=binary'), 'jpg')
  assert.equal(extensionFor('VIDEO/MP4', true), 'mp4')
})

test('junk falls back on the kind rather than on nothing', () => {
  assert.equal(extensionFor('', true), 'mp4')
  assert.equal(extensionFor(null), 'jpg')
  assert.equal(extensionFor('application/octet-stream', false), 'jpg')
})

test('the name is the caption, the day and enough of the id to be unique', () => {
  assert.equal(
    downloadName({
      caption: 'Sunset over the canal',
      id: 'b4f1c2d3-0000-4000-8000-00000012ab34',
      takenAt: '2026-09-12T18:22:04.000Z',
      mime: 'image/jpeg',
    }),
    'sunset-over-the-canal-2026-09-12-12ab34.jpg',
  )
})

test('two untitled photographs from one afternoon are two files', () => {
  /* The phone writes into a real directory and writeFile overwrites without
     asking, so a shared name is somebody saving two pictures and finding one. */
  const day = '2026-09-12T09:00:00.000Z'
  const first = downloadName({ id: 'aaaaaaaa-1111-4000-8000-0000000000a1', takenAt: day })
  const second = downloadName({ id: 'bbbbbbbb-2222-4000-8000-0000000000b2', takenAt: day })
  assert.notEqual(first, second)
  assert.equal(first, 'off-we-go-2026-09-12-0000a1.jpg')
})

test('no caption and no date still makes a filename', () => {
  assert.equal(downloadName({}), 'off-we-go.jpg')
  assert.equal(downloadName({ video: true }), 'off-we-go.mp4')
})

test('a date that makes no sense is left out rather than invented', () => {
  assert.equal(downloadName({ caption: 'x', takenAt: 'one tuesday' }), 'x.jpg')
})

test('punctuation, emoji and length all come out of the caption', () => {
  assert.equal(
    downloadName({ caption: '  Gelato!! 🍦 in Roma — day 3  ' }),
    'gelato-in-roma-day-3.jpg',
  )
  const long = downloadName({ caption: 'a'.repeat(120) })
  assert.ok(long.length <= 45, long)
  /* And never a trailing dash before the dot, which is what slicing a slug
     at forty characters does when the fortieth is a space. */
  assert.ok(!/-\./.test(downloadName({ caption: 'a'.repeat(39) + ' bcd' })))
})

test('asking for a file adds to the query rather than replacing it', () => {
  /* The signature and the expiry are already in there and the link is dead
     without them. */
  assert.equal(
    downloadUrl('https://x/api/media/t/p.jpg?expires=1&signature=abc', 'a b.jpg'),
    'https://x/api/media/t/p.jpg?expires=1&signature=abc&download=a%20b.jpg',
  )
  assert.equal(downloadUrl('https://x/p.jpg', 'a.jpg'), 'https://x/p.jpg?download=a.jpg')
})

test('only our own links can be asked to come back as attachments', () => {
  /* The sample trip draws from other people's servers, which will not set a
     disposition header for us however nicely we ask. */
  assert.equal(oursToServe('https://offwego.to/api/media/t/p.jpg?expires=1'), true)
  assert.equal(oursToServe('https://loremflickr.com/1200/800/canal?lock=3'), false)
  assert.equal(oursToServe(null), false)
})
