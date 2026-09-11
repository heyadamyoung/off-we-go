import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { Brandmark, Screen } from '../src/shared/ui/brand.tsx'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(appRoot, 'public', 'offwego-logo.svg')
const iconPath = path.join(appRoot, 'public', 'offwego-icon.svg')

test('uses genuine vector artwork for the new portal icon and full lockup', async () => {
  const logo = await readFile(sourcePath, 'utf8')
  assert.match(logo, /^<svg\b/)
  assert.match(logo, /viewBox=["']0 0 635 568["']/)
  assert.match(logo, /<title[^>]*>Off We Go logo<\/title>/)
  assert.doesNotMatch(logo, /<image\b/)
  assert.doesNotMatch(logo, /<text\b/)
  assert.ok(
    (logo.match(/<path\b/g) || []).length >= 13,
    'full lockup must remain outlined vector paths',
  )

  const icon = await readFile(iconPath, 'utf8')
  assert.match(icon, /^<svg\b/)
  assert.match(icon, /viewBox=["']0 0 820 1060["']/)
  assert.doesNotMatch(icon, /<image\b/)
  assert.doesNotMatch(icon, /<text\b/)
  assert.ok(
    (icon.match(/inkscape:groupmode=["']layer["']/g) || []).length >= 6,
    'icon must expose editable layers',
  )

  const { data } = await sharp(iconPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(data[3], 0, 'vector icon background must be transparent')
})

test('brand UI: the badge stays vector where used, and chrome carries type only', () => {
  const brandmark = renderToStaticMarkup(createElement(Brandmark, { size: 18 }))
  assert.match(brandmark, /<img[^>]+src="\/offwego-icon\.svg"/)
  assert.doesNotMatch(brandmark, /<svg\b/)

  /* Both marks are still under review, so the screens that used to lead with
     the badge lead with the wordmark: the words, and the amber full stop. */
  const screen = renderToStaticMarkup(createElement(Screen, null, 'Loading'))
  assert.match(screen, /Off we go/)
  assert.doesNotMatch(screen, /<img\b/)
})

function parseIco(buffer) {
  assert.deepEqual([...buffer.subarray(0, 4)], [0, 0, 1, 0])
  const count = buffer.readUInt16LE(4)

  return Array.from({ length: count }, (_, index) => {
    const entryOffset = 6 + index * 16
    const width = buffer[entryOffset] || 256
    const height = buffer[entryOffset + 1] || 256
    const byteLength = buffer.readUInt32LE(entryOffset + 8)
    const imageOffset = buffer.readUInt32LE(entryOffset + 12)
    return {
      width,
      height,
      bytes: buffer.subarray(imageOffset, imageOffset + byteLength),
    }
  })
}

async function rgbaAt(filename, x, y) {
  const { data, info } = await sharp(filename)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * 4
  return [...data.subarray(offset, offset + 4)]
}

async function renderedRgbaAt(filename, size, x, y) {
  const { data, info } = await sharp(filename)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * 4
  return [...data.subarray(offset, offset + 4)]
}

/* ---- masks -----------------------------------------------------------------

   Every launcher crops an icon, and a tall mark fitted to the square it is
   given loses its corners to that crop: on Android the arch came back sliced
   flat top and bottom, on iOS with the feet shaved off the frame. So the rule
   is not "the mark is the right size" — it is "the mask takes nothing away",
   and that is what these measure, by cropping the shipped file and counting
   what is left. */

const circleMask = (size, across) =>
  Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" ` +
      `r="${(size * across) / 2}" fill="#fff"/></svg>`,
  )

/* iOS is a superellipse in the flesh; a rounded rectangle of the same corner
   radius is the nearest thing SVG draws and is the tighter of the two, so an
   icon that clears this clears the real one. */
const squircleMask = size =>
  Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" ` +
      `rx="${size * 0.2237}" ry="${size * 0.2237}" fill="#fff"/></svg>`,
  )

/** How many pixels are the mark rather than the ground it stands on. */
async function markArea(input, ground) {
  const { data } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let inked = 0
  for (let at = 0; at < data.length; at += 4) {
    if (data[at + 3] <= 8) continue
    if (ground) {
      const off =
        Math.abs(data[at] - ground[0]) +
        Math.abs(data[at + 1] - ground[1]) +
        Math.abs(data[at + 2] - ground[2])
      if (off <= 24) continue
    }
    inked += 1
  }
  return inked
}

/** What the mark looks like before and after a launcher crops it. */
async function underMask(filename, mask, ground) {
  const whole = await markArea(filename, ground)
  const cropped = await sharp(filename)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
  return { whole, kept: await markArea(cropped, ground) }
}

const ICON_GROUND = [10, 12, 16]
const SPLASH_GROUND = [11, 13, 17]

/* The arch and the road share one gradient, and it was warmed to the interface
   accent (#F5B84A) so the mark and the chrome read as one family — the sunset
   inside the arch keeps its reds. What still has to hold is the shape of that
   gradient: a pale crown, a deeper road, and daylight between them. */
test('renders the approved warm gradient from the portal crown to the road', async () => {
  const crown = await renderedRgbaAt(iconPath, 512, 256, 24)
  const road = await renderedRgbaAt(iconPath, 512, 256, 488)

  assert.ok(crown[1] > 180, `expected a pale amber crown, got ${crown}`)
  assert.ok(road[1] > 100 && road[1] < 160, `expected a deeper amber road, got ${road}`)
  assert.ok(crown[1] - road[1] > 60, 'portal and road must not collapse back to one flat fill')
  // Amber, not the old red-orange: the blue channel is what separates the two.
  assert.ok(crown[2] > 80, `expected the crown in the accent's family, got ${crown}`)
})

test('renders the full lockup on its dark backdrop so the cream wordmark remains visible', async () => {
  const backdrop = await rgbaAt(sourcePath, 10, 550)
  const wordmark = await rgbaAt(sourcePath, 30, 477)

  assert.ok(
    backdrop[0] < 20 && backdrop[1] < 20 && backdrop[2] < 20 && backdrop[3] === 255,
    `expected opaque dark backdrop, got ${backdrop}`,
  )
  assert.ok(
    wordmark[0] > 240 && wordmark[1] > 225 && wordmark[2] > 210 && wordmark[3] === 255,
    `expected readable cream wordmark, got ${wordmark}`,
  )
})

test('generates the approved brand icon for every web and native launcher surface', async t => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'offwego-brand-icons-'))
  t.after(() => rm(outputRoot, { recursive: true, force: true }))

  const result = spawnSync(
    process.execPath,
    ['scripts/generate-brand-icons.mjs', '--source', iconPath, '--output-root', outputRoot],
    { cwd: appRoot, encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)

  const generatedSvg = await readFile(path.join(outputRoot, 'public', 'offwego-icon.svg'), 'utf8')
  assert.doesNotMatch(generatedSvg, /<image\b/, 'generated SVG must preserve vector paths')
  assert.doesNotMatch(generatedSvg, /<text\b/, 'generated SVG must not depend on an installed font')

  const webMarkPath = path.join(outputRoot, 'public', 'offwego-icon.png')
  const webMark = await sharp(webMarkPath).metadata()
  assert.deepEqual(
    { width: webMark.width, height: webMark.height, hasAlpha: webMark.hasAlpha },
    { width: 512, height: 512, hasAlpha: true },
  )
  assert.equal((await rgbaAt(webMarkPath, 0, 0))[3], 0, 'web mark background must be transparent')

  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    const metadata = await sharp(
      path.join(outputRoot, 'public', 'brand', `offwego-icon-${size}.png`),
    ).metadata()
    assert.deepEqual(
      { width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha },
      { width: size, height: size, hasAlpha: true },
      `transparent ${size}px export`,
    )
    assert.equal(
      (await rgbaAt(path.join(outputRoot, 'public', 'brand', `offwego-icon-${size}.png`), 0, 0))[3],
      0,
      `transparent ${size}px export corner`,
    )
  }

  for (const [filename, size] of [
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ]) {
    const metadata = await sharp(path.join(outputRoot, 'public', filename)).metadata()
    assert.deepEqual(
      { width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha },
      { width: size, height: size, hasAlpha: false },
      filename,
    )
  }

  const favicon = parseIco(await readFile(path.join(outputRoot, 'public', 'favicon.ico')))
  assert.deepEqual(
    favicon.map(({ width, height }) => [width, height]),
    [
      [16, 16],
      [32, 32],
      [48, 48],
      [256, 256],
    ],
  )
  for (const entry of favicon) {
    assert.deepEqual([...entry.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    const { data } = await sharp(entry.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    assert.equal(data[3], 0, `${entry.width}px favicon corner must be transparent`)
  }

  /* Three icons, because iOS 18 asks for three: the one everybody knows, the
     one it draws on a dark home screen, and the grayscale it tints. Without
     the last two the system falls back to the first, which on a tinted home
     screen is the only icon still shouting in colour. */
  const appIcon = path.join(
    outputRoot,
    'ios',
    'App',
    'App',
    'Assets.xcassets',
    'AppIcon.appiconset',
  )
  for (const [filename, hasAlpha] of [
    ['AppIcon-512@2x.png', false],
    ['AppIcon-Dark.png', true],
    ['AppIcon-Tinted.png', false],
  ]) {
    const icon = await sharp(path.join(appIcon, filename)).metadata()
    assert.deepEqual(
      { width: icon.width, height: icon.height, hasAlpha: icon.hasAlpha },
      { width: 1024, height: 1024, hasAlpha },
      filename,
    )
  }

  /* The dark one hands its ground back: iOS has its own, and an icon that
     brings a black square instead sits ON the home screen rather than in it. */
  assert.equal((await rgbaAt(path.join(appIcon, 'AppIcon-Dark.png'), 4, 4))[3], 0)

  /* The tinted one is read as luminance, so any colour left in it is a lie
     about how bright that part of the drawing is. */
  const tinted = await sharp(path.join(appIcon, 'AppIcon-Tinted.png'))
    .raw()
    .toBuffer({ resolveWithObject: true })
  let coloured = 0
  for (let at = 0; at < tinted.data.length; at += tinted.info.channels)
    if (tinted.data[at] !== tinted.data[at + 1] || tinted.data[at + 1] !== tinted.data[at + 2])
      coloured += 1
  assert.equal(coloured, 0, 'the tinted icon must be grayscale')

  const contents = JSON.parse(await readFile(path.join(appIcon, 'Contents.json'), 'utf8'))
  assert.deepEqual(
    contents.images.map(image => image.appearances?.[0]?.value ?? 'light'),
    ['light', 'dark', 'tinted'],
  )

  const androidSizes = new Map([
    ['mdpi', { launcher: 48, foreground: 108 }],
    ['hdpi', { launcher: 72, foreground: 162 }],
    ['xhdpi', { launcher: 96, foreground: 216 }],
    ['xxhdpi', { launcher: 144, foreground: 324 }],
    ['xxxhdpi', { launcher: 192, foreground: 432 }],
  ])

  for (const [density, sizes] of androidSizes) {
    const directory = path.join(
      outputRoot,
      'android',
      'app',
      'src',
      'main',
      'res',
      `mipmap-${density}`,
    )
    for (const filename of ['ic_launcher.png', 'ic_launcher_round.png']) {
      const metadata = await sharp(path.join(directory, filename)).metadata()
      assert.deepEqual(
        [metadata.width, metadata.height],
        [sizes.launcher, sizes.launcher],
        `${density}/${filename}`,
      )
    }
    const roundIcon = path.join(directory, 'ic_launcher_round.png')
    assert.equal(
      (await rgbaAt(roundIcon, 0, 0))[3],
      0,
      `${density} round icon corners must be transparent`,
    )
    /* The round launcher is its own mask: the circle is already cut, so what
       has to hold is that the mark survived being cut. */
    const round = await markArea(roundIcon, ICON_GROUND)
    assert.ok(
      round > sizes.launcher * sizes.launcher * 0.05,
      `${density} round icon must still carry the mark, got ${round} pixels`,
    )
    for (const filename of ['ic_launcher_foreground.png', 'ic_launcher_monochrome.png']) {
      const metadata = await sharp(path.join(directory, filename)).metadata()
      assert.deepEqual(
        [metadata.width, metadata.height, metadata.hasAlpha],
        [sizes.foreground, sizes.foreground, true],
        `${density}/${filename}`,
      )
    }
  }
})

/* The two rules the shipped assets were breaking, and the reason this file
   grew a mask at all.

   The icons were the right artwork fitted to the wrong shape: a portrait mark
   scaled to fill a square tile, then handed to a launcher that crops. Round
   Android launchers sliced the arch flat top and bottom; iOS shaved the feet
   off the frame. And the launch screen was never ours — it was Capacitor's
   blue mark on white, which is what anybody opening this app actually saw
   first, twice a day, on a background that flashed to black the moment the
   webview arrived. */
test('the mark survives every launcher mask, and the launch screen is ours', async t => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'offwego-brand-masks-'))
  t.after(() => rm(outputRoot, { recursive: true, force: true }))

  const result = spawnSync(
    process.execPath,
    ['scripts/generate-brand-icons.mjs', '--source', iconPath, '--output-root', outputRoot],
    { cwd: appRoot, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)

  const foregrounds = new Map([
    ['mdpi', 108],
    ['hdpi', 162],
    ['xhdpi', 216],
    ['xxhdpi', 324],
    ['xxxhdpi', 432],
  ])
  const androidResources = path.join(outputRoot, 'android', 'app', 'src', 'main', 'res')
  const iosAssets = path.join(outputRoot, 'ios', 'App', 'App', 'Assets.xcassets')

  await t.test('a mask takes nothing away', async () => {
    const iosIcon = path.join(iosAssets, 'AppIcon.appiconset', 'AppIcon-512@2x.png')
    const ios = await underMask(iosIcon, squircleMask(1024), ICON_GROUND)
    assert.ok(ios.whole > 1024 * 1024 * 0.1, `iOS icon must carry the mark, got ${ios.whole}`)
    assert.equal(ios.kept, ios.whole, 'iOS rounds the corners off anything that reaches them')

    /* Android reserves the outer 18 of 108 for the mask, which leaves a
       circle 72 across that every launcher shape contains. */
    for (const [density, size] of foregrounds) {
      for (const layer of ['ic_launcher_foreground.png', 'ic_launcher_monochrome.png']) {
        const file = path.join(androidResources, `mipmap-${density}`, layer)
        const safe = await underMask(file, circleMask(size, 72 / 108), null)
        assert.ok(safe.whole > 0, `${density}/${layer} must carry the mark`)
        assert.equal(safe.kept, safe.whole, `${density}/${layer} must fit the launcher's circle`)
      }
    }

    // The manifest declares the 512 maskable, and maskable means a circle 80%
    // across — the same promise, made to a browser instead.
    const maskable = path.join(outputRoot, 'public', 'icon-512.png')
    const web = await underMask(maskable, circleMask(512, 0.8), ICON_GROUND)
    assert.ok(web.whole > 512 * 512 * 0.05, 'the maskable icon must carry the mark')
    assert.equal(web.kept, web.whole, 'a maskable icon must keep its content inside the circle')
  })

  await t.test('the launch screen is the portal on our own dark', async () => {
    const splashes = [
      ...['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'].map(name =>
        path.join(iosAssets, 'Splash.imageset', name),
      ),
      ...['drawable', 'drawable-port-xxxhdpi', 'drawable-land-xxxhdpi'].map(directory =>
        path.join(androidResources, directory, 'splash.png'),
      ),
    ]

    for (const file of splashes) {
      const corner = await rgbaAt(file, 2, 2)
      assert.deepEqual(
        corner.slice(0, 3),
        SPLASH_GROUND,
        `${path.basename(path.dirname(file))} must sit on the app's own background`,
      )
      const mark = await markArea(file, SPLASH_GROUND)
      assert.ok(mark > 0, `${file} must carry the portal`)

      /* Capacitor's placeholder is a pale blue mark, and nothing in this
         palette is blue: the arch is amber and the sky behind it is red. */
      const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let blue = 0
      for (let at = 0; at < data.length; at += 4)
        if (data[at + 2] > 200 && data[at + 2] > data[at] + 40) blue += 1
      assert.equal(blue, 0, `${file} still carries somebody else's logo`)
    }
  })
})
