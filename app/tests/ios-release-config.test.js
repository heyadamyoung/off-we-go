import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the TestFlight export configuration uploads a manually signed App Store build', async () => {
  const { createExportOptions } = await import('../scripts/iosReleaseCore.mjs');

  const plist = createExportOptions({
    teamId: 'R65UN25Q64',
    bundleId: 'ai.threadway.wayfare',
    profileName: 'Wayfare App Store CI',
  });

  assert.match(plist, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(plist, /<key>destination<\/key>\s*<string>upload<\/string>/);
  assert.match(plist, /<key>signingStyle<\/key>\s*<string>manual<\/string>/);
  assert.match(plist, /<key>signingCertificate<\/key>\s*<string>Apple Distribution<\/string>/);
  assert.match(plist, /<key>ai\.threadway\.wayfare<\/key>\s*<string>Wayfare App Store CI<\/string>/);
  assert.match(plist, /<key>teamID<\/key>\s*<string>R65UN25Q64<\/string>/);
  assert.match(plist, /<key>manageAppVersionAndBuildNumber<\/key>\s*<false\/>/);
});

test('the TestFlight export configuration rejects an invalid Apple team ID', async () => {
  const { createExportOptions } = await import('../scripts/iosReleaseCore.mjs');

  assert.throws(
    () => createExportOptions({ teamId: 'not-a-team' }),
    /10-character Apple team ID/i,
  );
});

test('the export configuration CLI emits the plist used by the release workflow', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/iosReleaseCore.mjs', 'R65UN25Q64', 'ai.threadway.wayfare', 'Wayfare App Store CI'],
    { cwd: appRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(result.stdout, /<string>R65UN25Q64<\/string>/);
  assert.match(result.stdout, /<string>Wayfare App Store CI<\/string>/);
});

test('the iOS app declares that it does not use non-exempt encryption', async () => {
  const infoPlist = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, 'ios/App/App/Info.plist'), 'utf8'),
  );

  assert.match(
    infoPlist,
    /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/,
  );
});
