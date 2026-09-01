import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const modulePath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(modulePath), '..');
const background = { r: 10, g: 12, b: 16, alpha: 1 };
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

const androidDensities = new Map([
  ['mdpi', { launcher: 48, foreground: 108 }],
  ['hdpi', { launcher: 72, foreground: 162 }],
  ['xhdpi', { launcher: 96, foreground: 216 }],
  ['xxhdpi', { launcher: 144, foreground: 324 }],
  ['xxxhdpi', { launcher: 192, foreground: 432 }],
]);

async function writeAsset(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, bytes);
}

async function transparentIcon(sourcePath, size) {
  return sharp(sourcePath)
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}

async function opaqueIcon(sourcePath, size) {
  return sharp(sourcePath)
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .flatten({ background })
    .removeAlpha()
    .png()
    .toBuffer();
}

async function adaptiveForeground(source, size) {
  const artworkSize = Math.round(size * 0.82);
  const artwork = await source
    .clone()
    .resize(artworkSize, artworkSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const offset = Math.floor((size - artworkSize) / 2);

  return sharp({ create: { width: size, height: size, channels: 4, background: transparent } })
    .composite([{ input: artwork, left: offset, top: offset }])
    .png()
    .toBuffer();
}

async function monochromeMaster(sourcePath) {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(data.length);

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    const isCream = red > 180 && green > 170 && blue > 150;
    output[index] = 255;
    output[index + 1] = 255;
    output[index + 2] = 255;
    output[index + 3] = isCream ? 0 : alpha;
  }

  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 },
  });
}

async function roundLauncher(sourcePath, size) {
  const square = await opaqueIcon(sourcePath, size);
  const { data, info } = await sharp(square)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const center = (size - 1) / 2;
  const radius = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance));
      data[(y * size + x) * 4 + 3] = Math.round(255 * coverage);
    }
  }

  return sharp(data, { raw: info })
    .png()
    .toBuffer();
}

function createIco(images) {
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = headerSize;
  images.forEach(({ size, bytes }, index) => {
    const entryOffset = 6 + index * 16;
    header[entryOffset] = size === 256 ? 0 : size;
    header[entryOffset + 1] = size === 256 ? 0 : size;
    header[entryOffset + 2] = 0;
    header[entryOffset + 3] = 0;
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(bytes.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += bytes.length;
  });

  return Buffer.concat([header, ...images.map(({ bytes }) => bytes)]);
}

export async function generateBrandIcons({ sourcePath, outputRoot }) {
  const source = sharp(sourcePath);
  const monochrome = await monochromeMaster(sourcePath);
  const publicDirectory = path.join(outputRoot, 'public');

  await writeAsset(path.join(publicDirectory, 'offwego-icon.png'), await transparentIcon(sourcePath, 512));

  for (const [filename, size] of [
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ]) {
    await writeAsset(path.join(publicDirectory, filename), await opaqueIcon(sourcePath, size));
  }

  const faviconImages = await Promise.all(
    [16, 32, 48, 256].map(async (size) => ({ size, bytes: await transparentIcon(sourcePath, size) })),
  );
  await writeAsset(path.join(publicDirectory, 'favicon.ico'), createIco(faviconImages));

  await writeAsset(
    path.join(outputRoot, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'),
    await opaqueIcon(sourcePath, 1024),
  );

  for (const [density, sizes] of androidDensities) {
    const directory = path.join(outputRoot, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`);
    await Promise.all([
      writeAsset(path.join(directory, 'ic_launcher.png'), await opaqueIcon(sourcePath, sizes.launcher)),
      writeAsset(path.join(directory, 'ic_launcher_round.png'), await roundLauncher(sourcePath, sizes.launcher)),
      writeAsset(path.join(directory, 'ic_launcher_foreground.png'), await adaptiveForeground(source, sizes.foreground)),
      writeAsset(path.join(directory, 'ic_launcher_monochrome.png'), await adaptiveForeground(monochrome, sizes.foreground)),
    ]);
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (path.resolve(process.argv[1] || '') === modulePath) {
  const sourcePath = path.resolve(argumentValue('--source') || path.join(appRoot, 'public', 'offwego-logo-transparent-teal-road.png'));
  const outputRoot = path.resolve(argumentValue('--output-root') || appRoot);
  await generateBrandIcons({ sourcePath, outputRoot });
}
