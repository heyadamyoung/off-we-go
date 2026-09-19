import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test, { after } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { Screen } from '../src/shared/ui/brand.tsx'
import { WORDMARK_LINES, wordmarkPage } from '../scripts/render-wordmark.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/* The master every icon is cut from: the wordmark, drawn by a browser with
   the app's own display face (scripts/render-wordmark.mjs) onto nothing. */
const iconPath = path.join(appRoot, 'public', 'brand', 'wordmark.png')

test('the mark is the words, in the display face, on nothing', async () => {
  const master = await sharp(iconPath).metadata()
  assert.deepEqual(
    { width: master.width, height: master.height, hasAlpha: master.hasAlpha },
    { width: 2048, height: 2048, hasAlpha: true },
  )
  assert.equal((await rgbaAt(iconPath, 0, 0))[3], 0, 'the master stands on nothing')
  /* Ink, and only two colours of it: the words in the app's ink and the full
     stop in its accent. Anything else drawn is a fallback font's rendering or
     a stray background. */
  const { data } = await sharp(iconPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let ink = 0
  let amber = 0
  for (let at = 0; at < data.length; at += 4) {
    if (data[at + 3] < 250) continue
    if (data[at] > 220 && data[at + 1] > 220 && data[at + 2] > 220) ink += 1
    else if (data[at] > 200 && data[at + 1] > 130 && data[at + 2] < 120) amber += 1
  }
  assert.ok(ink > 2048 * 2048 * 0.08, `the words are drawn, got ${ink} pixels of ink`)
  assert.ok(amber > 2048 * 2048 * 0.002, `the full stop is amber, got ${amber} pixels`)
  assert.ok(amber < ink / 5, 'the full stop is a full stop, not a second word')

  /* The page the browser draws: the app's words, its own font and nothing
     installed on the machine. */
  const page = wordmarkPage('data:font/woff2;base64,AAAA')
  assert.deepEqual(WORDMARK_LINES, ['Off', 'we', 'go.'])
  assert.match(page, /Bricolage Grotesque/)
  assert.match(page, /data:font\/woff2;base64,AAAA/)
  assert.match(page, /Off\nwe\ngo<span class="dot">\.<\/span>/)
})

test('brand UI: the chrome carries type only', () => {
  const screen = renderToStaticMarkup(createElement(Screen, null, 'Loading'))
  assert.match(screen, /Off we go/)
  assert.doesNotMatch(screen, /<img\b/)
})

/* One run of the generator for every test that reads its output. It draws
   dozens of launcher sizes from the vector — five seconds of sharp — and the
   two tests below used to run it once each into directories of their own. */
let generation = null
const generated = () => {
  generation ??= (async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), 'offwego-brand-icons-'))
    const result = spawnSync(
      process.execPath,
      ['scripts/generate-brand-icons.mjs', '--source', iconPath, '--output-root', outputRoot],
      { cwd: appRoot, encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)
    return outputRoot
  })()
  return generation
}
after(async () => {
  if (generation) await rm(await generation, { recursive: true, force: true })
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

test('generates the approved brand icon for every web and native launcher surface', async () => {
  const outputRoot = await generated()

  /* The web's one picture of the app: the words on their dark tile with the
     corners rounded off, so it reads as an icon on a light page too. */
  const webMarkPath = path.join(outputRoot, 'public', 'offwego-icon.png')
  const webMark = await sharp(webMarkPath).metadata()
  assert.deepEqual(
    { width: webMark.width, height: webMark.height, hasAlpha: webMark.hasAlpha },
    { width: 512, height: 512, hasAlpha: true },
  )
  assert.equal((await rgbaAt(webMarkPath, 0, 0))[3], 0, 'the rounded corner is see-through')
  assert.deepEqual((await rgbaAt(webMarkPath, 256, 8)).slice(0, 3), ICON_GROUND, 'a dark tile')

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
  /* White words on nothing vanished on a light browser tab; each favicon is
     the dark tile with its corners rounded, so the corner is see-through and
     the top edge's middle is ground. */
  for (const entry of favicon) {
    assert.deepEqual([...entry.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    const { data, info } = await sharp(entry.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    assert.equal(data[3], 0, `${entry.width}px favicon corner must be transparent`)
    const top = Math.floor(info.width / 2) * 4
    assert.equal(data[top + 3], 255, `${entry.width}px favicon stands on its tile`)
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

/* The two rules the shipped assets once broke, and the reason this file
   grew a mask at all.

   The icons were the right artwork fitted to the wrong shape: a mark scaled
   to fill a square tile, then handed to a launcher that crops. Round Android
   launchers sliced the old mark flat top and bottom; iOS shaved its feet off.
   The words are wider than they are tall in places and three lines deep, so
   the same rule holds for them. And the launch screen was never ours — it
   was Capacitor's blue mark on white, which is what anybody opening this app
   actually saw first, twice a day, on a background that flashed to black
   the moment the webview arrived. */
test('the mark survives every launcher mask, and the launch screen is ours', async t => {
  const outputRoot = await generated()

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
