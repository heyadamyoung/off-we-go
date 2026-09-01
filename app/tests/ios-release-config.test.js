import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('archive arguments leave dependency bundle identifiers untouched', async () => {
  const { createArchiveArguments } = await import('../scripts/iosArchive.mjs');

  assert.deepEqual(createArchiveArguments({
    archivePath: '/tmp/OffWeGo.xcarchive',
    teamId: 'R65UN25Q64',
    buildNumber: '42',
    domain: 'offwego.to',
  }), [
    '-workspace', 'ios/App/App.xcworkspace',
    '-scheme', 'App',
    '-configuration', 'Release',
    '-destination', 'generic/platform=iOS',
    '-archivePath', '/tmp/OffWeGo.xcarchive',
    'DEVELOPMENT_TEAM=R65UN25Q64',
    'CURRENT_PROJECT_VERSION=42',
    'WAYFARE_DOMAIN=offwego.to',
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

test('the iOS compile workflow installs pnpm before setup-node configures its pnpm cache', async () => {
  const workflow = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, '..', '.github', 'workflows', 'ios-build.yml'), 'utf8'),
  );

  const pnpmSetup = workflow.indexOf('pnpm/action-setup@');
  const nodeSetup = workflow.indexOf('actions/setup-node@');

  assert.notEqual(pnpmSetup, -1, 'The workflow must install pnpm with pnpm/action-setup');
  assert.ok(pnpmSetup < nodeSetup, 'pnpm must be available before setup-node restores its pnpm cache');
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

test('every native iOS build configuration supports iOS 15 or later', async () => {
  const { readFile } = await import('node:fs/promises');
  const [podfile, project] = await Promise.all([
    readFile(path.join(appRoot, 'ios/App/Podfile'), 'utf8'),
    readFile(path.join(appRoot, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8'),
  ]);

  const podfileTarget = podfile.match(/platform :ios, '(\d+(?:\.\d+)*)'/)?.[1];
  const projectTargets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = (\d+(?:\.\d+)*);/g)]
    .map((match) => match[1]);

  assert.equal(podfileTarget, '15.0');
  assert.ok(projectTargets.length > 0, 'The Xcode project must declare an iOS deployment target');
  assert.deepEqual([...new Set(projectTargets)], ['15.0']);
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

test('the marketing version comes from the Xcode project, not a second copy of it', async () => {
  const { readMarketingVersion } = await import('../scripts/iosMarketingVersion.mjs');

  assert.equal(readMarketingVersion('        MARKETING_VERSION = 1.1;'), '1.1');
  assert.equal(readMarketingVersion('MARKETING_VERSION = 2.10.3;'), '2.10.3');
  assert.throws(() => readMarketingVersion('CURRENT_PROJECT_VERSION = 7;'), /MARKETING_VERSION/);
  assert.throws(() => readMarketingVersion(undefined), /MARKETING_VERSION/);
});

test('the version the beta is filed under is the one the project ships', async () => {
  const { readMarketingVersion } = await import('../scripts/iosMarketingVersion.mjs');
  const { readFile } = await import('node:fs/promises');

  const project = await readFile(
    path.join(appRoot, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'), 'utf8',
  );
  const printed = spawnSync(process.execPath, [
    path.join(appRoot, 'scripts', 'iosMarketingVersion.mjs'),
  ], { encoding: 'utf8' });

  assert.equal(printed.status, 0);
  assert.equal(printed.stdout, readMarketingVersion(project));
});
