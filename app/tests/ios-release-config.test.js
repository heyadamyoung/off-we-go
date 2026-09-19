import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('archive arguments leave dependency bundle identifiers untouched', async () => {
  const { createArchiveArguments } = await import('../scripts/iosArchive.mjs')

  assert.deepEqual(
    createArchiveArguments({
      archivePath: '/tmp/OffWeGo.xcarchive',
      teamId: 'R65UN25Q64',
      buildNumber: '42',
      domain: 'offwego.to',
    }),
    [
      '-workspace',
      'ios/App/App.xcworkspace',
      '-scheme',
      'App',
      '-configuration',
      'Release',
      '-destination',
      'generic/platform=iOS',
      '-archivePath',
      '/tmp/OffWeGo.xcarchive',
      'DEVELOPMENT_TEAM=R65UN25Q64',
      'CURRENT_PROJECT_VERSION=42',
      'WAYFARE_DOMAIN=offwego.to',
      'clean',
      'archive',
    ],
  )
})

test('the TestFlight export configuration uploads a manually signed App Store build', async () => {
  const { createExportOptions } = await import('../scripts/iosReleaseCore.mjs')

  const plist = createExportOptions({
    teamId: 'R65UN25Q64',
    bundleId: 'ai.threadway.wayfare',
    profileName: 'Wayfare App Store CI',
  })

  assert.match(plist, /<key>method<\/key>\s*<string>app-store-connect<\/string>/)
  assert.match(plist, /<key>destination<\/key>\s*<string>upload<\/string>/)
  assert.match(plist, /<key>signingStyle<\/key>\s*<string>manual<\/string>/)
  assert.match(plist, /<key>signingCertificate<\/key>\s*<string>Apple Distribution<\/string>/)
  assert.match(plist, /<key>ai\.threadway\.wayfare<\/key>\s*<string>Wayfare App Store CI<\/string>/)
  assert.match(plist, /<key>teamID<\/key>\s*<string>R65UN25Q64<\/string>/)
  assert.match(plist, /<key>manageAppVersionAndBuildNumber<\/key>\s*<false\/>/)
})

test('the Ad Hoc export configuration creates a device-installable release', async () => {
  const { createExportOptions } = await import('../scripts/iosReleaseCore.mjs')

  const plist = createExportOptions({
    teamId: 'R65UN25Q64',
    bundleId: 'ai.threadway.wayfare',
    profileName: 'Wayfare iPad Ad Hoc',
    distribution: 'ad-hoc',
  })

  assert.match(plist, /<key>method<\/key>\s*<string>release-testing<\/string>/)
  assert.match(plist, /<key>destination<\/key>\s*<string>export<\/string>/)
  assert.match(plist, /<key>ai\.threadway\.wayfare<\/key>\s*<string>Wayfare iPad Ad Hoc<\/string>/)
  assert.match(plist, /<key>signingStyle<\/key>\s*<string>manual<\/string>/)
  assert.match(plist, /<key>signingCertificate<\/key>\s*<string>Apple Distribution<\/string>/)
})

test('the TestFlight export configuration rejects an invalid Apple team ID', async () => {
  const { createExportOptions } = await import('../scripts/iosReleaseCore.mjs')

  assert.throws(() => createExportOptions({ teamId: 'not-a-team' }), /10-character Apple team ID/i)
})

test('the export configuration CLI emits the plist used by the release workflow', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/iosReleaseCore.mjs', 'R65UN25Q64', 'ai.threadway.wayfare', 'Wayfare App Store CI'],
    { cwd: appRoot, encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.match(result.stdout, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  assert.match(result.stdout, /<string>R65UN25Q64<\/string>/)
  assert.match(result.stdout, /<string>Wayfare App Store CI<\/string>/)
})

test('the manual-signing workflow does not request automatic provisioning updates', async () => {
  const workflow = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, '..', '.github', 'workflows', 'testflight.yml'), 'utf8'),
  )

  assert.doesNotMatch(workflow, /-allowProvisioningUpdates/)
})

/* The Lock Screen card is an extension with a bundle of its own, and every
   TestFlight build after it was added failed in its first minute for want of
   a profile nobody had made in the portal. The workflows make it themselves
   with the App Store Connect key, so no secret holds it and no step demands
   one. */
test('the Lock Screen card is signed with profiles the workflows make themselves', async () => {
  const { readFile } = await import('node:fs/promises')
  const fastfile = await readFile(path.join(appRoot, 'fastlane', 'Fastfile'), 'utf8')
  assert.match(fastfile, /TravelActivity/)
  assert.match(fastfile, /BundleId\.create/, 'the App ID is registered when it is missing')
  assert.match(fastfile, /lane :sign_lock_screen_card/)
  for (const name of ['testflight.yml', 'ios-adhoc.yml']) {
    const workflow = await readFile(path.join(appRoot, '..', '.github', 'workflows', name), 'utf8')
    assert.doesNotMatch(workflow, /secrets\.IOS_ACTIVITY_PROVISIONING_PROFILE\b/, name)
    assert.doesNotMatch(workflow, /needs its own/, `${name} demands a profile made by hand`)
    assert.match(
      workflow,
      /IOS_ACTIVITY_PROVISIONING_PROFILE_NAME \|\| 'Wayfare Activity App Store CI'/,
      `${name} names the profile the Xcode project signs the extension with`,
    )
    assert.match(workflow, /fastlane ios /, `${name} runs the lane that makes the profiles`)
  }
  /* The name the workflows default to is the one the project signs with. */
  const project = await readFile(
    path.join(appRoot, 'ios/App/App.xcodeproj/project.pbxproj'),
    'utf8',
  )
  assert.match(project, /PROVISIONING_PROFILE_SPECIFIER = "Wayfare Activity App Store CI"/)
})

test('the iOS compile workflow installs pnpm before setup-node configures its pnpm cache', async () => {
  const workflow = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, '..', '.github', 'workflows', 'ios-build.yml'), 'utf8'),
  )

  const pnpmSetup = workflow.indexOf('pnpm/action-setup@')
  const nodeSetup = workflow.indexOf('actions/setup-node@')

  assert.notEqual(pnpmSetup, -1, 'The workflow must install pnpm with pnpm/action-setup')
  assert.ok(
    pnpmSetup < nodeSetup,
    'pnpm must be available before setup-node restores its pnpm cache',
  )
})

test('the iOS app declares that it does not use non-exempt encryption', async () => {
  const infoPlist = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, 'ios/App/App/Info.plist'), 'utf8'),
  )

  assert.match(infoPlist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/)
})

test('the app supports iOS 15, and only the Lock Screen card asks for more', async () => {
  /* Live Activities exist from iOS 16.2. The app itself still runs on 15 —
     the plugin says no politely there — so only the extension that draws the
     card may raise its floor, and nothing else in the project may drift. */
  const { readFile } = await import('node:fs/promises')
  const [podfile, project] = await Promise.all([
    readFile(path.join(appRoot, 'ios/App/Podfile'), 'utf8'),
    readFile(path.join(appRoot, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8'),
  ])

  assert.equal(podfile.match(/platform :ios, '(\d+(?:\.\d+)*)'/)?.[1], '15.0')

  const configurations = project.split(/isa = XCBuildConfiguration;/).slice(1)
  const floors = configurations
    .map(block => ({
      extension: block.includes('PRODUCT_BUNDLE_IDENTIFIER = ai.threadway.wayfare.TravelActivity;'),
      floor: block.match(/IPHONEOS_DEPLOYMENT_TARGET = (\d+(?:\.\d+)*);/)?.[1],
    }))
    .filter(row => row.floor)
  assert.ok(floors.length >= 4, 'The Xcode project must declare iOS deployment targets')
  assert.deepEqual(
    [...new Set(floors.filter(row => !row.extension).map(row => row.floor))],
    ['15.0'],
  )
  assert.deepEqual(
    [...new Set(floors.filter(row => row.extension).map(row => row.floor))],
    ['16.2'],
    'the Lock Screen card is drawn by ActivityKit, which begins at iOS 16.2',
  )
})

test('an embedded extension is signed with a profile of its own', async () => {
  /* An app extension is its own bundle with its own identifier, and the
     export refuses an archive that maps the app's profile onto it. */
  const { createExportOptions } = await import('../scripts/iosReleaseCore.mjs')

  const plist = createExportOptions({
    teamId: 'R65UN25Q64',
    bundleId: 'ai.threadway.wayfare',
    profileName: 'Wayfare App Store CI',
    extensions: [
      {
        bundleId: 'ai.threadway.wayfare.TravelActivity',
        profileName: 'Wayfare Activity App Store CI',
      },
    ],
  })

  assert.match(plist, /<key>ai\.threadway\.wayfare<\/key>\s*<string>Wayfare App Store CI<\/string>/)
  assert.match(
    plist,
    /<key>ai\.threadway\.wayfare\.TravelActivity<\/key>\s*<string>Wayfare Activity App Store CI<\/string>/,
  )
})

test('the export configuration CLI takes the extension after the distribution', () => {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/iosReleaseCore.mjs',
      'R65UN25Q64',
      'ai.threadway.wayfare',
      'Wayfare App Store CI',
      'app-store',
      'ai.threadway.wayfare.TravelActivity',
      'Wayfare Activity App Store CI',
    ],
    { cwd: appRoot, encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.match(result.stdout, /<string>Wayfare Activity App Store CI<\/string>/)
})

test('the Lock Screen card is embedded in the app and signed on release', async () => {
  const project = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8'),
  )

  assert.match(project, /productType = "com\.apple\.product-type\.app-extension"/)
  assert.match(project, /Embed Foundation Extensions/, 'built but never embedded is not shipped')
  assert.match(project, /PROVISIONING_PROFILE_SPECIFIER = "Wayfare Activity App Store CI"/)
  /* And the app's own target depends on it, so the scheme CI builds it. */
  assert.match(
    project,
    /isa = PBXTargetDependency;[^}]*target = [0-9A-F]+ \/\* TravelActivity \*\//,
  )
})

test('the app declares Live Activities and registers the plugin that starts them', async () => {
  /* Two silent failure modes. Without the Info.plist key ActivityKit refuses
     every request. Without the storyboard naming the app's own view
     controller, the plugin is never registered and the web side's calls
     vanish into "not implemented" — a card that never appears and no error. */
  const { readFile } = await import('node:fs/promises')
  const [infoPlist, storyboard] = await Promise.all([
    readFile(path.join(appRoot, 'ios/App/App/Info.plist'), 'utf8'),
    readFile(path.join(appRoot, 'ios/App/App/Base.lproj/Main.storyboard'), 'utf8'),
  ])

  assert.match(infoPlist, /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/)
  assert.match(storyboard, /customClass="OffWeGoViewController" customModule="App"/)
})

test('the extension is a WidgetKit extension with the app’s version on it', async () => {
  /* App Store validation rejects an extension whose version differs from the
     app's, so both read the same build settings rather than their own copy. */
  const plist = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, 'ios/App/TravelActivity/Info.plist'), 'utf8'),
  )

  assert.match(plist, /<string>com\.apple\.widgetkit-extension<\/string>/)
  assert.match(
    plist,
    /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/,
  )
  assert.match(
    plist,
    /<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/,
  )
})

test('the native app uses Capacitor HTTP so authentication survives WebView suspension', async () => {
  const config = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, 'capacitor.config.json'), 'utf8'),
  )

  assert.equal(JSON.parse(config).plugins?.CapacitorHttp?.enabled, true)
})

test('the iOS app can be opened explicitly by an email browser handoff', async () => {
  const infoPlist = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, 'ios/App/App/Info.plist'), 'utf8'),
  )

  assert.match(infoPlist, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>wayfare<\/string>/)
})

test('Ad Hoc device input accepts modern and legacy Apple UDIDs without accepting other identifiers', async () => {
  const { parseAdHocDevices } = await import('../scripts/iosAdHocDevices.mjs')

  assert.deepEqual(
    parseAdHocDevices(
      JSON.stringify({
        'Family iPhone': '00008120-001E5DE81AD8201E',
        'Older iPad': 'A'.repeat(40),
      }),
    ),
    {
      'Family iPhone': '00008120-001E5DE81AD8201E',
      'Older iPad': 'A'.repeat(40),
    },
  )
  assert.throws(
    () =>
      parseAdHocDevices(JSON.stringify({ 'Family iPhone': '89049032007108882600151350551843' })),
    /valid Apple UDID/i,
  )
})

test('a saved photograph is reachable in the Files app rather than stranded', async () => {
  /* Downloading writes into the app's Documents directory. Without both of
     these keys that directory is private to the app, so the file is written,
     the person is told it was saved, and there is nowhere on the phone they
     can go to find it — which is worse than refusing to save at all. */
  const infoPlist = await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(appRoot, 'ios/App/App/Info.plist'), 'utf8'),
  )

  assert.match(infoPlist, /<key>UIFileSharingEnabled<\/key>\s*<true\/>/)
  assert.match(infoPlist, /<key>LSSupportsOpeningDocumentsInPlace<\/key>\s*<true\/>/)
})
