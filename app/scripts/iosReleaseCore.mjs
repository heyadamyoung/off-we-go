import { pathToFileURL } from 'node:url'

const xmlEscape = value =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

/* Every bundle in the archive, with the profile that signs it. An app
   extension is its own bundle with its own identifier, and an export that
   maps only the app's profile refuses the archive with a line about the
   extension's identifier having no profile — fifteen minutes after the
   archive began. */
function profileEntries({ bundleId, profileName, extensions }) {
  const entries = [
    [bundleId, profileName],
    ...extensions.map(one => [one?.bundleId, one?.profileName]),
  ]
  for (const [id, name] of entries) {
    if (!/^[A-Za-z0-9.-]+$/.test(id ?? '')) {
      throw new Error('Expected an iOS bundle identifier')
    }
    if (!String(name ?? '').trim()) {
      throw new Error(`Expected a provisioning profile name for ${id}`)
    }
  }
  return entries
}

export function createExportOptions({
  teamId,
  bundleId,
  profileName,
  distribution = 'app-store',
  extensions = [],
}) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? '')) {
    throw new Error('Expected a 10-character Apple team ID')
  }
  if (!['app-store', 'ad-hoc'].includes(distribution)) {
    throw new Error('Expected app-store or ad-hoc distribution')
  }
  const profiles = profileEntries({ bundleId, profileName, extensions })

  const destination = distribution === 'ad-hoc' ? 'export' : 'upload'
  const method = distribution === 'ad-hoc' ? 'release-testing' : 'app-store-connect'

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>${destination}</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>method</key>
  <string>${method}</string>
  <key>provisioningProfiles</key>
  <dict>
${profiles.map(([id, name]) => `    <key>${xmlEscape(id)}</key>\n    <string>${xmlEscape(name)}</string>`).join('\n')}
  </dict>
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>teamID</key>
  <string>${teamId}</string>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
`
}

/* team bundle profile [distribution [extensionBundle extensionProfile]...] —
   the extensions come after the distribution, in pairs, so the older three-
   and four-argument calls keep meaning what they meant. */
export function readExportArguments(argv) {
  const [teamId, bundleId, profileName, distribution = 'app-store', ...rest] = argv
  if (rest.length % 2 !== 0) {
    throw new Error('Expected extension bundle identifiers and profile names in pairs')
  }
  const extensions = []
  for (let at = 0; at < rest.length; at += 2) {
    extensions.push({ bundleId: rest[at], profileName: rest[at + 1] })
  }
  return { teamId, bundleId, profileName, distribution, extensions }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(createExportOptions(readExportArguments(process.argv.slice(2))))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 64
  }
}
