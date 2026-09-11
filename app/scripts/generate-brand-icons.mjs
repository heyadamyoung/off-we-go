import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const modulePath = fileURLToPath(import.meta.url)
const appRoot = path.resolve(path.dirname(modulePath), '..')
/* The ground a launcher icon stands on, and the app's own background. They
   are a shade apart and both deliberate: the icon's is the darker of the two
   so the portal reads on a bright home screen, and the splash uses the
   webview's exact colour so there is no seam when the app takes over. */
const background = { r: 10, g: 12, b: 16, alpha: 1 }
const canvas = { r: 11, g: 13, b: 17, alpha: 1 }
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
/* The tinted icon's ground. Black rather than the brand's near-black: the
   system reads this picture as luminance, and anything above nought there is
   a tint it will paint. */
const black = { r: 0, g: 0, b: 0, alpha: 1 }
const transparentExportSizes = [16, 32, 48, 64, 128, 256, 512, 1024]

const androidDensities = new Map([
  ['mdpi', { launcher: 48, foreground: 108 }],
  ['hdpi', { launcher: 72, foreground: 162 }],
  ['xhdpi', { launcher: 96, foreground: 216 }],
  ['xxhdpi', { launcher: 144, foreground: 324 }],
  ['xxxhdpi', { launcher: 192, foreground: 432 }],
])

/* Capacitor's own splash sizes, which is why they are these and not rounder
   numbers: the files already exist under these names and the native projects
   already point at them. */
const androidSplashes = new Map([
  ['drawable', [480, 320]],
  ['drawable-land-mdpi', [480, 320]],
  ['drawable-land-hdpi', [800, 480]],
  ['drawable-land-xhdpi', [1280, 720]],
  ['drawable-land-xxhdpi', [1600, 960]],
  ['drawable-land-xxxhdpi', [1920, 1280]],
  ['drawable-port-mdpi', [320, 480]],
  ['drawable-port-hdpi', [480, 800]],
  ['drawable-port-xhdpi', [720, 1280]],
  ['drawable-port-xxhdpi', [960, 1600]],
  ['drawable-port-xxxhdpi', [1280, 1920]],
])

const iosSplashes = ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']
const IOS_SPLASH = 2732

/* ---- how much of a tile the mark may fill ---------------------------------

   Every launcher crops an icon, and each crops a different shape. A tall
   portrait mark dropped into a square tile and scaled to fit therefore loses
   its corners — which is exactly what was happening: on Android the arch was
   sliced flat top and bottom by round launchers, and on iOS the superellipse
   shaved the feet off the frame.

   So the mark is not fitted to the tile. It is fitted to the part of the tile
   that survives the mask, which is a different and smaller thing, and the
   sums are here rather than in a magic number. */

/**
 * The share of a square tile a mark of this shape may fill, measured on its
 * height, when the mask keeps a centred circle of `safe` across.
 *
 * A centred rectangle's corners are its furthest points from the middle, so
 * they are what has to fit: half its diagonal must be inside the circle.
 */
export function safeScale(aspect, safe) {
  return safe / Math.hypot(1, aspect)
}

/**
 * The same for iOS, whose mask is a rounded square rather than a circle.
 *
 * Nothing is clipped except near the four corners, so a mark may be much
 * bigger here than under a circle — the question is only whether its own
 * bottom corners clear the curve. Iterating beats algebra: the shape is a
 * superellipse in the flesh and a rounded rectangle in the arithmetic, and
 * the answer wanted is "the biggest size that clears", to a percent.
 */
export function cornerScale(aspect, radius = 0.2237, margin = 0.02) {
  for (let fill = 100; fill > 1; fill -= 1) {
    const share = fill / 100
    // The mark's bottom corner, in tile units from the top left.
    const x = 0.5 - (aspect * share) / 2
    const y = 0.5 + share / 2
    // The centre of the mask's corner arc nearest it.
    const reach = Math.hypot(radius - x, y - (1 - radius))
    if (x >= radius || y <= 1 - radius || reach <= radius - margin) return share
  }
  return 0.5
}

async function writeAsset(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, bytes)
}

/** Where the drawing actually is inside its square, ignoring empty margin. */
async function inkBox(source, side = 2048) {
  const rendered = await sharp(source)
    .resize(side, side, { fit: 'contain', background: transparent, kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()
  const { data, info } = await sharp(rendered)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] <= 8) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  const width = Math.max(1, right - left + 1)
  const height = Math.max(1, bottom - top + 1)
  return { left, top, width, height, side, aspect: width / height }
}

/** The drawing alone, with no margin, at this many pixels tall. */
async function markAt(source, box, height) {
  const side = Math.max(8, Math.round((height * box.side) / box.height))
  const scale = side / box.side
  const rendered = await sharp(source)
    .resize(side, side, { fit: 'contain', background: transparent, kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()
  const width = Math.max(1, Math.min(side, Math.round(box.width * scale)))
  const tall = Math.max(1, Math.min(side, Math.round(box.height * scale)))
  return sharp(rendered)
    .extract({
      left: Math.max(0, Math.min(side - width, Math.round(box.left * scale))),
      top: Math.max(0, Math.min(side - tall, Math.round(box.top * scale))),
      width,
      height: tall,
    })
    .png()
    .toBuffer()
}

/**
 * The mark centred on a tile, filling the share of it a mask leaves alone.
 *
 * `of` is what that share is measured against, and it is the short side for
 * anything square because that is what a mask crops to. A launch screen is
 * not a tile: it is a mark on a phone, and what makes a portrait one and a
 * landscape one look like the same screen is the height they each fill.
 */
async function tile(
  source,
  box,
  { size, fill, ground = null, width = size, height = size, of = Math.min(width, height) },
) {
  const mark = await markAt(source, box, Math.round(of * fill))
  const shape = await sharp(mark).metadata()
  const base = sharp({
    create: { width, height, channels: 4, background: ground || transparent },
  })
  const placed = await base
    .composite([
      {
        input: mark,
        left: Math.round((width - shape.width) / 2),
        top: Math.round((height - shape.height) / 2),
      },
    ])
    .png()
    .toBuffer()
  return ground
    ? sharp(placed).flatten({ background: ground }).removeAlpha().png().toBuffer()
    : placed
}

async function transparentIcon(sourcePath, size) {
  return sharp(sourcePath)
    .resize(size, size, { fit: 'contain', background: transparent, kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()
}

/** A circle-cropped launcher icon, with the mark already inside the circle. */
async function roundLauncher(source, box, size, fill) {
  const square = await tile(source, box, { size, fill, ground: background })
  const { data, info } = await sharp(square)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const center = (size - 1) / 2
  const radius = size / 2

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center)
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance))
      data[(y * size + x) * 4 + 3] = Math.round(255 * coverage)
    }
  }

  return sharp(data, { raw: info }).png().toBuffer()
}

/* The themed-icon layer: the drawing as a silhouette, so Android can tint it
   to whatever the wallpaper made of the hour. The cream road and sun are the
   parts that read as "lit", so they become the holes. */
async function monochromeMaster(sourcePath, side = 2048) {
  const { data, info } = await sharp(sourcePath)
    .resize(side, side, { fit: 'contain', background: transparent, kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const output = Buffer.alloc(data.length)

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index]
    const green = data[index + 1]
    const blue = data[index + 2]
    const alpha = data[index + 3]
    const isCream = red > 180 && green > 170 && blue > 150
    output[index] = 255
    output[index + 1] = 255
    output[index + 2] = 255
    output[index + 3] = isCream ? 0 : alpha
  }

  return sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer()
}

/* The iOS tinted appearance: the system takes a grayscale picture and maps
   its luminance onto whatever tint somebody chose. So it wants the drawing's
   light and shade, not a silhouette — the sun bright, the sky between, the
   road a pale ribbon out of a dark foreground. */
async function greyMaster(sourcePath, side = 2048) {
  return sharp(sourcePath)
    .resize(side, side, { fit: 'contain', background: transparent, kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .png()
    .toBuffer()
}

/* The three icons iOS 18 asks for, and what tells them apart. The light one
   stands on its own dark ground; the dark one is handed over with that ground
   removed, so the system's own backdrop shows through and the icon belongs to
   the home screen it is on rather than sitting in a black square on it. */
const IOS_APPEARANCES = {
  images: [
    {
      filename: 'AppIcon-512@2x.png',
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    },
    {
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      filename: 'AppIcon-Dark.png',
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    },
    {
      appearances: [{ appearance: 'luminosity', value: 'tinted' }],
      filename: 'AppIcon-Tinted.png',
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    },
  ],
  info: { author: 'xcode', version: 1 },
}

function createIco(images) {
  const headerSize = 6 + images.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let imageOffset = headerSize
  images.forEach(({ size, bytes }, index) => {
    const entryOffset = 6 + index * 16
    header[entryOffset] = size === 256 ? 0 : size
    header[entryOffset + 1] = size === 256 ? 0 : size
    header[entryOffset + 2] = 0
    header[entryOffset + 3] = 0
    header.writeUInt16LE(1, entryOffset + 4)
    header.writeUInt16LE(32, entryOffset + 6)
    header.writeUInt32LE(bytes.length, entryOffset + 8)
    header.writeUInt32LE(imageOffset, entryOffset + 12)
    imageOffset += bytes.length
  })

  return Buffer.concat([header, ...images.map(({ bytes }) => bytes)])
}

/**
 * How much of each surface the mark fills, worked out from its own shape.
 *
 *   ios        a rounded square that only bites at the corners
 *   maskable   the web manifest's rule: a circle 80% across
 *   adaptive   Android's: the outer 18 of 108 may go, so a circle of 72
 *   round      the pre-adaptive round launcher, a full-tile circle with a rim
 *   splash     nothing crops this; it is a mark on a screen, not a tile
 */
export function fills(aspect) {
  return {
    ios: cornerScale(aspect),
    maskable: safeScale(aspect, 0.8),
    adaptive: safeScale(aspect, 72 / 108),
    round: safeScale(aspect, 0.92),
    splash: 0.22,
  }
}

export async function generateBrandIcons({ sourcePath, outputRoot }) {
  const vectorMaster = await readFile(sourcePath)
  const box = await inkBox(sourcePath)
  const share = fills(box.aspect)
  const monochrome = await monochromeMaster(sourcePath)
  const monoBox = await inkBox(monochrome)
  const publicDirectory = path.join(outputRoot, 'public')

  await writeAsset(path.join(publicDirectory, 'offwego-icon.svg'), vectorMaster)
  await writeAsset(
    path.join(publicDirectory, 'offwego-icon.png'),
    await transparentIcon(sourcePath, 512),
  )
  await Promise.all(
    transparentExportSizes.map(async size =>
      writeAsset(
        path.join(publicDirectory, 'brand', `offwego-icon-${size}.png`),
        await transparentIcon(sourcePath, size),
      ),
    ),
  )

  /* The touch icon is an iOS home screen icon by another name, and the 512 is
     declared maskable in the manifest — so both are composed for a mask
     rather than fitted to their own edges. */
  for (const [filename, size, fill] of [
    ['apple-touch-icon.png', 180, share.ios],
    ['icon-192.png', 192, share.ios],
    ['icon-512.png', 512, share.maskable],
  ]) {
    await writeAsset(
      path.join(publicDirectory, filename),
      await tile(sourcePath, box, { size, fill, ground: background }),
    )
  }

  const faviconImages = await Promise.all(
    [16, 32, 48, 256].map(async size => ({ size, bytes: await transparentIcon(sourcePath, size) })),
  )
  await writeAsset(path.join(publicDirectory, 'favicon.ico'), createIco(faviconImages))

  const iosAssets = path.join(outputRoot, 'ios', 'App', 'App', 'Assets.xcassets')
  const appIcon = path.join(iosAssets, 'AppIcon.appiconset')
  const grey = await greyMaster(sourcePath)
  await writeAsset(
    path.join(appIcon, 'AppIcon-512@2x.png'),
    await tile(sourcePath, box, { size: 1024, fill: share.ios, ground: background }),
  )
  await writeAsset(
    path.join(appIcon, 'AppIcon-Dark.png'),
    await tile(sourcePath, box, { size: 1024, fill: share.ios }),
  )
  await writeAsset(
    path.join(appIcon, 'AppIcon-Tinted.png'),
    await tile(grey, await inkBox(grey), { size: 1024, fill: share.ios, ground: black }),
  )
  await writeAsset(
    path.join(appIcon, 'Contents.json'),
    Buffer.from(`${JSON.stringify(IOS_APPEARANCES, null, 2)}\n`),
  )

  /* The launch screen. It was Capacitor's own blue mark on white — the first
     thing anybody saw of this app, twice a day, was somebody else's logo on a
     background that flashed to black the moment the webview arrived. */
  const iosSplash = await tile(sourcePath, box, {
    size: IOS_SPLASH,
    fill: share.splash,
    ground: canvas,
  })
  for (const filename of iosSplashes)
    await writeAsset(path.join(iosAssets, 'Splash.imageset', filename), iosSplash)

  const androidResources = path.join(outputRoot, 'android', 'app', 'src', 'main', 'res')
  for (const [directory, [width, height]] of androidSplashes) {
    await writeAsset(
      path.join(androidResources, directory, 'splash.png'),
      await tile(sourcePath, box, {
        size: Math.min(width, height),
        width,
        height,
        of: height,
        fill: share.splash,
        ground: canvas,
      }),
    )
  }

  for (const [density, sizes] of androidDensities) {
    const directory = path.join(androidResources, `mipmap-${density}`)
    await Promise.all([
      writeAsset(
        path.join(directory, 'ic_launcher.png'),
        await tile(sourcePath, box, { size: sizes.launcher, fill: share.ios, ground: background }),
      ),
      writeAsset(
        path.join(directory, 'ic_launcher_round.png'),
        await roundLauncher(sourcePath, box, sizes.launcher, share.round),
      ),
      writeAsset(
        path.join(directory, 'ic_launcher_foreground.png'),
        await tile(sourcePath, box, { size: sizes.foreground, fill: share.adaptive }),
      ),
      writeAsset(
        path.join(directory, 'ic_launcher_monochrome.png'),
        await tile(monochrome, monoBox, { size: sizes.foreground, fill: share.adaptive }),
      ),
    ])
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

if (path.resolve(process.argv[1] || '') === modulePath) {
  const sourcePath = path.resolve(
    argumentValue('--source') || path.join(appRoot, 'public', 'offwego-icon.svg'),
  )
  const outputRoot = path.resolve(argumentValue('--output-root') || appRoot)
  await generateBrandIcons({ sourcePath, outputRoot })
}
