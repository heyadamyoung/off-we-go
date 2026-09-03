/* Pulls the two web faces into public/fonts and prints the @font-face rules
   for styles.css.

   They are served from our own origin because Google's stylesheet is
   cross-origin and render-blocking: a synchronous script waits for every
   stylesheet declared before it, so the app's own JavaScript — downloaded
   within 16ms — could not begin until that request returned around 154ms, and
   the first paint, the map style and the first tiles all inherited the wait.

   Run when a face needs updating: `node scripts/fetch-fonts.mjs` */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800' +
  '&family=Schibsted+Grotesk:wght@400..800&display=swap'

// Google serves woff2 only to browsers it recognises.
const AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts')
await mkdir(out, { recursive: true })

const response = await fetch(SOURCE, { headers: { 'user-agent': AGENT } })
if (!response.ok) throw new Error(`Google answered ${response.status} for the font stylesheet`)
const css = await response.text()

const field = (block, name) => new RegExp(`${name}:s*([^;]+);`).exec(block)?.[1].trim()
const rules = []

for (const block of css.match(/@font-face\s*\{[^}]+\}/g) || []) {
  const range = field(block, 'unicode-range') || ''
  /* Latin and latin-ext only. The app's own copy is English and the rest is
     bytes nobody here renders. */
  const subset = range.includes('U+0100-02BA')
    ? 'latin-ext'
    : range.includes('U+0000-00FF')
      ? 'latin'
      : null
  if (!subset) continue

  const family = /font-family:\s*'([^']+)'/.exec(block)?.[1]
  const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(block)?.[1]
  if (!family || !url) continue

  const name = `${family.toLowerCase().replaceAll(' ', '-')}-${subset}.woff2`
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
  await writeFile(join(out, name), bytes)
  console.log(`wrote ${name} (${Math.round(bytes.length / 1024)}kb)`)

  rules.push(
    `@font-face {\n  font-family: '${family}';\n  font-style: ${field(block, 'font-style') || 'normal'};` +
      `\n  font-weight: ${field(block, 'font-weight')};\n  font-display: swap;` +
      `\n  src: url('/fonts/${name}') format('woff2');\n  unicode-range: ${range};\n}`,
  )
}

console.log(`\n--- for src/styles.css ---\n${rules.join('\n')}`)
