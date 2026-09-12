import assert from 'node:assert/strict'
import test from 'node:test'
import { cardTitle, escapeHtml, sharePage } from '../src/share-page.js'

const page = (fields = {}) =>
  sharePage({
    caption: 'Sunset over the canal',
    mediaUrl: 'https://offwego.to/s/abc/media',
    pageUrl: 'https://offwego.to/s/abc',
    appUrl: 'https://offwego.to/',
    ...fields,
  })

test('a caption from a stranger cannot write HTML on a public page', () => {
  /* This is somebody's caption, rendered on a page anybody can open. The
     quote forms matter as much as the brackets: these land inside attributes,
     where a bare quote is enough to break out of one. */
  const nasty = '"><script>alert(1)</script><img src=x onerror="alert(2)"'
  const html = page({ caption: nasty })

  assert.ok(!html.includes('<script>'), 'a caption opened a script tag')
  assert.ok(!html.includes('onerror="alert(2)"'), 'a caption wrote an attribute')
  assert.ok(html.includes('&lt;script&gt;'), 'the caption should survive, escaped')
})

test('a media URL cannot break out of the attribute it sits in', () => {
  const html = page({ mediaUrl: 'https://x/a.jpg" onload="steal()' })
  assert.ok(!html.includes('onload="steal()'), 'a URL wrote an attribute')
})

test('escaping covers every character that can leave an attribute', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
  // Ampersand first, or every other escape gets escaped again.
  assert.equal(escapeHtml('<'), '&lt;')
})

test('the card carries the picture, because a card without one is not tapped', () => {
  const html = page()
  assert.match(html, /<meta property="og:image" content="https:\/\/offwego\.to\/s\/abc\/media">/)
  assert.match(html, /<meta property="og:title" content="Sunset over the canal">/)
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/)
})

test('a shared link is not for search engines', () => {
  // Somebody sent this to one person. It is not published.
  assert.match(page(), /<meta name="robots" content="noindex, nofollow">/)
})

test('a film is a video with controls, and previews as its poster', () => {
  const html = page({ video: true })
  assert.match(html, /<video class="shot"[^>]*controls/)
  assert.ok(!html.includes('<img class="shot"'))
  // The card still names an image: a preview cannot play.
  assert.match(html, /<meta property="og:image"/)
})

test('a photograph with no caption still has a title worth previewing', () => {
  assert.equal(cardTitle(''), 'A photograph from Off We Go')
  assert.equal(cardTitle('   \n  '), 'A photograph from Off We Go')
  assert.ok(!page({ caption: '' }).includes('<figcaption>'))
})

test('a caption the length of a paragraph is cut to a card', () => {
  const long = cardTitle('x'.repeat(400))
  assert.equal(long.length, 118)
  assert.ok(long.endsWith('…'))
  // And a caption written across several lines is one line on a card.
  assert.equal(cardTitle('over\nthe   canal'), 'over the canal')
})
