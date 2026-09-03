/* Expire every TestFlight build that nothing should install any more.

   Keeps the newest VALID build — and anything newer still processing — and
   expires everything older, across every version train. Expiry stops new
   installs of a build and drops it from testers' lists; phones already
   running it keep running. Once a train's builds are all expired, the train
   itself stops cluttering the TestFlight app, which is how a stray version
   finally disappears from the family's phones.

   Run by hand through the dispatch workflow, never by the release script:
   the previous build staying installable is the instant-rollback path when
   a bad build ships, and a robot should not be the one to burn it. */
import { buildToken } from './testflightRelease.mjs'
import { utc } from './testflightStatus.mjs'

const API = 'https://api.appstoreconnect.apple.com/v1'

/* Which builds go. The list arrives newest first; everything above and
   including the newest VALID build survives (a build mid-processing must not
   strand testers by getting its predecessor expired under it), everything
   below it goes. With no VALID build at all, nothing is touched. */
export function expirable(builds) {
  const alive = (builds || []).filter(b => !b.attributes?.expired)
  const newestValid = alive.findIndex(b => b.attributes?.processingState === 'VALID')
  if (newestValid < 0) return { kept: alive, expire: [] }
  return { kept: alive.slice(0, newestValid + 1), expire: alive.slice(newestValid + 1) }
}

async function api(path, token, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body?.errors?.map(error => error.detail || error.title).join('; ')
    throw new Error(
      `${init.method || 'GET'} ${path} → ${response.status}${detail ? `: ${detail}` : ''}`,
    )
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

  const builds = await api(`/builds?filter[app]=${app.id}&limit=200&sort=-uploadedDate`, token)
  const { kept, expire } = expirable(builds?.data)

  for (const build of kept) {
    console.log(
      `keeping build ${build.attributes?.version} (${utc(build.attributes?.uploadedDate)},` +
        ` ${build.attributes?.processingState})`,
    )
  }
  if (!expire.length) {
    console.log('Nothing to expire.')
    return
  }
  for (const build of expire) {
    await api(`/builds/${build.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        data: { type: 'builds', id: build.id, attributes: { expired: true } },
      }),
    })
    console.log(
      `expired build ${build.attributes?.version} (${utc(build.attributes?.uploadedDate)})`,
    )
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  console.log(`Done: ${expire.length} builds expired, ${kept.length} kept.`)
}

if (process.argv[1]?.endsWith('testflightExpire.mjs')) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
