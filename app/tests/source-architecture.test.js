import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(appRoot, 'src')
const sourceExtensions = new Set(['.ts', '.tsx'])

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(entry => {
      const target = path.join(directory, entry.name)
      return entry.isDirectory() ? sourceFiles(target) : [target]
    }),
  )

  return nested.flat().filter(file => sourceExtensions.has(path.extname(file)))
}

test('source modules stay below the 400-line review boundary', async () => {
  const oversized = []

  for (const file of await sourceFiles(sourceRoot)) {
    const contents = await readFile(file, 'utf8')
    const lineCount = contents === '' ? 0 : contents.split(/\r?\n/).length
    if (lineCount > 400) {
      oversized.push(`${path.relative(appRoot, file)} (${lineCount} lines)`)
    }
  }

  assert.deepEqual(oversized, [], `Split oversized source files:\n${oversized.join('\n')}`)
})

/* The router owns two naming conventions we do not get to choose: route files
   are named after the URL they serve (`trips.$slug.tsx`, `__root.tsx`), and the
   route tree is generated. Everything we write by hand is still kebab-case. */
const routerOwned = file => file.split(path.sep).includes('routes') || file.endsWith('.gen.ts')

test('TypeScript source filenames use kebab-case', async () => {
  const invalidNames = (await sourceFiles(sourceRoot))
    .map(file => path.relative(appRoot, file))
    .filter(file => !routerOwned(file))
    .filter(file => !/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.d)?\.(?:ts|tsx)$/.test(path.basename(file)))

  assert.deepEqual(
    invalidNames,
    [],
    `Rename TypeScript source files to kebab-case:\n${invalidNames.join('\n')}`,
  )
})

test('application source contains no JavaScript modules', async () => {
  const entries = await readdir(sourceRoot, { recursive: true })
  const JavaScriptFiles = entries.filter(file => /\.(?:js|jsx)$/.test(file))

  assert.deepEqual(JavaScriptFiles, [])
})

test('Off We Go Android sources are Kotlin rather than Java', async () => {
  const androidSourceRoot = path.join(appRoot, 'android', 'app', 'src')
  const entries = await readdir(androidSourceRoot, { recursive: true })
  const javaFiles = entries.filter(file => file.endsWith('.java'))

  assert.deepEqual(javaFiles, [], `Convert Android sources to Kotlin:\n${javaFiles.join('\n')}`)
})

test('the Android location service cannot be started or bound by other apps', async () => {
  const manifest = await readFile(
    path.join(appRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8',
  )

  assert.match(
    manifest,
    /<service\s+[^>]*android:name="com\.equimaps\.capacitor_background_geolocation\.BackgroundGeolocationService"[^>]*android:exported="false"[^>]*>/s,
  )
})

test('feature internals are imported only from their own slice', async () => {
  const violations = []
  const featureRoot = path.join(sourceRoot, 'features')

  for (const file of await sourceFiles(sourceRoot)) {
    const relativeSource = path.relative(featureRoot, file)
    const sourceSlice = relativeSource.startsWith('..') ? null : relativeSource.split(path.sep)[0]
    const contents = await readFile(file, 'utf8')
    const imports = contents.matchAll(/from\s+['"]([^'"]+)['"]/g)

    for (const [, specifier] of imports) {
      if (!specifier.startsWith('.')) continue
      const resolved = path.resolve(path.dirname(file), specifier)
      const relativeTarget = path.relative(featureRoot, resolved)
      if (relativeTarget.startsWith('..')) continue
      const [targetSlice, ...targetPath] = relativeTarget.split(path.sep)
      if (sourceSlice && targetSlice === sourceSlice) continue
      if (targetPath.length === 0 || targetPath.join('/') === 'index') continue
      violations.push(`${path.relative(appRoot, file)} -> ${specifier}`)
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Import feature internals only from within that feature:\n${violations.join('\n')}`,
  )
})

test('the all-days sentinel is defined exactly once', async () => {
  /* It was defined twice, as 'all' and as 'all-days'. Everything that filters
     compared against one and everything that chose a day set the other, so the
     itinerary strip filtered every row out and said "Nothing planned for this
     day yet" on a trip full of stops — and a stop added while viewing every
     day was saved with the sentinel itself as its day. A sentinel is only a
     sentinel if there is one of it. */
  const defined = []
  for (const file of await sourceFiles(sourceRoot)) {
    if (/export const ALL_DAYS\b/.test(await readFile(file, 'utf8'))) {
      defined.push(path.relative(sourceRoot, file))
    }
  }
  assert.deepEqual(defined, ['trip-search-core.ts'])
})

test('anything pinned to the edge of the screen accounts for the bezel', async () => {
  /* An island, a notch, a home bar. A dialog centred in the whole viewport is
     a dialog whose title sits under the island and whose buttons sit under the
     home bar, and no test browser can see it because env() is zero everywhere
     but a phone. So it is checked here, where the rule can be written down:
     anything that pins itself to all four edges of the screen has to say what
     it does about the bezel. */
  const shells = []
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, 'utf8')
    const pinned =
      /className="[^"]*\bfixed\b[^"]*\binset-0\b/.test(source) ||
      /position:\s*fixed;\s*inset:\s*0/.test(source)
    /* Either it handles the bezel, or it says in as many words why it does not
       have to. Silence is the only answer that is not allowed: a scrim that
       catches clicks and holds nothing is fine, and so is one anchored to
       something that already carries the inset — but somebody has to have
       thought about it. */
    const excused = source.includes('safe-area-inset') || source.includes('no-safe-area:')
    if (pinned && !excused) shells.push(path.relative(sourceRoot, file))
  }
  assert.deepEqual(
    shells,
    [],
    `These pin themselves to the screen and say nothing about the bezel.
Handle it, or write "no-safe-area: <why not>" in the file:\n${shells.join('\n')}`,
  )
})

test('a bulk move is batched below the size the server will accept', async () => {
  /* Two numbers in two languages in two directories, and nothing between them
     but the hope that whoever changes one remembers the other. Raise the
     client's batch above the server's ceiling and every "select all" on a
     long trip fails with a 400 that reads like the feature is broken — and no
     test would catch it, because a sample trip is never big enough.

     So the relationship is asserted rather than remembered. */
  const client = await readFile(
    path.join(sourceRoot, 'features/photos/model/use-trip-photos.ts'),
    'utf8',
  )
  const server = await readFile(path.join(appRoot, 'server/src/app.js'), 'utf8')

  const batch = Number(/const MOVE_BATCH = (\d+)/.exec(client)?.[1])
  const ceiling = Number(/const MOVE_AT_ONCE = (\d+)/.exec(server)?.[1])

  assert.ok(Number.isFinite(batch), 'the client no longer names its batch size')
  assert.ok(Number.isFinite(ceiling), 'the server no longer names its ceiling')
  assert.ok(
    batch <= ceiling,
    `the client sends ${batch} photos at a time and the server accepts ${ceiling}`,
  )
})
