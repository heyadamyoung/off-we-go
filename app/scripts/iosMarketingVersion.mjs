/* The version TestFlight files a build under. It lives in the Xcode project and
   is read from there rather than repeated here, so a version bump is one edit
   in the place Xcode already writes to. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readMarketingVersion(pbxproj) {
  const found = /MARKETING_VERSION = ([0-9]+(?:\.[0-9]+)*);/.exec(pbxproj ?? '');
  if (!found) throw new Error('No MARKETING_VERSION in the Xcode project');
  return found[1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const project = path.join(appRoot, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
    process.stdout.write(readMarketingVersion(await readFile(project, 'utf8')));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 65;
  }
}
