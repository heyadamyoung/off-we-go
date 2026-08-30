import { pathToFileURL } from 'node:url';

const xmlEscape = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export function createExportOptions({ teamId, bundleId, profileName }) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? '')) {
    throw new Error('Expected a 10-character Apple team ID');
  }
  if (!/^[A-Za-z0-9.-]+$/.test(bundleId ?? '')) {
    throw new Error('Expected an iOS bundle identifier');
  }
  if (!String(profileName ?? '').trim()) {
    throw new Error('Expected an App Store provisioning profile name');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>upload</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>method</key>
  <string>app-store-connect</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${xmlEscape(bundleId)}</key>
    <string>${xmlEscape(profileName)}</string>
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
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(createExportOptions({
      teamId: process.argv[2], bundleId: process.argv[3], profileName: process.argv[4],
    }));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 64;
  }
}
