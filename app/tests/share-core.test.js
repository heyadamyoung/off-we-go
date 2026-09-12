import assert from 'node:assert/strict'
import test from 'node:test'
import { shareFilename, shareNote, shareOutcome, shareWay } from '../src/share-core.ts'

test('the picture goes in the sheet when the browser will carry it', () => {
  /* This is the case that makes Instagram work: it posts images, not links,
     so a sheet with only a URL in it is a sheet Instagram cannot use. */
  assert.equal(shareWay({ sheet: true, files: true, clipboard: true }), 'files')
})

test('a sheet that will not carry files still carries the link', () => {
  assert.equal(shareWay({ sheet: true, files: false, clipboard: true }), 'link')
})

test('a browser with no sheet falls back to the clipboard', () => {
  assert.equal(shareWay({ sheet: false, clipboard: true }), 'clipboard')
})

test('and one with neither says so rather than pretending', () => {
  assert.equal(shareWay({}), null)
  assert.equal(shareOutcome(null), 'Sharing is not available in this browser')
})

test('the link always goes along, with the caption when there is one', () => {
  assert.equal(
    shareNote('Sunset over the canal', 'https://x/s/a'),
    'Sunset over the canal\nhttps://x/s/a',
  )
  assert.equal(shareNote('', 'https://x/s/a'), 'https://x/s/a')
  assert.equal(shareNote(null, 'https://x/s/a'), 'https://x/s/a')
  // A caption written over several lines is one line in a message.
  assert.equal(shareNote('over\n  the canal', 'https://x/s/a'), 'over the canal\nhttps://x/s/a')
})

test('what it says afterwards matches what actually happened', () => {
  assert.equal(shareOutcome('files'), 'Shared')
  assert.equal(shareOutcome('link'), 'Shared')
  assert.equal(shareOutcome('clipboard'), 'Link copied')
})

test('the filename is the caption, or something harmless', () => {
  assert.equal(shareFilename('Sunset over the canal'), 'sunset-over-the-canal.jpg')
  assert.equal(shareFilename('', true), 'off-we-go.mp4')
  assert.equal(shareFilename('  !!!  '), 'off-we-go.jpg')
  // Nothing that could be read as a path, whatever somebody captioned it.
  assert.equal(shareFilename('../../etc/passwd'), 'etc-passwd.jpg')
  assert.ok(!shareFilename('a'.repeat(200)).includes('/'))
})
