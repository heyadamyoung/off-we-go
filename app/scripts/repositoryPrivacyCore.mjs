import { spawnSync } from 'node:child_process';

const join = (...parts) => parts.join('');

const forbiddenPaths = [
  join('app/scripts/', 'real-itinerary.mjs'),
  join('app/scripts/', 'demo-content.mjs'),
  join('feat', '1.png'),
  join('feat', '2.png'),
  join('app/.original-', 'backup/'),
  join('app/.raster-', 'backup/'),
];

const privateText = [
  join('adam.young1986', '@outlook.com'),
  join('susan', '@faside-estate.com'),
  join('mail', '@westlea-ullapool.co.uk'),
  join('The ', 'Youngs'),
  join('Grandma ', 'Jean'),
  join('Uncle ', 'Rob'),
  join('Amsterdam ', '& Scotland'),
  join('Trip.com ', 'booking'),
  join('Tivoli', 'Vredenburg'),
  join('Faside ', 'Estate'),
  join('Westlea ', 'House'),
  join('Anne', ' & Adam'),
  join('Adam', "'s iPhone"),
  join('Anne', "'s iPhone"),
  join("by: '", "Anne'"),
  join("name: '", "Adam'"),
  join("by:'", "Adam'"),
  join("by: '", "Adam'"),
  join("name:'", "Adam'"),
];

const revealingSubjects = [
  join('The Tower ', 'is paid'),
  join('The Toren ', 'confirmed'),
  join('Fly home ', 'from Toronto'),
  join('domestic legs ', 'either side of the Atlantic'),
  join('real itinerary ', 'in the trip'),
  join('Kishi Bashi ', 'at concert venue'),
];

function git(cwd, args, { allowNoMatch = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status === 0 || (allowNoMatch && result.status === 1)) return result.stdout;
  throw new Error(result.stderr || result.error?.message || `git ${args.join(' ')} failed`);
}
export function scanRepository(cwd) {
  const findings = [];
  const objects = git(cwd, ['rev-list', '--objects', '--all']);
  for (const forbidden of forbiddenPaths) {
    if (objects.split(/\r?\n/).some(line => line.slice(41).startsWith(forbidden))) {
      findings.push({ kind: 'forbidden-path', value: forbidden });
    }
  }

  const commits = git(cwd, ['rev-list', '--all']).trim().split(/\r?\n/).filter(Boolean);
  for (const commit of commits) {
    for (const marker of privateText) {
      const output = git(cwd, [
        'grep', '-n', '-I', '-F', marker, commit, '--', '.',
        ':!app/scripts/repositoryPrivacyCore.mjs',
        ':!app/tests/repository-privacy.test.js',
      ], { allowNoMatch: true });
      if (output) findings.push({ kind: 'private-text', value: marker, commit });
    }
  }

  const subjects = git(cwd, ['log', '--all', '--format=%H%x09%s']);
  for (const line of subjects.split(/\r?\n/)) {
    const [commit, subject = ''] = line.split('\t', 2);
    const marker = revealingSubjects.find(value => subject.includes(value));
    if (marker) findings.push({ kind: 'revealing-subject', value: marker, commit });
  }

  return findings;
}
