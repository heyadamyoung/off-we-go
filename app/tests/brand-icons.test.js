import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { Brandmark, Screen } from '../src/shared/ui/brand.tsx';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(appRoot, 'public', 'offwego-logo.svg');
const iconPath = path.join(appRoot, 'public', 'offwego-icon.svg');

test('uses genuine vector artwork for the new portal icon and full lockup', async () => {
  const logo = await readFile(sourcePath, 'utf8');
  assert.match(logo, /^<svg\b/);
  assert.match(logo, /viewBox=["']0 0 635 568["']/);
  assert.match(logo, /<title[^>]*>Off We Go logo<\/title>/);
  assert.doesNotMatch(logo, /<image\b/);
  assert.doesNotMatch(logo, /<text\b/);
  assert.ok((logo.match(/<path\b/g) || []).length >= 13, 'full lockup must remain outlined vector paths');

  const icon = await readFile(iconPath, 'utf8');
  assert.match(icon, /^<svg\b/);
  assert.match(icon, /viewBox=["']0 0 820 1060["']/);
  assert.doesNotMatch(icon, /<image\b/);
  assert.doesNotMatch(icon, /<text\b/);
  assert.ok((icon.match(/inkscape:groupmode=["']layer["']/g) || []).length >= 6, 'icon must expose editable layers');

  const { data } = await sharp(iconPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, 'vector icon background must be transparent');
});

test('brand UI renders the new vector portal instead of the old pin or raster fallback', () => {
  const brandmark = renderToStaticMarkup(createElement(Brandmark, { size: 18 }));
  assert.match(brandmark, /<img[^>]+src="\/offwego-icon\.svg"/);
  assert.doesNotMatch(brandmark, /<svg\b/);

  const screen = renderToStaticMarkup(createElement(Screen, null, 'Loading'));
  assert.match(screen, /<img[^>]+src="\/offwego-icon\.svg"/);
  assert.doesNotMatch(screen, /offwego-icon\.png/);
});

function parseIco(buffer) {
  assert.deepEqual([...buffer.subarray(0, 4)], [0, 0, 1, 0]);
  const count = buffer.readUInt16LE(4);

  return Array.from({ length: count }, (_, index) => {
    const entryOffset = 6 + index * 16;
    const width = buffer[entryOffset] || 256;
    const height = buffer[entryOffset + 1] || 256;
    const byteLength = buffer.readUInt32LE(entryOffset + 8);
    const imageOffset = buffer.readUInt32LE(entryOffset + 12);
    return {
      width,
      height,
      bytes: buffer.subarray(imageOffset, imageOffset + byteLength),
    };
  });
}

async function rgbaAt(filename, x, y) {
  const { data, info } = await sharp(filename)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * 4;
  return [...data.subarray(offset, offset + 4)];
}

async function renderedRgbaAt(filename, size, x, y) {
  const { data, info } = await sharp(filename)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * 4;
  return [...data.subarray(offset, offset + 4)];
}

/* The arch and the road share one gradient, and it was warmed to the interface
   accent (#F5B84A) so the mark and the chrome read as one family — the sunset
   inside the arch keeps its reds. What still has to hold is the shape of that
   gradient: a pale crown, a deeper road, and daylight between them. */
test('renders the approved warm gradient from the portal crown to the road', async () => {
  const crown = await renderedRgbaAt(iconPath, 512, 256, 24);
  const road = await renderedRgbaAt(iconPath, 512, 256, 488);

  assert.ok(crown[1] > 180, `expected a pale amber crown, got ${crown}`);
  assert.ok(road[1] > 100 && road[1] < 160, `expected a deeper amber road, got ${road}`);
  assert.ok(crown[1] - road[1] > 60, 'portal and road must not collapse back to one flat fill');
  // Amber, not the old red-orange: the blue channel is what separates the two.
  assert.ok(crown[2] > 80, `expected the crown in the accent's family, got ${crown}`);
});

test('renders the full lockup on its dark backdrop so the cream wordmark remains visible', async () => {
  const backdrop = await rgbaAt(sourcePath, 10, 550);
  const wordmark = await rgbaAt(sourcePath, 30, 477);

  assert.ok(backdrop[0] < 20 && backdrop[1] < 20 && backdrop[2] < 20 && backdrop[3] === 255, `expected opaque dark backdrop, got ${backdrop}`);
  assert.ok(wordmark[0] > 240 && wordmark[1] > 225 && wordmark[2] > 210 && wordmark[3] === 255, `expected readable cream wordmark, got ${wordmark}`);
});

test('generates the approved brand icon for every web and native launcher surface', async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'offwego-brand-icons-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [
      'scripts/generate-brand-icons.mjs',
      '--source', iconPath,
      '--output-root', outputRoot,
    ],
    { cwd: appRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);

  const generatedSvg = await readFile(path.join(outputRoot, 'public', 'offwego-icon.svg'), 'utf8');
  assert.doesNotMatch(generatedSvg, /<image\b/, 'generated SVG must preserve vector paths');
  assert.doesNotMatch(generatedSvg, /<text\b/, 'generated SVG must not depend on an installed font');

  const webMarkPath = path.join(outputRoot, 'public', 'offwego-icon.png');
  const webMark = await sharp(webMarkPath).metadata();
  assert.deepEqual(
    { width: webMark.width, height: webMark.height, hasAlpha: webMark.hasAlpha },
    { width: 512, height: 512, hasAlpha: true },
  );
  assert.equal((await rgbaAt(webMarkPath, 0, 0))[3], 0, 'web mark background must be transparent');

  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    const metadata = await sharp(path.join(
      outputRoot,
      'public',
      'brand',
      `offwego-icon-${size}.png`,
    )).metadata();
    assert.deepEqual(
      { width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha },
      { width: size, height: size, hasAlpha: true },
      `transparent ${size}px export`,
    );
    assert.equal((await rgbaAt(path.join(
      outputRoot,
      'public',
      'brand',
      `offwego-icon-${size}.png`,
    ), 0, 0))[3], 0, `transparent ${size}px export corner`);
  }

  for (const [filename, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
    const metadata = await sharp(path.join(outputRoot, 'public', filename)).metadata();
    assert.deepEqual(
      { width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha },
      { width: size, height: size, hasAlpha: false },
      filename,
    );
  }

  const favicon = parseIco(await readFile(path.join(outputRoot, 'public', 'favicon.ico')));
  assert.deepEqual(favicon.map(({ width, height }) => [width, height]), [
    [16, 16],
    [32, 32],
    [48, 48],
    [256, 256],
  ]);
  for (const entry of favicon) {
    assert.deepEqual([...entry.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const { data } = await sharp(entry.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, `${entry.width}px favicon corner must be transparent`);
  }

  const iosIcon = await sharp(path.join(
    outputRoot,
    'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png',
  )).metadata();
  assert.deepEqual(
    { width: iosIcon.width, height: iosIcon.height, hasAlpha: iosIcon.hasAlpha },
    { width: 1024, height: 1024, hasAlpha: false },
  );

  const androidSizes = new Map([
    ['mdpi', { launcher: 48, foreground: 108 }],
    ['hdpi', { launcher: 72, foreground: 162 }],
    ['xhdpi', { launcher: 96, foreground: 216 }],
    ['xxhdpi', { launcher: 144, foreground: 324 }],
    ['xxxhdpi', { launcher: 192, foreground: 432 }],
  ]);

  for (const [density, sizes] of androidSizes) {
    const directory = path.join(outputRoot, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`);
    for (const filename of ['ic_launcher.png', 'ic_launcher_round.png']) {
      const metadata = await sharp(path.join(directory, filename)).metadata();
      assert.deepEqual([metadata.width, metadata.height], [sizes.launcher, sizes.launcher], `${density}/${filename}`);
    }
    const roundIcon = path.join(directory, 'ic_launcher_round.png');
    assert.equal((await rgbaAt(roundIcon, 0, 0))[3], 0, `${density} round icon corners must be transparent`);
    const upperMark = await rgbaAt(
      roundIcon,
      Math.floor(sizes.launcher * 0.3),
      Math.floor(sizes.launcher / 4),
    );
    assert.ok(
      upperMark[0] > 200 && upperMark[1] < 160 && upperMark[2] < 100 && upperMark[3] === 255,
      `${density} round icon must retain the orange logo`,
    );
    for (const filename of ['ic_launcher_foreground.png', 'ic_launcher_monochrome.png']) {
      const metadata = await sharp(path.join(directory, filename)).metadata();
      assert.deepEqual(
        [metadata.width, metadata.height, metadata.hasAlpha],
        [sizes.foreground, sizes.foreground, true],
        `${density}/${filename}`,
      );
    }
  }
});
