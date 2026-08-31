import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(appRoot, 'public', 'wayfare-logo-transparent-teal-road.png');

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

test('generates the approved brand icon for every web and native launcher surface', async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'offwego-brand-icons-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [
      'scripts/generate-brand-icons.mjs',
      '--source', sourcePath,
      '--output-root', outputRoot,
    ],
    { cwd: appRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);

  const webMark = await sharp(path.join(outputRoot, 'public', 'wayfare-icon.png')).metadata();
  assert.deepEqual(
    { width: webMark.width, height: webMark.height, hasAlpha: webMark.hasAlpha },
    { width: 512, height: 512, hasAlpha: true },
  );

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
