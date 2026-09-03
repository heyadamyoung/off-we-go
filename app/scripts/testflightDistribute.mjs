/* Push the newest approved build the last inch to external testers.

   The trap this exists for: the release script assigns a build to the
   external group BEFORE beta review (a build cannot ride to testers
   unreviewed), review approves it minutes later — and Apple leaves it at
   externalBuildState BETA_APPROVED: passed, linked, and serving nobody.
   IN_BETA_TESTING is the state that puts it on phones, and a pre-approval
   link does not flip there on its own. Re-linking an already-approved build
   does — the same thing the App Store Connect UI does when a human adds an
   approved build to a group.

   It prints the raw evidence before and after, because the summary states
   lied to us once ("approved" read as "installable" when it meant neither). */
import { buildToken } from './testflightRelease.mjs'

const API = 'https://api.appstoreconnect.apple.com/v1'

async function api(path, token, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
  if (response.status === 204) return null
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body?.errors?.map(error => error.detail || error.title).join('; ')
    throw new Error(
      `${init.method || 'GET'} ${path} → ${response.status}${detail ? `: ${detail}` : ''}`,
    )
  }
  return body
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function describe(build, token) {
  const a = build.attributes || {}
  const detail = await api(`/builds/${build.id}/buildBetaDetail`, token).catch(() => null)
  const review = await api(`/builds/${build.id}/betaAppReviewSubmission`, token).catch(() => null)
  console.log(
    `build ${a.version}: processing=${a.processingState} expired=${a.expired}` +
      ` audience=${a.buildAudienceType} encryption=${a.usesNonExemptEncryption}` +
      ` internal=${detail?.data?.attributes?.internalBuildState}` +
      ` external=${detail?.data?.attributes?.externalBuildState}` +
      ` review=${review?.data?.attributes?.betaReviewState}`,
  )
  return detail?.data?.attributes?.externalBuildState
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

  const builds = await api(`/builds?filter[app]=${app.id}&limit=10&sort=-uploadedDate`, token)
  const build = (builds?.data || []).find(
    b => !b.attributes?.expired && b.attributes?.processingState === 'VALID',
  )
  if (!build) throw new Error('No unexpired valid build to distribute')

  const groups = await api(`/apps/${app.id}/betaGroups?limit=200`, token)
  const external = (groups?.data || []).filter(g => !g.attributes?.isInternalGroup)
  for (const group of external) {
    console.log(
      `group ${group.attributes?.name}: publicLink=${group.attributes?.publicLinkEnabled}`,
    )
  }

  const before = await describe(build, token)
  if (before === 'IN_BETA_TESTING') {
    console.log('Already serving to external testers; nothing to nudge.')
    return
  }

  for (const group of external) {
    const link = { data: [{ type: 'builds', id: build.id }] }
    await api(`/betaGroups/${group.id}/relationships/builds`, token, {
      method: 'DELETE',
      body: JSON.stringify(link),
    }).catch(error => console.log(`unlink from ${group.attributes?.name}: ${error.message}`))
    await pause(2000)
    await api(`/betaGroups/${group.id}/relationships/builds`, token, {
      method: 'POST',
      body: JSON.stringify(link),
    })
    console.log(`build ${build.attributes?.version} re-linked to ${group.attributes?.name}`)
  }

  await pause(10_000)
  const after = await describe(build, token)
  console.log(
    after === 'IN_BETA_TESTING'
      ? 'Distributed: external testers can install it now.'
      : `Still ${after} — the nudge was not enough; the raw states above are the trail.`,
  )
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
