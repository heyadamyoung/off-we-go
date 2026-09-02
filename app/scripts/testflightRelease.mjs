/* Uploading a build is not releasing it. Until something attaches it to a
   tester group it sits in App Store Connect and every tester keeps whatever
   they last installed — which is how a beta ends up fifteen commits behind
   while every upload reports success. This does the attaching, and says what
   it found, so the run itself answers "why can nobody see the new one?". */
import { sign as signBytes } from 'node:crypto';

const API = 'https://api.appstoreconnect.apple.com/v1';

const base64url = input => Buffer.from(input)
  .toString('base64')
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replaceAll('=', '');

/** A token App Store Connect will accept, good for twenty minutes. */
export function buildToken({ keyId, issuerId, privateKey, now = Date.now() }) {
  if (!keyId || !issuerId || !privateKey) throw new Error('Expected an App Store Connect API key');
  const issued = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: issuerId, iat: issued, exp: issued + 20 * 60, aud: 'appstoreconnect-v1',
  }));
  const signature = signBytes('sha256', Buffer.from(`${header}.${payload}`),
    { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${base64url(signature)}`;
}

/* Which groups to hand the build to. Internal groups are not among them: Apple
   gives those every processed build on its own, and refuses the request with
   "Cannot add internal group to a build" if you ask. External groups are the
   ones that need adding — and, the first time a version goes out, reviewing. */
export function chooseGroups(groups, wanted = []) {
  const named = wanted.map(name => name.trim().toLowerCase()).filter(Boolean);
  const all = (groups || []).map(group => ({
    id: group.id,
    name: group.attributes?.name || '',
    internal: !!group.attributes?.isInternalGroup,
  }));
  const external = all.filter(group => !group.internal);
  if (!named.length) return external;
  return external.filter(group => named.includes(group.name.toLowerCase()));
}

/** The build this run produced, if App Store Connect has finished with it. */
export function findBuild(builds, buildNumber) {
  return (builds || []).find(build => String(build.attributes?.version) === String(buildNumber)) || null;
}

export const isReady = build => build?.attributes?.processingState === 'VALID';

/* Interrupting someone is opt-in. Anything but a plain "true" means the build
   goes out quietly and waits to be noticed. */
export const shouldNotify = value => String(value ?? '').trim().toLowerCase() === 'true';

async function api(path, token, options = {}) {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.errors?.map(error => error.detail || error.title).join('; ');
    throw new Error(`${options.method || 'GET'} ${path} → ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return body;
}

const wait = ms => new Promise(resolve => { setTimeout(resolve, ms); });

async function main() {
  const token = buildToken({
    keyId: process.env.APP_STORE_CONNECT_KEY_ID,
    issuerId: process.env.APP_STORE_CONNECT_ISSUER_ID,
    privateKey: process.env.APP_STORE_CONNECT_API_KEY_P8,
  });
  const bundleId = process.env.IOS_BUNDLE_ID;
  const buildNumber = process.env.GITHUB_RUN_NUMBER;
  const wanted = (process.env.TESTFLIGHT_GROUPS || '').split(',').filter(Boolean);

  const apps = await api(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`, token);
  const app = apps?.data?.[0];
  if (!app) throw new Error(`No app in App Store Connect for ${bundleId}`);

  // Processing takes minutes, and a build cannot join a group until it is done.
  let build = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const builds = await api(`/builds?filter[app]=${app.id}&limit=200`, token);
    build = findBuild(builds?.data, buildNumber);
    if (isReady(build)) break;
    const state = build?.attributes?.processingState || 'not visible yet';
    console.log(`build ${buildNumber}: ${state}`);
    await wait(30_000);
  }
  if (!isReady(build)) {
    throw new Error(`Build ${buildNumber} did not finish processing; it cannot be distributed yet`);
  }

  /* Every push that changes the app ships a build, and Apple tells the testers
     about each one. Ten fixes in an evening is ten notifications on the phones
     of people who did not ask to be paged — so the build goes out quietly and
     TestFlight shows it as an update when they next open it. Set
     TESTFLIGHT_NOTIFY=true when a build is worth interrupting someone for. */
  const detail = await api(`/builds/${build.id}/buildBetaDetail`, token).catch(() => null);
  const notify = shouldNotify(process.env.TESTFLIGHT_NOTIFY);
  if (detail?.data?.id && detail.data.attributes?.autoNotifyEnabled !== notify) {
    await api(`/buildBetaDetails/${detail.data.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        data: {
          type: 'buildBetaDetails',
          id: detail.data.id,
          attributes: { autoNotifyEnabled: notify },
        },
      }),
    }).catch(error => console.log(`could not set notifications: ${error.message}`));
  }
  console.log(`testers ${notify ? 'will be notified' : 'will not be notified — it appears as an update'}`);

  const groups = await api(`/apps/${app.id}/betaGroups?limit=200`, token);
  const all = groups?.data || [];
  console.log(`groups on this app: ${all
    .map(group => `${group.attributes?.name}${group.attributes?.isInternalGroup ? ' (internal)' : ' (external)'}`)
    .join(', ') || 'none'}`);
  console.log(`internal testers have build ${buildNumber} already — Apple gives them every build`);

  const chosen = chooseGroups(all, wanted);
  if (!chosen.length) {
    console.log('::warning::No external group to release to; only internal testers can install this.');
    return;
  }

  for (const group of chosen) {
    await api(`/betaGroups/${group.id}/relationships/builds`, token, {
      method: 'POST',
      body: JSON.stringify({ data: [{ type: 'builds', id: build.id }] }),
    });
    console.log(`build ${buildNumber} → ${group.name}`);
  }

  /* An external group cannot install a build Apple has not passed. The first
     build of a version waits for review; later ones usually go straight
     through, and asking twice is not an error worth failing a release for. */
  try {
    await api('/betaAppReviewSubmissions', token, {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: { build: { data: { type: 'builds', id: build.id } } },
        },
      }),
    });
    console.log(`build ${buildNumber} submitted for beta review`);
  } catch (error) {
    console.log(`beta review not submitted: ${error.message}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('testflightRelease.mjs')) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
