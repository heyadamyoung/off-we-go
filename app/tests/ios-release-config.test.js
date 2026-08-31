import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('archive arguments leave dependency bundle identifiers untouched', async () => {
  const { createArchiveArguments } = await import('../scripts/iosArchive.mjs');

  assert.deepEqual(createArchiveArguments({
    archivePath: '/tmp/Wayfare.xcarchive',
    teamId: 'R65UN25Q64',
    buildNumber: '42',
    domain: 'wayfare.threadway.ai',
  }), [
    '-workspace', 'ios/App/App.xcworkspace',
    '-scheme', 'App',
    '-configuration', 'Release',
    '-destination', 'generic/platform=iOS',
    '-archivePath', '/tmp/Wayfare.xcarchive',
    'DEVELOPMENT_TEAM=R65UN25Q64',
    'CURRENT_PROJECT_VERSION=42',
    'WAYFARE_DOMAIN=wayfare.threadway.ai',
    'clean', 'archive',
  ]);
});

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

test('the Ad Hoc export configuration creates a device-installable release', async () => {
  const { createExportOptions } = await import('../scripts/iosReleaseCore.mjs');

  const plist = createExportOptions({
    teamId: 'R65UN25Q64',
    bundleId: 'ai.threadway.wayfare',
    profileName: 'Wayfare iPad Ad Hoc',
    distribution: 'ad-hoc',
  });

  assert.match(plist, /<key>method<\/key>\s*<string>release-testing<\/string>/);
  assert.match(plist, /<key>destination<\/key>\s*<string>export<\/string>/);
  assert.match(plist, /<key>ai\.threadway\.wayfare<\/key>\s*<string>Wayfare iPad Ad Hoc<\/string>/);
  assert.match(plist, /<key>signingStyle<\/key>\s*<string>manual<\/string>/);
  assert.match(plist, /<key>signingCertificate<\/key>\s*<string>Apple Distribution<\/string>/);
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

test('the manual-signing workflow does not request automatic provisioning updates', async () => {
  const workflow = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, '..', '.github', 'workflows', 'testflight.yml'), 'utf8'),
  );

  assert.doesNotMatch(workflow, /-allowProvisioningUpdates/);
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

test('the native app uses Capacitor HTTP so authentication survives WebView suspension', async () => {
  const config = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, 'capacitor.config.json'), 'utf8'),
  );

  assert.equal(JSON.parse(config).plugins?.CapacitorHttp?.enabled, true);
});

test('the iOS app can be opened explicitly by an email browser handoff', async () => {
  const infoPlist = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, 'ios/App/App/Info.plist'), 'utf8'),
  );

  assert.match(infoPlist, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>wayfare<\/string>/);
});

test('Ad Hoc device input accepts modern and legacy Apple UDIDs without accepting other identifiers', async () => {
  const { parseAdHocDevices } = await import('../scripts/iosAdHocDevices.mjs');

  assert.deepEqual(parseAdHocDevices(JSON.stringify({
    'Family iPhone': '00008120-001E5DE81AD8201E',
    'Older iPad': 'A'.repeat(40),
  })), {
    'Family iPhone': '00008120-001E5DE81AD8201E',
    'Older iPad': 'A'.repeat(40),
  });
  assert.throws(
    () => parseAdHocDevices(JSON.stringify({ 'Family iPhone': '89049032007108882600151350551843' })),
    /valid Apple UDID/i,
  );
});
