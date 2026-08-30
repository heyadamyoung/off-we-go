import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function createArchiveArguments({ archivePath, teamId, buildNumber, domain }) {
  if (!String(archivePath ?? '').trim()) {
    throw new Error('Expected an archive path');
  }
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? '')) {
    throw new Error('Expected a 10-character Apple team ID');
  }
  if (!/^[1-9][0-9]*$/.test(String(buildNumber ?? ''))) {
    throw new Error('Expected a positive iOS build number');
  }
  if (!/^[A-Za-z0-9.-]+$/.test(domain ?? '')) {
    throw new Error('Expected a deployment domain');
  }

  return [
    '-workspace', 'ios/App/App.xcworkspace',
    '-scheme', 'App',
    '-configuration', 'Release',
    '-destination', 'generic/platform=iOS',
    '-archivePath', archivePath,
    `DEVELOPMENT_TEAM=${teamId}`,
    `CURRENT_PROJECT_VERSION=${buildNumber}`,
    `WAYFARE_DOMAIN=${domain}`,
    'clean', 'archive',
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = createArchiveArguments({
      archivePath: process.argv[2],
      teamId: process.argv[3],
      buildNumber: process.argv[4],
      domain: process.argv[5],
    });
    const result = spawnSync('xcodebuild', args, { stdio: 'inherit' });

    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 64;
  }
}
