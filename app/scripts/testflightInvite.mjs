/* Adds a tester to a TestFlight group. The App Store Connect key lives in the
   repository's secrets, so this runs there rather than on anyone's laptop —
   and it is a workflow with an input rather than a console visit, because the
   next person to invite should not need to remember where the button is. */
import { buildToken } from './testflightRelease.mjs'

const API = 'https://api.appstoreconnect.apple.com/v1'

/** The group asked for, or — when nothing is named — the one external group. */
export function findGroup(groups, name) {
  const all = (groups || []).map(group => ({
    id: group.id,
    name: group.attributes?.name || '',
    internal: !!group.attributes?.isInternalGroup,
  }))
  if (name) {
    const wanted = name.trim().toLowerCase()
    return all.find(group => group.name.toLowerCase() === wanted) || null
  }
  const external = all.filter(group => !group.internal)
  return external.length === 1 ? external[0] : null
}

/** Re-sending the email to a tester who never opened the first one. */
export function invitationPayload({ testerId, appId }) {
  return {
    data: {
      type: 'betaTesterInvitations',
      relationships: {
        betaTester: { data: { type: 'betaTesters', id: testerId } },
        app: { data: { type: 'apps', id: appId } },
      },
    },
  }
}

/** A name is optional; Apple shows the email when there is none. */
export function testerPayload({ email, firstName, lastName, groupId }) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || ''))
    throw new Error(`Not an email address: ${email}`)
  const attributes = { email }
  if (firstName) attributes.firstName = firstName
  if (lastName) attributes.lastName = lastName
  return {
    data: {
      type: 'betaTesters',
      attributes,
      relationships: { betaGroups: { data: [{ type: 'betaGroups', id: groupId }] } },
    },
  }
}

async function api(path, token, options = {}) {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (response.status === 204) return null
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body?.errors?.map(error => error.detail || error.title).join('; ')
    const failure = new Error(
      `${options.method || 'GET'} ${path} → ${response.status}${detail ? `: ${detail}` : ''}`,
    )
    failure.status = response.status
    throw failure
  }
  return body
}

async function main() {
  const token = buildToken({
    keyId: process.env.APP_STORE_CONNECT_KEY_ID,
    issuerId: process.env.APP_STORE_CONNECT_ISSUER_ID,
    privateKey: process.env.APP_STORE_CONNECT_API_KEY_P8,
  })
  const email = (process.env.TESTER_EMAIL || '').trim()
  const [firstName, ...rest] = (process.env.TESTER_NAME || '').trim().split(/\s+/).filter(Boolean)
  const bundleId = process.env.IOS_BUNDLE_ID

  const apps = await api(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`, token)
  const app = apps?.data?.[0]
  if (!app) throw new Error(`No app in App Store Connect for ${bundleId}`)

  const groups = await api(`/apps/${app.id}/betaGroups?limit=200`, token)
  const group = findGroup(groups?.data, process.env.TESTER_GROUP)
  if (!group) {
    throw new Error(
      `No group to add them to. Groups on this app: ${
        (groups?.data || []).map(item => item.attributes?.name).join(', ') || 'none'
      }`,
    )
  }

  try {
    await api('/betaTesters', token, {
      method: 'POST',
      body: JSON.stringify(
        testerPayload({
          email,
          firstName,
          lastName: rest.join(' ') || undefined,
          groupId: group.id,
        }),
      ),
    })
    console.log(`${email} invited to ${group.name}`)
    return
  } catch (error) {
    if (error.status !== 409) throw error
  }

  // Already a tester on this app: add them to the group rather than again.
  const existing = await api(
    `/betaTesters?filter[email]=${encodeURIComponent(email)}&limit=1`,
    token,
  )
  const tester = existing?.data?.[0]
  if (!tester) throw new Error(`${email} is already a tester but could not be found to add`)

  try {
    await api(`/betaGroups/${group.id}/relationships/betaTesters`, token, {
      method: 'POST',
      body: JSON.stringify({ data: [{ type: 'betaTesters', id: tester.id }] }),
    })
    console.log(`${email} was already a tester; added to ${group.name}`)
    return
  } catch (error) {
    if (error.status !== 409) throw error
  }

  /* Already in the group too, so what they need is the email again: a tester
     whose state is still "invited" has an unopened invitation sitting in
     their inbox, and this is the one lever Apple offers to send another. */
  try {
    await api('/betaTesterInvitations', token, {
      method: 'POST',
      body: JSON.stringify(invitationPayload({ testerId: tester.id, appId: app.id })),
    })
    console.log(`${email} was already in ${group.name}; the invitation email was sent again`)
    return
  } catch (error) {
    if (error.status !== 409) throw error
  }

  /* Apple sometimes refuses the resend ("Tester has no installable build")
     even while the group demonstrably holds approved builds. The escape
     hatch is to remove the tester and add them afresh, which mints a new
     invitation — safe ONLY for someone who never accepted, because there is
     nothing to revoke. An installed tester is never deleted from here. */
  if (tester.attributes?.state && tester.attributes.state !== 'INVITED') {
    throw new Error(
      `${email} is ${tester.attributes.state.toLowerCase()}, not stuck on an invitation —` +
        ' refusing to delete and re-add them.',
    )
  }
  await api(`/betaTesters/${tester.id}`, token, { method: 'DELETE' })
  await api('/betaTesters', token, {
    method: 'POST',
    body: JSON.stringify(
      testerPayload({ email, firstName, lastName: rest.join(' ') || undefined, groupId: group.id }),
    ),
  })
  console.log(`${email} was re-created from scratch in ${group.name}; a fresh invitation is out`)
}

if (process.argv[1]?.endsWith('testflightInvite.mjs')) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
