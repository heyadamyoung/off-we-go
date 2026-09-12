/* The page a shared photograph lands on.
 *
 * Small and deliberately dull: a picture on the app's own dark, its caption
 * under it, and a way back to Off We Go. Nothing about the trip, nobody's
 * name, no other photographs — a link handed to a stranger is one picture,
 * not a doorway into a family's itinerary.
 *
 * Its real job is the meta tags. A link pasted into a message is a preview
 * card long before anybody taps it, and a card with no image is a link nobody
 * taps. That is the whole reason this is server-rendered HTML rather than a
 * route in the app: a crawler fetching a link does not run JavaScript.
 */

/* Everything below is somebody's caption on a public page, so it is escaped
   on the way in rather than trusted to be well behaved. The quote forms
   matter as much as the angle brackets: these values sit inside attributes. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** A caption fit for a preview card: one line, and not an essay. */
export function cardTitle(caption, fallback = 'A photograph from Off We Go') {
  const line = String(caption ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!line) return fallback
  return line.length > 120 ? `${line.slice(0, 117)}…` : line
}

export function sharePage({ caption, mediaUrl, pageUrl, video = false, appUrl = '/' }) {
  const title = cardTitle(caption)
  const safe = {
    title: escapeHtml(title),
    media: escapeHtml(mediaUrl),
    page: escapeHtml(pageUrl),
    app: escapeHtml(appUrl),
    caption: escapeHtml(String(caption ?? '').trim()),
  }
  /* A film previews as its poster: a card cannot play, and og:video is
     honoured by so few readers that the image is what actually shows. */
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${safe.title}</title>
<meta name="description" content="Shared from Off We Go">
<meta property="og:type" content="${video ? 'video.other' : 'article'}">
<meta property="og:title" content="${safe.title}">
<meta property="og:description" content="Shared from Off We Go">
<meta property="og:image" content="${safe.media}">
<meta property="og:url" content="${safe.page}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safe.title}">
<meta name="twitter:image" content="${safe.media}">
<meta name="robots" content="noindex, nofollow">
<style>
  :root { color-scheme: dark }
  body {
    margin: 0; min-height: 100svh; background: #0B0D11; color: #f2f4f8;
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 24px calc(24px + env(safe-area-inset-right, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)) calc(24px + env(safe-area-inset-left, 0px));
    gap: 16px; box-sizing: border-box;
  }
  .shot { max-width: min(100%, 1100px); max-height: 78svh; border-radius: 12px; box-shadow: 0 30px 80px rgb(0 0 0 / .6) }
  figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 14px; max-width: 100% }
  figcaption { text-align: center; max-width: 60ch; color: #c9cfda }
  a { color: #f5b84a; text-decoration: none; font-weight: 600 }
</style>
</head>
<body>
<figure>
  ${
    video
      ? `<video class="shot" src="${safe.media}" controls playsinline preload="metadata"></video>`
      : `<img class="shot" src="${safe.media}" alt="${safe.caption}">`
  }
  ${safe.caption ? `<figcaption>${safe.caption}</figcaption>` : ''}
</figure>
<a href="${safe.app}">Off We Go</a>
</body>
</html>
`
}

/**
 * What a link that has been taken back says.
 *
 * Deliberately not a 403 with an explanation. Somebody is holding a link that
 * used to work, and whether it was revoked, or the photograph deleted, or the
 * token was never real is none of their business — and saying which is how a
 * guessed token tells you it was close.
 */
export function shareGone() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This link is no longer available</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root { color-scheme: dark }
  body {
    margin: 0; min-height: 100svh; background: #0B0D11; color: #c9cfda;
    font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: grid; place-items: center; text-align: center; padding: 24px;
  }
  a { color: #f5b84a; text-decoration: none; font-weight: 600 }
</style>
</head>
<body>
<div>
  <p>This link is no longer available.</p>
  <p><a href="/">Off We Go</a></p>
</div>
</body>
</html>
`
}
