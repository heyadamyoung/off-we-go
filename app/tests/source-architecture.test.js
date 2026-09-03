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
