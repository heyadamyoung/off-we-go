/* What App Store Connect thinks of our recent builds. "Upload succeeded" says
   nothing about whether anyone can install the thing: a build has to finish
   processing, and an external group cannot touch it until Apple's beta review
   passes. Both of those live on Apple's side, so this asks. */
import { buildToken } from './testflightRelease.mjs';

const API = 'https://api.appstoreconnect.apple.com/v1';

const READABLE = {
  PROCESSING: 'processing',
  READY_FOR_BETA_SUBMISSION: 'not submitted for beta review',
  WAITING_FOR_BETA_REVIEW: 'waiting for Apple to start beta review',
  IN_BETA_REVIEW: 'in beta review at Apple',
  READY_FOR_BETA_TESTING: 'approved — external testers can install it',
  IN_BETA_TESTING: 'out with external testers',
  BETA_REJECTED: 'rejected by Apple',
  EXPIRED: 'expired',
  MISSING_EXPORT_COMPLIANCE: 'blocked: export compliance unanswered',
};

export const readable = state => READABLE[state] || state || 'unknown';

/** One line per build: what it is, and who can install it. */
export function describeBuild({ version, uploaded, processingState, internalState, externalState, groups }) {
  const when = uploaded ? new Date(uploaded).toISOString().replace('T', ' ').slice(0, 16) : 'unknown time';
  const where = groups?.length ? groups.join(', ') : 'no external group';
  return `build ${version} (${when})  processing: ${readable(processingState)}`
    + `  internal: ${readable(internalState)}  external: ${readable(externalState)}  groups: ${where}`;
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

  const builds = await api(`/builds?filter[app]=${app.id}&limit=8&sort=-uploadedDate`, token);
  for (const build of builds?.data || []) {
    const [detail, groups] = await Promise.all([
      api(`/builds/${build.id}/buildBetaDetail`, token).catch(() => null),
      api(`/builds/${build.id}/betaGroups`, token).catch(() => null),
    ]);
    console.log(describeBuild({
      version: build.attributes?.version,
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
