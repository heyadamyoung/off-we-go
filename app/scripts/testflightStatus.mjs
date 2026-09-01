/* What App Store Connect thinks of our recent builds. "Upload succeeded" says
   nothing about whether anyone can install the thing: a build has to finish
   processing, and an external group cannot touch it until Apple's beta review
   passes. Both of those live on Apple's side, so this asks. */
import { buildToken } from './testflightRelease.mjs';

const API = 'https://api.appstoreconnect.apple.com/v1';

/* The same state names appear in the internal and external columns and do not
   mean the same thing in both: internal testers never face review, so
   IN_BETA_TESTING there means they have it, while externally it means Apple
   has passed it. Saying "out with external testers" in the internal column,
   as this did at first, tells you the opposite of the truth. */
const READABLE = {
  PROCESSING: 'processing',
  READY_FOR_BETA_SUBMISSION: 'not submitted for beta review',
  WAITING_FOR_BETA_REVIEW: 'waiting for Apple to start beta review',
  IN_BETA_REVIEW: 'in beta review at Apple',
  BETA_REJECTED: 'rejected by Apple',
  EXPIRED: 'expired',
  MISSING_EXPORT_COMPLIANCE: 'blocked: export compliance unanswered',
};

const BY_AUDIENCE = {
  internal: { READY_FOR_BETA_TESTING: 'installable', IN_BETA_TESTING: 'installable' },
  external: {
    READY_FOR_BETA_TESTING: 'approved — they can install it',
    IN_BETA_TESTING: 'approved — they can install it',
  },
};

export const readable = (state, audience = 'external') =>
  BY_AUDIENCE[audience]?.[state] || READABLE[state] || state || 'unknown';

/** Who is in a group, so "did the invitation land?" has an answer. */
export function describeGroup(group, testers) {
  const people = (testers || [])
    .map(tester => tester.attributes?.email || tester.id)
    .sort();
  const kind = group?.attributes?.isInternalGroup ? 'internal' : 'external';
  return `${group?.attributes?.name} (${kind}): ${people.length
    ? people.join(', ') : 'nobody yet'}`;
}

/** One line per build: what it is, and who can install it. */
export function describeBuild({ version, release, uploaded, processingState, internalState, externalState, groups }) {
  const when = uploaded ? new Date(uploaded).toISOString().replace('T', ' ').slice(0, 16) : 'unknown time';
  const where = groups?.length ? groups.join(', ') : 'no external group';
  return `${release || '?'} build ${version} (${when})  processing: ${readable(processingState, 'internal')}`
    + `  internal: ${readable(internalState, 'internal')}`
    + `  external: ${readable(externalState, 'external')}  groups: ${where}`;
}

async function api(path, token) {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.errors?.map(error => error.detail || error.title).join('; ');
    throw new Error(`GET ${path} → ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return body;
}

async function main() {
  const token = buildToken({
    keyId: process.env.APP_STORE_CONNECT_KEY_ID,
    issuerId: process.env.APP_STORE_CONNECT_ISSUER_ID,
    privateKey: process.env.APP_STORE_CONNECT_API_KEY_P8,
  });
  const bundleId = process.env.IOS_BUNDLE_ID;

  const apps = await api(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`, token);
  const app = apps?.data?.[0];
  if (!app) throw new Error(`No app in App Store Connect for ${bundleId}`);

  const groups = await api(`/apps/${app.id}/betaGroups?limit=200`, token);
  for (const group of groups?.data || []) {
    const testers = await api(`/betaGroups/${group.id}/betaTesters?limit=200`, token).catch(() => null);
    console.log(describeGroup(group, testers?.data));
  }
  console.log('');

  const builds = await api(`/builds?filter[app]=${app.id}&limit=14&sort=-uploadedDate`, token);
  for (const build of builds?.data || []) {
    const [detail, groups, release] = await Promise.all([
      api(`/builds/${build.id}/buildBetaDetail`, token).catch(() => null),
      api(`/builds/${build.id}/betaGroups`, token).catch(() => null),
      api(`/builds/${build.id}/preReleaseVersion`, token).catch(() => null),
    ]);
    console.log(describeBuild({
      version: build.attributes?.version,
      release: release?.data?.attributes?.version,
      uploaded: build.attributes?.uploadedDate,
      processingState: build.attributes?.processingState,
      internalState: detail?.data?.attributes?.internalBuildState,
      externalState: detail?.data?.attributes?.externalBuildState,
      groups: (groups?.data || []).map(group => group.attributes?.name),
    }));
  }
}

if (process.argv[1] && process.argv[1].endsWith('testflightStatus.mjs')) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
