/* The brand mark is the words — "Off we go." in the app's own display face,
   white on nothing, with the amber full stop — drawn by a real browser with
   the real web font, so the icon on a home screen is the same mark as the
   one in the app's top-left corner. Stacked three lines deep because an icon
   is square and one line of ten characters across a square is a smudge.

   Writes public/brand/wordmark.png, the 2048px master every launcher size is
   cut from (see generate-brand-icons.mjs). Run when the mark changes:

     node scripts/render-wordmark.mjs && pnpm brand:icons

   Chromium comes from Playwright's own install, or from
   PLAYWRIGHT_CHROMIUM_PATH on a machine that has one already. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SIDE = 2048
/* The app's own tokens: the ink of a dark screen, and the accent. */
const INK = '#E6E9EE'
const ACCENT = '#F0A63C'

export const WORDMARK_LINES = ['Off', 'we', 'go.']

export function wordmarkPage(fontDataUrl) {
  const [first, second, third] = WORDMARK_LINES
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: 'Bricolage Grotesque'; font-weight: 500 800;
      src: url('${fontDataUrl}') format('woff2'); }
    html, body { margin: 0; background: transparent; }
    body { width: ${SIDE}px; height: ${SIDE}px; display: grid; place-items: center; }
    .mark { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800;
      font-size: ${Math.round(SIDE * 0.3)}px; line-height: .86; letter-spacing: -.04em;
      color: ${INK}; text-align: left; white-space: pre; }
    .dot { color: ${ACCENT}; }
  </style></head><body><div class="mark">${first}\n${second}\n${third.slice(0, -1)}<span class="dot">.</span></div></body></html>`
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const font = await readFile(
    path.join(appRoot, 'public', 'fonts', 'bricolage-grotesque-latin.woff2'),
  )
  const fontDataUrl = `data:font/woff2;base64,${font.toString('base64')}`
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  })
  try {
    const page = await browser.newPage({
      viewport: { width: SIDE, height: SIDE },
      deviceScaleFactor: 1,
    })
    await page.setContent(wordmarkPage(fontDataUrl))
    await page.evaluate(() => document.fonts.ready)
    const loaded = await page.evaluate(() =>
      document.fonts.check("800 100px 'Bricolage Grotesque'"),
    )
    if (!loaded)
      throw new Error('The display face did not load; the mark would be drawn in a fallback font')
    const png = await page.screenshot({ omitBackground: true, type: 'png' })
    const out = path.join(appRoot, 'public', 'brand', 'wordmark.png')
    await mkdir(path.dirname(out), { recursive: true })
    await writeFile(out, png)
    console.log(`wrote ${path.relative(appRoot, out)} (${Math.round(png.length / 1024)}kb)`)
  } finally {
    await browser.close()
  }
}
