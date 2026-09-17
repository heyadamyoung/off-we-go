import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/* Every colour this stylesheet reaches for has to exist.
 *
 * There are two names for every colour in this app and they are not the same
 * name. The raw custom properties are --c-bg, --c-raised-2, --c-line-2; the
 * Tailwind utilities are canvas, raised2, line2, mapped in the @theme block.
 * Write hand-rolled CSS in the Tailwind spelling — var(--c-canvas) — and you
 * have named a property nobody declares.
 *
 * CSS does not complain about that. An unresolvable var() makes the WHOLE
 * declaration invalid at computed-value time, so the property falls back to
 * its initial value and nothing anywhere says a word. `background:
 * var(--c-canvas)` is not a wrong colour, it is transparent — which is how a
 * full-screen document viewer shipped that you could read the map through,
 * with every one of its other rules working perfectly.
 *
 * So: nothing may reference a custom property that is not defined, unless it
 * passes a fallback, which is how you say "something else sets this".
 */

const SHEET = new URL('../src/styles.css', import.meta.url)

/* Comments are prose, not declarations — including the one above .ppview that
   quotes the mistake it is there to explain. */
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))

/** Every property referenced without a fallback that nothing declares. */
function danglingProperties(source) {
  const css = strip(source)
  const defined = new Set()
  for (const [, name] of css.matchAll(/(?:^|[;{]|\s)(--[\w-]+)\s*:/g)) defined.add(name)

  const missing = new Map()
  for (const match of css.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    const [, name, next] = match
    /* A fallback is a deliberate "somebody else sets this" — the keyboard
       inset is set from JavaScript and read as var(--keyboard, 0px). */
    if (next === ',' || defined.has(name)) continue
    const line = css.slice(0, match.index).split('\n').length
    missing.set(name, [...(missing.get(name) || []), line])
  }
  return [...missing].map(([name, lines]) => `${name} (line ${lines.join(', ')})`)
}

test('every custom property the stylesheet uses is one it defines', () => {
  assert.deepEqual(
    danglingProperties(readFileSync(SHEET, 'utf8')),
    [],
    'undefined custom property: the whole declaration is thrown away silently',
  )
})

/* The same names are written by hand in components too — a style={{}} or a
   Tailwind arbitrary value — and a property that does not exist is exactly as
   silent there. */
const SRC = fileURLToPath(new URL('../src/', import.meta.url))

function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sources(path)
    else if (/\.tsx?$/.test(entry.name)) yield path
  }
}

test('components reach for the same properties the stylesheet defines', () => {
  const css = strip(readFileSync(SHEET, 'utf8'))
  const defined = new Set([...css.matchAll(/(?:^|[;{]|\s)(--[\w-]+)\s*:/g)].map(one => one[1]))

  const dangling = []
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const [, name, next] of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g))
      if (next !== ',' && !defined.has(name)) dangling.push(`${name} in ${file}`)
  }
  assert.deepEqual(dangling, [])
})

test('the rule fires on the mistake it was written for', () => {
  /* The real one, reduced: the Tailwind name where a property belongs. */
  assert.deepEqual(
    danglingProperties(':root { --c-bg: #000 } .a { background: var(--c-canvas) }'),
    ['--c-canvas (line 1)'],
  )
  assert.deepEqual(
    danglingProperties(':root { --c-raised-2: #1 } .a { color: var(--c-raised2) }'),
    ['--c-raised2 (line 1)'],
  )
})

test('the rule stays quiet on what is fine', () => {
  const defined = ':root { --c-bg: #000 }\n.a { background: var(--c-bg) }'
  assert.deepEqual(danglingProperties(defined), [])
  // Set from JavaScript, read with a fallback — the way to declare that.
  assert.deepEqual(danglingProperties('.a { height: calc(100dvh - var(--keyboard, 0px)) }'), [])
  // A fallback that is itself a property still has to exist.
  assert.deepEqual(danglingProperties('.a { color: var(--nope, var(--gone)) }'), [
    '--gone (line 1)',
  ])
  // Naming the mistake in prose is not making it.
  assert.deepEqual(danglingProperties('/* never var(--c-canvas) */ .a { color: red }'), [])
})
