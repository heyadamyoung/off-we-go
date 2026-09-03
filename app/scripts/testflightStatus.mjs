/* What App Store Connect thinks of our recent builds. "Upload succeeded" says
   nothing about whether anyone can install the thing: a build has to finish
   processing, and an external group cannot touch it until Apple's beta review
   passes. Both of those live on Apple's side, so this asks. */
import { buildToken } from './testflightRelease.mjs'

const API = 'https://api.appstoreconnect.apple.com/v1'

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
}

const BY_AUDIENCE = {
  internal: { READY_FOR_BETA_TESTING: 'installable', IN_BETA_TESTING: 'installable' },
  external: {
    READY_FOR_BETA_TESTING: 'approved — they can install it',
    IN_BETA_TESTING: 'approved — they can install it',
  },
}

/* Apple returns these with their own offsets; two timestamps side by side in
   different zones read as a seven-hour gap that is not there. */
export const utc = value => `${new Date(value).toISOString().replace('T', ' ').slice(0, 16)}Z`

export const readable = (state, audience = 'external') =>
  BY_AUDIENCE[audience]?.[state] || READABLE[state] || state || 'unknown'

/** Who is in a group, so "did the invitation land?" has an answer. */
export function describeGroup(group, testers) {
  const people = (testers || []).map(tester => tester.attributes?.email || tester.id).sort()
  const kind = group?.attributes?.isInternalGroup ? 'internal' : 'external'
  return `${group?.attributes?.name} (${kind}): ${people.length ? people.join(', ') : 'nobody yet'}`
}

/** One line per version train: the fossil record behind "why two versions?". */
export function describeTrain({ version, platform, build, uploaded, expired, unknown }) {
  if (unknown) return `version ${version} (${platform}) — builds unknown, Apple refused the ask`
  if (!build) return `version ${version} (${platform}) — no builds`
  return (
    `version ${version} (${platform}) — latest build ${build}, uploaded ${utc(uploaded)}` +
    (expired ? ', expired' : '')
  )
}

/** One line per build: what it is, and who can install it. */
export function describeBuild({
  version,
  release,
  uploaded,
  processingState,
  internalState,
  externalState,
  groups,
  submitted,
}) {
  const when = uploaded ? utc(uploaded) : 'unknown time'
  const where = groups?.length ? groups.join(', ') : 'no external group'
  return (
    `${release || '?'} build ${version} (${when})  processing: ${readable(processingState, 'internal')}` +
    `  internal: ${readable(internalState, 'internal')}` +
    `  external: ${readable(externalState, 'external')}  groups: ${where}` +
    `  review: ${submitted || 'never submitted — approved with its train'}`
  )
}

async function api(path, token) {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body?.errors?.map(error => error.detail || error.title).join('; ')
    throw new Error(`GET ${path} → ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return body
}

async function main() {
  const token = buildToken({
    keyId: process.env.APP_STORE_CONNECT_KEY_ID,
    issuerId: process.env.APP_STORE_CONNECT_ISSUER_ID,
    privateKey: process.env.APP_STORE_CONNECT_API_KEY_P8,
  })
  const bundleId = process.env.IOS_BUNDLE_ID

  const apps = await api(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`, token)
  const app = apps?.data?.[0]
  if (!app) throw new Error(`No app in App Store Connect for ${bundleId}`)

  const groups = await api(`/apps/${app.id}/betaGroups?limit=200`, token)
  for (const group of groups?.data || []) {
    const testers = await api(`/betaGroups/${group.id}/betaTesters?limit=200`, token).catch(
      () => null,
    )
    console.log(describeGroup(group, testers?.data))
  }
  console.log('')

  /* Every version train the app has ever put on TestFlight, not just the
     trains the recent builds happen to ride: builds expire after ninety days
     but their train stays listed in the TestFlight app, so a stray version
     from before the pin-at-1.0 rule keeps showing until its builds die. */
  const trains = await api(`/apps/${app.id}/preReleaseVersions?limit=50`, token)
  for (const train of trains?.data || []) {
    /* Not the train's own builds relationship: that endpoint ignores sort
       and refuses when asked, which first shipped here as every train
       claiming "no builds". The builds collection filtered by train obeys. */
    const version = train.attributes?.version
    const latest = await api(
      `/builds?filter[app]=${app.id}&filter[preReleaseVersion.version]=` +
        `${encodeURIComponent(version)}&sort=-uploadedDate&limit=1`,
      token,
    ).catch(() => null)
    const newest = latest?.data?.[0]
    console.log(
      describeTrain({
        version,
        platform: train.attributes?.platform,
        build: newest?.attributes?.version,
        uploaded: newest?.attributes?.uploadedDate,
        expired: newest?.attributes?.expired,
        unknown: !latest,
      }),
    )
  }
  console.log('')

  const builds = await api(`/builds?filter[app]=${app.id}&limit=14&sort=-uploadedDate`, token)
  for (const build of builds?.data || []) {
    const [detail, groups, release, review] = await Promise.all([
      api(`/builds/${build.id}/buildBetaDetail`, token).catch(() => null),
      api(`/builds/${build.id}/betaGroups`, token).catch(() => null),
      api(`/builds/${build.id}/preReleaseVersion`, token).catch(() => null),
      api(`/builds/${build.id}/betaAppReviewSubmission`, token).catch(() => null),
    ])
    console.log(
      describeBuild({
        version: build.attributes?.version,
        release: release?.data?.attributes?.version,
        uploaded: build.attributes?.uploadedDate,
        processingState: build.attributes?.processingState,
        internalState: detail?.data?.attributes?.internalBuildState,
        externalState: detail?.data?.attributes?.externalBuildState,
        groups: (groups?.data || []).map(group => group.attributes?.name),
        submitted: review?.data?.attributes?.betaReviewState
          ? `${review.data.attributes.betaReviewState}${
              review.data.attributes.submittedDate
                ? ` since ${utc(review.data.attributes.submittedDate)}`
                : ''
            }`
          : null,
      }),
    )
  }
}

if (process.argv[1]?.endsWith('testflightStatus.mjs')) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
