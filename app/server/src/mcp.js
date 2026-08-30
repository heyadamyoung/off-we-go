import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { z } from 'zod'

const SCOPES = ['trips:read', 'trips:write']
const ACCESS_TOKEN_TTL_MS = 60 * 60_000
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000
const AUTH_CODE_TTL_MS = 5 * 60_000
const REQUEST_TOKEN_TTL_MS = 10 * 60_000

const newToken = prefix => `${prefix}${randomBytes(32).toString('base64url')}`
const tokenHash = value => createHash('sha256').update(value).digest('hex')
const normalizeRoot = value => String(value).replace(/\/$/, '')
const oauthError = (reply, error, description, status = 400) => reply.code(status)
  .header('cache-control', 'no-store').send({ error, error_description: description })

function safeEqual(left, right) {
  const a = Buffer.from(left), b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function signAuthorizationRequest(value, secret) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function readAuthorizationRequest(value, secret, now) {
  if (typeof value !== 'string') return null
  const [payload, signature, extra] = value.split('.')
  if (!payload || !signature || extra) return null
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  if (!safeEqual(signature, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!Number.isFinite(parsed.issuedAt) || parsed.issuedAt > now.getTime() + 60_000 ||
      now.getTime() - parsed.issuedAt > REQUEST_TOKEN_TTL_MS) return null
    return parsed
  } catch { return null }
}

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;')

function validRedirect(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    if (url.hash || url.username || url.password) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch { return false }
}

function redirectMatches(registeredUri, requestedUri) {
  if (registeredUri === requestedUri) return true
  try {
    const registered = new URL(registeredUri), requested = new URL(requestedUri)
    const loopbackHosts = ['localhost', '127.0.0.1', '[::1]']
    return registered.protocol === 'http:' && requested.protocol === 'http:' &&
      registered.hostname === requested.hostname && loopbackHosts.includes(registered.hostname) &&
      registered.pathname === requested.pathname && registered.search === requested.search &&
      registered.hash === requested.hash && registered.username === requested.username &&
      registered.password === requested.password
  } catch { return false }
}

function safeMetadataUrl(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url.href : null
  } catch { return null }
}

function requestedScopes(value) {
  const values = String(value || 'trips:read').split(/\s+/).filter(Boolean)
  if (!values.length || values.some(scope => !SCOPES.includes(scope))) return null
  return SCOPES.filter(scope => values.includes(scope))
}

const authRedirect = (request, values) => {
  const redirect = new URL(request.redirectUri)
  for (const [key, value] of Object.entries(values)) if (value != null) redirect.searchParams.set(key, value)
  return redirect.href
}

function consentPage({ client, requestToken, scopes, root }) {
  const nonce = randomBytes(18).toString('base64url')
  const name = escapeHtml(client.clientName)
  const clientUri = safeMetadataUrl(client.clientUri)
  const writeRequested = scopes.includes('trips:write')
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect ${name} to Wayfare</title>
  <style nonce="${nonce}">
    :root{color-scheme:dark;--ink:#f7f3ea;--muted:#a9a89f;--line:rgba(255,255,255,.11);--card:rgba(24,25,24,.88);--green:#c8f46b;--orange:#ff9d66}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 18% 12%,rgba(200,244,107,.14),transparent 34%),radial-gradient(circle at 88% 80%,rgba(255,157,102,.12),transparent 32%),#0e100f;color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;display:grid;place-items:center;padding:28px}
    main{width:min(100%,560px)}.brand{display:flex;justify-content:center;align-items:center;gap:10px;margin-bottom:22px;font-weight:760;letter-spacing:.02em}.mark{width:32px;height:32px;border:1px solid rgba(200,244,107,.45);border-radius:10px;display:grid;place-items:center;color:var(--green);background:rgba(200,244,107,.08)}
    .card{background:var(--card);border:1px solid var(--line);border-radius:24px;box-shadow:0 30px 90px rgba(0,0,0,.42);overflow:hidden;backdrop-filter:blur(18px)}.top{padding:30px 30px 24px;text-align:center;border-bottom:1px solid var(--line)}
    .apps{display:flex;align-items:center;justify-content:center;gap:13px;margin-bottom:20px}.app{width:54px;height:54px;border-radius:16px;display:grid;place-items:center;font-size:20px;font-weight:800;background:#242724;border:1px solid var(--line)}.app.w{background:var(--green);color:#17200d}.arrow{color:#777b73;font-size:20px}
    h1{font-size:24px;line-height:1.2;margin:0 0 9px}.sub{margin:0;color:var(--muted)}.client-link{color:var(--ink)}
    .body{padding:25px 30px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#85877f;margin-bottom:10px}.permission{display:flex;gap:13px;padding:13px 0}.permission+.permission{border-top:1px solid var(--line)}.icon{width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.06);display:grid;place-items:center;flex:none}.permission strong{display:block}.permission span{display:block;color:var(--muted);font-size:13px;margin-top:2px}.permission input{margin-left:auto;accent-color:var(--green);width:18px}
    .identity{margin-top:18px;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.045);color:var(--muted);font-size:13px}.identity.good{color:#dcebc0}.actions{display:grid;grid-template-columns:1fr 1.55fr;gap:10px;margin-top:18px}button{border-radius:12px;border:1px solid var(--line);padding:12px 15px;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.deny{background:#222422;color:var(--ink)}.approve{background:var(--green);border-color:transparent;color:#17200d}
    .login{display:none;margin-top:17px;padding-top:17px;border-top:1px solid var(--line)}.login.show{display:block}.login form{display:flex;gap:9px}.login input{min-width:0;flex:1;border:1px solid var(--line);border-radius:12px;background:#121412;color:var(--ink);padding:12px}.login button{background:#eee9dc;color:#171817}.message{min-height:20px;margin:10px 0 0;color:var(--orange);font-size:13px}.fine{padding:0 30px 25px;color:#777b73;font-size:12px;text-align:center}
    @media(max-width:520px){body{padding:14px}.top,.body{padding-left:20px;padding-right:20px}.actions{grid-template-columns:1fr}.login form{display:grid}}
  </style>
</head>
<body>
<main>
  <div class="brand"><span class="mark">W</span> Wayfare</div>
  <section class="card">
    <div class="top">
      <div class="apps"><span class="app">${escapeHtml(client.clientName.slice(0, 1).toUpperCase())}</span><span class="arrow">→</span><span class="app w">W</span></div>
      <h1>Connect ${clientUri ? `<a class="client-link" href="${escapeHtml(clientUri)}" rel="noreferrer">${name}</a>` : name} to Wayfare?</h1>
      <p class="sub">This lets the MCP client act on your trips with the permissions below.</p>
    </div>
    <div class="body">
      <div class="label">Requested access</div>
      <div class="permission"><span class="icon">⌕</span><div><strong>View your trips</strong><span>Trip details, stops, routes, photo metadata and comments</span></div><input type="checkbox" checked disabled aria-label="View trips required"></div>
      ${writeRequested ? `<div class="permission"><span class="icon">✦</span><div><strong>Create and edit trip details</strong><span>Add or change trips, stops, routes, photos, comments and invitations</span></div><input id="write-scope" type="checkbox" checked aria-label="Allow trip editing"></div>` : ''}
      <div id="identity" class="identity">Checking your Wayfare sign-in…</div>
      <div id="login" class="login">
        <div class="label">Sign in to continue</div>
        <form id="login-form"><input id="email" type="email" autocomplete="email" placeholder="you@example.com" required><button type="submit">Email link</button></form>
      </div>
      <input type="hidden" name="request_token" value="${escapeHtml(requestToken)}">
      <div class="actions"><button id="deny" class="deny" type="button">Cancel</button><button id="approve" class="approve" type="button" disabled>Allow access</button></div>
      <p id="message" class="message" role="status"></p>
    </div>
    <div class="fine">You can revoke this connection by revoking its OAuth token. Wayfare never shares your password.</div>
  </section>
</main>
<script nonce="${nonce}">
(() => {
  const sessionKey='wayfare-session', identity=document.querySelector('#identity'), login=document.querySelector('#login'), approve=document.querySelector('#approve'), message=document.querySelector('#message'), requestToken=document.querySelector('[name=request_token]').value;
  let accessToken=null;
  try { accessToken=JSON.parse(localStorage.getItem(sessionKey)||'null')?.accessToken||null } catch {}
  const check=async()=>{
    if(!accessToken){identity.textContent='Sign in to Wayfare before granting access.';login.classList.add('show');return}
    try{const response=await fetch('/api/auth/session',{headers:{authorization:'Bearer '+accessToken}});if(!response.ok)throw new Error();const data=await response.json();identity.textContent='Signed in as '+data.user.email;identity.classList.add('good');approve.disabled=false}
    catch{accessToken=null;localStorage.removeItem(sessionKey);identity.textContent='Your Wayfare sign-in has expired.';login.classList.add('show')}
  };
  document.querySelector('#login-form').addEventListener('submit',async event=>{event.preventDefault();message.textContent='';const email=document.querySelector('#email').value;const response=await fetch('/api/auth/magic-link',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,continue:location.pathname+location.search})});message.textContent=response.ok?'Check your email, then return here if this page stays open.':'Could not send a sign-in link.'});
  const decide=async approveValue=>{message.textContent='';const scopes=['trips:read'];if(document.querySelector('#write-scope')?.checked)scopes.push('trips:write');const response=await fetch('/api/oauth/consent',{method:'POST',headers:{authorization:'Bearer '+accessToken,'content-type':'application/json'},body:JSON.stringify({requestToken,approve:approveValue,scope:scopes.join(' ')})});const data=await response.json();if(!response.ok){message.textContent=data.error||'Authorization failed.';return}location.assign(data.redirectTo)};
  approve.addEventListener('click',()=>decide(true));document.querySelector('#deny').addEventListener('click',()=>decide(false));check();
})();
</script>
</body>
</html>`
  return { html, nonce }
}

const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
const toolFailure = message => ({ isError: true, content: [{ type: 'text', text: message }] })

function tripForMcp(row) {
  return {
    id: row.id, slug: row.slug, title: row.title, crew: row.crew, dates: row.dates,
    dayCount: row.dayCount, startsOn: row.startsOn, endsOn: row.endsOn,
    members: row.members.map(member => ({
      id: member.userId, name: member.displayName, role: member.role,
    })),
    stops: row.stops,
    photos: row.photos.map(({ storagePath: _storagePath, thumbPath: _thumbPath, ...photo }) => photo),
    route: row.route, comments: row.comments, likes: row.likes,
  }
}

function buildMcpServer({ repository, user, scopes, fileStore, sendInvite }) {
  const server = new McpServer({ name: 'Wayfare Trips', version: '1.0.0' }, {
    instructions: 'Use these tools to read and maintain the authenticated user’s Wayfare trips. IDs returned by get_trip are required by mutation tools.',
  })
  server.registerTool('get_trip', {
    description: 'Get the authenticated user’s current trip, or a trip selected by slug.',
    inputSchema: z.object({ slug: z.string().min(1).optional() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ slug }) => {
    const trip = await repository.loadCurrentTrip(user, slug || null)
    return trip ? result(tripForMcp(trip)) : toolFailure('No accessible trip was found.')
  })
  if (!scopes.includes('trips:write')) return server

  server.registerTool('create_trip', {
    description: 'Create a Wayfare trip owned by the authenticated user.',
    inputSchema: z.object({
      title: z.string().trim().min(1).max(160), crew: z.string().max(240).nullable().optional(),
      dates: z.string().max(160).nullable().optional(), dayCount: z.number().int().min(1).max(1000).optional(),
      startsOn: z.iso.date().nullable().optional(), endsOn: z.iso.date().nullable().optional(),
    }), annotations: { destructiveHint: false, openWorldHint: false },
  }, async input => result(await repository.createTrip(user, input)))

  server.registerTool('update_trip', {
    description: 'Update the title, crew, dates or date range of an editable trip.',
    inputSchema: z.object({
      tripId: z.string().min(1), title: z.string().trim().min(1).max(160).optional(),
      crew: z.string().max(240).nullable().optional(), dates: z.string().max(160).nullable().optional(),
      dayCount: z.number().int().min(1).max(1000).optional(), startsOn: z.iso.date().nullable().optional(),
      endsOn: z.iso.date().nullable().optional(),
    }), annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ tripId, ...changes }) => {
    const trip = await repository.updateTrip(user, tripId, changes)
    return trip ? result(trip) : toolFailure('The trip was not found or is not editable by this user.')
  })

  server.registerTool('create_stop', {
    description: 'Add a stop with valid longitude and latitude to an editable trip.',
    inputSchema: z.object({
      tripId: z.string().min(1), name: z.string().trim().min(1).max(200),
      lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90),
      kind: z.string().nullable().optional(), icon: z.string().optional(), day: z.number().int().nullable().optional(),
      time: z.string().nullable().optional(), status: z.enum(['done', 'now', 'next', 'planned']).optional(), note: z.string().nullable().optional(),
      src: z.string().nullable().optional(), sourceUrl: z.string().nullable().optional(), seq: z.number().int().optional(),
    }), annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ tripId, ...input }) => {
    const stop = await repository.createStop(user, tripId, {
      kind: null, icon: 'pin', day: null, time: null, status: 'planned', note: null,
      src: null, sourceUrl: null, seq: 0, ...input,
    })
    return stop ? result(stop) : toolFailure('The trip was not found or is not editable by this user.')
  })

  server.registerTool('update_stop', {
    description: 'Update fields on an existing trip stop.',
    inputSchema: z.object({
      tripId: z.string().min(1), stopId: z.string().min(1), name: z.string().trim().min(1).max(200).optional(),
      lng: z.number().min(-180).max(180).optional(), lat: z.number().min(-90).max(90).optional(),
      kind: z.string().nullable().optional(), icon: z.string().optional(), day: z.number().int().nullable().optional(),
      time: z.string().nullable().optional(), status: z.enum(['done', 'now', 'next', 'planned']).optional(), note: z.string().nullable().optional(),
      src: z.string().nullable().optional(), sourceUrl: z.string().nullable().optional(), seq: z.number().int().optional(),
    }), annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ tripId, stopId, ...changes }) => {
    const stop = await repository.updateStop(user, tripId, stopId, changes)
    return stop ? result(stop) : toolFailure('The stop was not found or is not editable by this user.')
  })

  server.registerTool('delete_stop', {
    description: 'Delete a stop from an editable trip. Photos at that stop remain but become unassigned.',
    inputSchema: z.object({ tripId: z.string().min(1), stopId: z.string().min(1) }),
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ tripId, stopId }) => await repository.deleteStop(user, tripId, stopId)
    ? result({ deleted: true, stopId }) : toolFailure('The stop was not found or is not editable by this user.'))

  server.registerTool('replace_route', {
    description: 'Replace all route points for an editable trip with ordered [longitude, latitude] pairs.',
    inputSchema: z.object({
      tripId: z.string().min(1), points: z.array(z.tuple([
        z.number().min(-180).max(180), z.number().min(-90).max(90),
      ])).max(10000),
    }), annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ tripId, points }) => await repository.replaceRoute(user, tripId, points)
    ? result({ replaced: true, pointCount: points.length }) : toolFailure('The trip was not found or is not editable by this user.'))

  server.registerTool('update_photo', {
    description: 'Update a photo caption or assign it to a stop.',
    inputSchema: z.object({
      tripId: z.string().min(1), photoId: z.string().min(1),
      caption: z.string().max(2000).optional(), stopId: z.string().nullable().optional(),
    }), annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ tripId, photoId, ...changes }) => {
    const photo = await repository.updatePhoto(user, tripId, photoId, changes)
    return photo ? result({ id: photo.id, stopId: photo.stopId, caption: photo.caption })
      : toolFailure('The photo was not found or is not editable by this user.')
  })

  server.registerTool('delete_photo', {
    description: 'Permanently delete a trip photo and its stored resized copies.',
    inputSchema: z.object({ tripId: z.string().min(1), photoId: z.string().min(1) }),
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ tripId, photoId }) => {
    const removed = await repository.deletePhoto(user, tripId, photoId)
    if (!removed) return toolFailure('The photo was not found or is not editable by this user.')
    if (fileStore) {
      await fileStore.remove(removed.storagePath).catch(() => {})
      if (removed.thumbPath) await fileStore.remove(removed.thumbPath).catch(() => {})
    }
    return result({ deleted: true, photoId })
  })

  server.registerTool('add_comment', {
    description: 'Add a comment to a photo in an accessible trip.',
    inputSchema: z.object({ tripId: z.string().min(1), photoId: z.string().min(1), body: z.string().trim().min(1).max(4000) }),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ tripId, photoId, body }) => {
    const comment = await repository.addComment(user, tripId, photoId, body)
    return comment ? result(comment) : toolFailure('The trip or photo was not found.')
  })

  server.registerTool('delete_comment', {
    description: 'Delete the user’s comment, or any comment when the user can edit the trip.',
    inputSchema: z.object({ tripId: z.string().min(1), commentId: z.string().min(1) }),
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ tripId, commentId }) => await repository.deleteComment(user, tripId, commentId)
    ? result({ deleted: true, commentId }) : toolFailure('The comment was not found or cannot be deleted by this user.'))

  server.registerTool('set_photo_like', {
    description: 'Like or unlike a photo in an accessible trip.',
    inputSchema: z.object({ tripId: z.string().min(1), photoId: z.string().min(1), liked: z.boolean() }),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ tripId, photoId, liked }) => await repository.setLike(user, tripId, photoId, liked)
    ? result({ photoId, liked }) : toolFailure('The trip or photo was not found.'))

  server.registerTool('list_invitations', {
    description: 'List invitations for a trip owned by the authenticated user.',
    inputSchema: z.object({ tripId: z.string().min(1) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ tripId }) => {
    const invitations = await repository.listInvites(user, tripId)
    return invitations ? result(invitations) : toolFailure('Only a trip owner can view invitations.')
  })

  server.registerTool('invite_person', {
    description: 'Invite a person to a trip as an editor or viewer. This sends a Wayfare sign-in email.',
    inputSchema: z.object({
      tripId: z.string().min(1), email: z.string().email(), name: z.string().trim().max(160).nullable().optional(),
      role: z.enum(['editor', 'viewer']).default('viewer'),
    }), annotations: { destructiveHint: false, openWorldHint: true },
  }, async ({ tripId, email, name, role }) => {
    const normalizedEmail = email.trim().toLowerCase()
    const invitation = await repository.upsertInvite(user, tripId, { email: normalizedEmail, name: name || null, role })
    if (!invitation) return toolFailure('Only a trip owner can send invitations.')
    try { await sendInvite(normalizedEmail); return result({ ...invitation, mailed: true }) }
    catch { return result({ ...invitation, mailed: false, mailError: 'The invitation was saved, but its email could not be sent.' }) }
  })

  server.registerTool('revoke_invitation', {
    description: 'Revoke an invitation and remove that invited member from the trip.',
    inputSchema: z.object({ tripId: z.string().min(1), invitationId: z.string().min(1) }),
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ tripId, invitationId }) => await repository.revokeInvite(user, tripId, invitationId)
    ? result({ revoked: true, invitationId }) : toolFailure('The invitation was not found or cannot be revoked by this user.'))
  return server
}

export async function registerMcpRoutes(app, {
  repository, fileStore, publicUrl, oauthSecret, clock, authenticate, sendInvite,
}) {
  const root = normalizeRoot(publicUrl)
  const resource = `${root}/mcp`
  const resourceMetadataUrl = `${root}/.well-known/oauth-protected-resource/mcp`
  const authorizationMetadata = {
    issuer: root, authorization_endpoint: `${root}/oauth/authorize`,
    token_endpoint: `${root}/oauth/token`, registration_endpoint: `${root}/oauth/register`,
    revocation_endpoint: `${root}/oauth/revoke`, scopes_supported: SCOPES,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  }
  const protectedMetadata = {
    resource, authorization_servers: [root], scopes_supported: SCOPES,
    bearer_methods_supported: ['header'], resource_name: 'Wayfare Trips',
  }
  const oauthWindows = new Map(), inviteWindows = new Map()
  const limited = (key, max, windowMs) => {
    const now = clock().getTime()
    let window = oauthWindows.get(key)
    if (!window || now - window.startedAt >= windowMs) {
      window = { startedAt: now, count: 0 }
      oauthWindows.set(key, window)
    }
    window.count++
    return window.count > max
      ? Math.max(1, Math.ceil((window.startedAt + windowMs - now) / 1000)) : 0
  }
  const throttle = (request, reply, bucket, max, windowMs = 15 * 60_000) => {
    const retryAfter = limited(`${bucket}:${request.ip}`, max, windowMs)
    if (!retryAfter) return false
    reply.header('retry-after', String(retryAfter)).code(429).send({
      error: 'temporarily_unavailable', error_description: 'Too many OAuth requests',
    })
    return true
  }

  app.get('/.well-known/oauth-authorization-server', async (_request, reply) => reply.send(authorizationMetadata))
  app.get('/.well-known/oauth-protected-resource/mcp', async (_request, reply) => reply.send(protectedMetadata))

  app.post('/oauth/register', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    if (throttle(request, reply, 'register', 20)) return
    const body = request.body || {}
    const redirectUris = Array.isArray(body.redirect_uris) ? [...new Set(body.redirect_uris)] : []
    if (!redirectUris.length || redirectUris.length > 10 || redirectUris.some(uri => !validRedirect(uri))) {
      return oauthError(reply, 'invalid_redirect_uri', 'Provide HTTPS or loopback HTTP redirect URIs without fragments')
    }
    if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') {
      return oauthError(reply, 'invalid_client_metadata', 'Wayfare dynamically registers public clients only')
    }
    const clientUri = safeMetadataUrl(body.client_uri), logoUri = safeMetadataUrl(body.logo_uri)
    if ((body.client_uri && !clientUri) || (body.logo_uri && !logoUri)) {
      return oauthError(reply, 'invalid_client_metadata', 'Client metadata URLs must use HTTPS')
    }
    const client = await repository.registerMcpClient({
      id: newToken('wf_client_'), clientName: String(body.client_name || 'MCP client').trim().slice(0, 100) || 'MCP client',
      redirectUris, clientUri, logoUri, scopes: SCOPES,
    })
    return reply.code(201).header('cache-control', 'no-store').send({
      client_id: client.id, client_id_issued_at: Math.floor(clock().getTime() / 1000),
      client_name: client.clientName, redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], scope: SCOPES.join(' '),
      ...(client.clientUri ? { client_uri: client.clientUri } : {}),
      ...(client.logoUri ? { logo_uri: client.logoUri } : {}),
    })
  })

  app.get('/oauth/authorize', async (request, reply) => {
    const query = request.query || {}
    const client = await repository.findMcpClient(String(query.client_id || ''))
    if (!client) return oauthError(reply, 'invalid_request', 'Unknown OAuth client')
    const redirectUri = String(query.redirect_uri || '')
    if (!client.redirectUris.some(uri => redirectMatches(uri, redirectUri))) {
      return oauthError(reply, 'invalid_request', 'The redirect URI is not registered')
    }
    const fail = (error, description) => reply.redirect(authRedirect({ redirectUri }, {
      error, error_description: description, state: query.state, iss: root,
    }))
    if (query.response_type !== 'code') return fail('unsupported_response_type', 'Only authorization code flow is supported')
    if (query.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(String(query.code_challenge || ''))) {
      return fail('invalid_request', 'PKCE with the S256 challenge method is required')
    }
    const scopes = requestedScopes(query.scope)
    if (!scopes) return fail('invalid_scope', 'Only trips:read and trips:write can be requested')
    const wantedResource = String(query.resource || resource)
    if (wantedResource !== resource) return fail('invalid_target', 'The token resource must be the Wayfare MCP endpoint')
    const authorizationRequest = {
      issuedAt: clock().getTime(), clientId: client.id, redirectUri, scopes,
      state: String(query.state || ''), codeChallenge: String(query.code_challenge), resource,
    }
    const requestToken = signAuthorizationRequest(authorizationRequest, oauthSecret)
    const page = consentPage({ client, requestToken, scopes, root })
    return reply.header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('content-security-policy', `default-src 'none'; script-src 'nonce-${page.nonce}'; style-src 'nonce-${page.nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`)
      .header('x-frame-options', 'DENY').header('x-content-type-options', 'nosniff')
      .send(page.html)
  })

  app.post('/api/oauth/consent', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const authorizationRequest = readAuthorizationRequest(request.body?.requestToken, oauthSecret, clock())
    if (!authorizationRequest) return reply.code(400).send({ error: 'This authorization request has expired. Start the connection again.' })
    const client = await repository.findMcpClient(authorizationRequest.clientId)
    if (!client || !client.redirectUris.some(uri => redirectMatches(uri, authorizationRequest.redirectUri))) {
      return reply.code(400).send({ error: 'The OAuth client is no longer registered.' })
    }
    if (request.body?.approve !== true) {
      return { redirectTo: authRedirect(authorizationRequest, {
        error: 'access_denied', error_description: 'The user declined access',
        state: authorizationRequest.state, iss: root,
      }) }
    }
    const user = await authenticate(request, reply)
    if (!user) return
    const approved = requestedScopes(request.body?.scope)
    if (!approved || approved.some(scope => !authorizationRequest.scopes.includes(scope))) {
      return reply.code(400).send({ error: 'Approved permissions must be a subset of the requested permissions.' })
    }
    const code = newToken('wf_code_')
    await repository.createMcpAuthorizationCode({
      hash: tokenHash(code), userId: user.id, clientId: authorizationRequest.clientId,
      redirectUri: authorizationRequest.redirectUri, scopes: approved,
      resource: authorizationRequest.resource, codeChallenge: authorizationRequest.codeChallenge,
      expiresAt: new Date(clock().getTime() + AUTH_CODE_TTL_MS),
    })
    return { redirectTo: authRedirect(authorizationRequest, {
      code, state: authorizationRequest.state, iss: root,
    }) }
  })

  const tokenPair = () => {
    const accessToken = newToken('wf_mcp_'), refreshToken = newToken('wf_refresh_')
    return {
      accessToken, refreshToken,
      accessHash: tokenHash(accessToken), refreshHash: tokenHash(refreshToken),
      accessExpiresAt: new Date(clock().getTime() + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(clock().getTime() + REFRESH_TOKEN_TTL_MS),
    }
  }

  const tokenResponse = (tokens, grant) => ({
    access_token: tokens.accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: tokens.refreshToken, scope: grant.scopes.join(' '),
  })

  app.post('/oauth/token', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    if (throttle(request, reply, 'token', 120)) return
    const body = request.body || {}
    const client = await repository.findMcpClient(String(body.client_id || ''))
    if (!client) return oauthError(reply, 'invalid_client', 'Unknown public client', 401)
    const wantedResource = String(body.resource || resource)
    if (wantedResource !== resource) return oauthError(reply, 'invalid_target', 'The token resource is invalid')
    if (body.grant_type === 'authorization_code') {
      const verifier = String(body.code_verifier || '')
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
        return oauthError(reply, 'invalid_grant', 'The PKCE verifier is invalid')
      }
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      const tokens = tokenPair()
      const grant = await repository.redeemMcpAuthorizationCode({
        codeHash: tokenHash(String(body.code || '')), now: clock(), clientId: client.id,
        redirectUri: String(body.redirect_uri || ''), resource: wantedResource,
        codeChallenge: challenge, accessHash: tokens.accessHash, refreshHash: tokens.refreshHash,
        accessExpiresAt: tokens.accessExpiresAt, refreshExpiresAt: tokens.refreshExpiresAt,
      })
      if (!grant) return oauthError(reply, 'invalid_grant', 'The authorization code is invalid, expired, or failed PKCE verification')
      return reply.header('cache-control', 'no-store').header('pragma', 'no-cache').send(tokenResponse(tokens, grant))
    }
    if (body.grant_type === 'refresh_token') {
      const tokens = tokenPair()
      const grant = await repository.rotateMcpRefreshToken({
        refreshHash: tokenHash(String(body.refresh_token || '')), now: clock(), clientId: client.id,
        resource: wantedResource, accessHash: tokens.accessHash,
        replacementRefreshHash: tokens.refreshHash, accessExpiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
      })
      if (!grant) return oauthError(reply, 'invalid_grant', 'The refresh token is invalid or expired')
      return reply.header('cache-control', 'no-store').header('pragma', 'no-cache').send(tokenResponse(tokens, grant))
    }
    return oauthError(reply, 'unsupported_grant_type', 'Use authorization_code or refresh_token')
  })

  app.post('/oauth/revoke', { bodyLimit: 8 * 1024 }, async (request, reply) => {
    if (throttle(request, reply, 'revoke', 120)) return
    if (request.body?.token) await repository.revokeMcpToken(tokenHash(String(request.body.token)))
    return reply.header('cache-control', 'no-store').code(200).send()
  })

  const mcpHandler = createMcpHandler(({ authInfo }) => buildMcpServer({
    repository, user: authInfo.user, scopes: authInfo.scopes, fileStore,
    sendInvite: async email => {
      const now = clock().getTime(), key = `${authInfo.user.id}:${email}`
      let window = inviteWindows.get(key)
      if (!window || now - window.startedAt >= 60 * 60_000) {
        window = { startedAt: now, count: 0 }
        inviteWindows.set(key, window)
      }
      if (++window.count > 3) throw new Error('Invitation email rate limit exceeded')
      return sendInvite(email)
    },
  }), { legacy: 'stateless' })
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror(error) { app.log.error({ err: error }, 'MCP transport error') },
  })
  app.addHook('onClose', async () => { await mcpHandler.close() })

  app.route({
    method: ['GET', 'POST', 'DELETE'], url: '/mcp',
    async handler(request, reply) {
      if (request.headers.origin && request.headers.origin !== root) {
        return reply.code(403).send({ error: 'Origin is not allowed' })
      }
      const authorization = request.headers.authorization || ''
      const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
      const grant = accessToken ? await repository.findMcpAccessToken(tokenHash(accessToken), clock()) : null
      if (!grant || grant.resource !== resource || !grant.scopes.includes('trips:read')) {
        return reply.header('www-authenticate', `Bearer resource_metadata="${resourceMetadataUrl}", scope="trips:read"`)
          .code(401).send({ error: 'invalid_token', error_description: 'A valid Wayfare MCP token is required' })
      }
      request.raw.auth = {
        token: accessToken, clientId: grant.clientId, scopes: grant.scopes,
        expiresAt: Math.floor(new Date(grant.accessExpiresAt).getTime() / 1000),
        resource, user: grant.user,
      }
      reply.hijack()
      await nodeHandler(request.raw, reply.raw, request.body)
    },
  })
}
