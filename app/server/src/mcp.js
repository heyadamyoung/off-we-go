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
  if (values.includes('trips:write') && !values.includes('trips:read')) values.push('trips:read')
  return SCOPES.filter(scope => values.includes(scope))
}

const authRedirect = (request, values) => {
  const redirect = new URL(request.redirectUri)
  for (const [key, value] of Object.entries(values)) if (value != null) redirect.searchParams.set(key, value)
  return redirect.href
}

function consentPage({ client, requestToken, scopes, root, redirectUri, continuation }) {
  const nonce = randomBytes(18).toString('base64url')
  const name = escapeHtml(client.clientName)
  const clientUri = safeMetadataUrl(client.clientUri)
  const redirect = new URL(redirectUri)
  const redirectOrigin = escapeHtml(redirect.origin)
  const returnsToThisDevice = redirect.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname)
  const writeRequested = scopes.includes('trips:write')
  const signInHref = escapeHtml(`/api/auth/oidc/start?client=web&continue=${encodeURIComponent(continuation)}`)
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect ${name} to Wayfare</title>
  <style nonce="${nonce}">
    :root{color-scheme:dark;--bg:#0a0c10;--bg1:#0d1016;--bg2:#12161e;--bg3:#181d27;--line:#1a1f2a;--line2:#272e3b;--ink:#eef1f6;--ink2:#a2abbb;--ink3:#68738a;--disclosure:#b5becc;--warning:#ff9a6b;--success:#4ade80;--hot:#ff7a3d;--hot2:#ff6a24;--hot-soft:#2a1409;--ok:#22c55e;--ok-soft:#0f2a1c;--shadow:0 1px 2px rgba(0,0,0,.5),0 18px 50px rgba(0,0,0,.55)}
    :root[data-theme="light"]{color-scheme:light;--bg:#eef1f5;--bg1:#fff;--bg2:#fff;--bg3:#eff2f7;--line:#e2e7ee;--line2:#d2d9e3;--ink:#101620;--ink2:#525c6b;--ink3:#8b94a3;--disclosure:#4b5565;--warning:#9a3412;--success:#067647;--hot:#e2561b;--hot2:#c84812;--hot-soft:#fdeee6;--ok:#0e9f6e;--ok-soft:#e7f8f0;--shadow:0 1px 2px rgba(16,24,40,.06),0 14px 40px rgba(16,24,40,.13)}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%}body{min-height:100vh;background:radial-gradient(circle at 50% 0,rgba(255,122,61,.055),transparent 32%),var(--bg);color:var(--ink);font:14px/1.5 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;display:grid;place-items:center;padding:28px}
    main{width:min(100%,620px)}.brand{display:flex;justify-content:center;align-items:center;gap:9px;margin-bottom:20px;font-size:14px;font-weight:800;letter-spacing:-.01em}.brand img{display:block;width:28px;height:28px;border-radius:7px}
    .card{background:var(--bg1);border:1px solid var(--line2);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}.top{padding:28px 30px 22px;text-align:center;border-bottom:1px solid var(--line)}
    .apps{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:18px}.app{width:50px;height:50px;border-radius:13px;display:grid;place-items:center;font-size:18px;font-weight:800;background:var(--bg3);border:1px solid var(--line2);color:var(--ink)}.app.w{padding:0;overflow:hidden;border-color:transparent;background:transparent}.app.w img{display:block;width:100%;height:100%;object-fit:cover}.arrow{width:20px;color:var(--disclosure)}
    h1{font-size:24px;letter-spacing:-.025em;line-height:1.2;margin:0 0 8px}.sub{margin:0 auto;color:var(--ink2);max-width:480px}.client-link{color:var(--ink2)}.unverified{display:inline-block;margin:0 0 10px;padding:3px 8px;border:1px solid rgba(255,122,61,.42);border-radius:999px;background:var(--hot-soft);color:var(--warning);font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .connection-route{display:flex;align-items:center;gap:10px;margin:17px auto 0;padding:10px 12px;max-width:440px;border:1px solid var(--line);border-radius:9px;background:var(--bg2);text-align:left;color:var(--disclosure)}.connection-route svg{flex:none}.connection-route div{min-width:0;display:flex;flex-direction:column}.connection-route span{font-size:11.5px}.connection-route code{font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink2);overflow-wrap:anywhere}
    .technical-details{max-width:440px;margin:8px auto 0;color:var(--disclosure);font-size:11.5px;text-align:left}.technical-details summary{width:max-content;margin:auto;cursor:pointer;user-select:none}.technical-copy{display:grid;grid-template-columns:auto 1fr;gap:5px 10px;margin-top:9px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg2);overflow-wrap:anywhere}.technical-copy code{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink2)}
    .body{padding:23px 30px}.label{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:var(--disclosure);margin-bottom:7px}.permission{display:grid;grid-template-columns:38px minmax(0,1fr) 24px;align-items:center;gap:13px;padding:14px 0}.permission+.permission{border-top:1px solid var(--line)}.permission-icon{width:38px;height:38px;border-radius:10px;border:1px solid var(--line);background:var(--bg3);color:var(--disclosure);display:grid;place-items:center}.permission-icon svg{display:block}.permission-copy{min-width:0}.permission-copy strong{display:block;font-size:13.5px}.permission-copy span{display:block;color:var(--ink2);font-size:12.5px;margin-top:2px}.permission input{appearance:none;-webkit-appearance:none;width:24px;height:24px;margin:0;border:1px solid var(--line2);border-radius:6px;background:var(--bg3);display:grid;place-items:center}.permission input::after{content:'';width:10px;height:6px;border:solid #0a0c10;border-width:0 0 2px 2px;transform:translateY(-1px) rotate(-45deg);opacity:0}.permission input:checked{background:var(--hot);border-color:var(--hot)}.permission input:checked::after{opacity:1}.permission input:not(:disabled){cursor:pointer}.permission input:focus-visible{outline:2px solid var(--ink);outline-offset:3px}.permission input:disabled{opacity:.62}
    .identity{margin-top:17px;padding:11px 13px;border:1px solid var(--line);border-radius:9px;background:var(--bg2);color:var(--ink2);font-size:12.5px}.identity.good{border-color:rgba(34,197,94,.2);background:var(--ok-soft);color:var(--success)}.actions{display:grid;grid-template-columns:1fr 1.55fr;gap:9px;margin-top:17px}button{height:42px;border-radius:9px;border:1px solid var(--line2);padding:0 14px;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.deny{background:var(--bg2);color:var(--ink)}.deny:hover{border-color:var(--ink3)}.approve{background:var(--hot);border-color:transparent;color:#0a0c10;font-weight:800}.approve:hover{background:var(--hot2)}
    .login{display:none;margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}.login.show{display:block}.login a{height:42px;border-radius:9px;padding:0 14px;background:var(--hot);color:#0a0c10;font-weight:800;text-decoration:none;display:flex;align-items:center;justify-content:center}.login a:hover{background:var(--hot2)}:root[data-theme="light"] .approve:hover,:root[data-theme="light"] .login a:hover{color:#fff}.message{min-height:20px;margin:9px 0 0;color:var(--warning);font-size:12.5px}.fine{padding:0 30px 23px;color:var(--disclosure);font-size:11.5px;text-align:center}
    @media(max-width:520px){body{padding:12px}.brand{margin-bottom:14px}.top,.body{padding-left:18px;padding-right:18px}.top{padding-top:23px}.actions{grid-template-columns:1fr}.permission{grid-template-columns:38px minmax(0,1fr) 24px;gap:10px}.technical-copy{grid-template-columns:1fr}.fine{padding-left:18px;padding-right:18px}}
  </style>
  <script nonce="${nonce}">try{document.documentElement.dataset.theme=localStorage.getItem('wf-theme')||'dark'}catch{document.documentElement.dataset.theme='dark'}</script>
</head>
<body>
<main>
  <div class="brand"><img src="/wayfare-icon.png" alt=""><span>Wayfare</span></div>
  <section class="card">
    <div class="top">
      <div class="apps"><span class="app">${escapeHtml(client.clientName.slice(0, 1).toUpperCase())}</span><svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M15 8l4 4-4 4"/></svg><span class="app w"><img src="/wayfare-icon.png" alt="Wayfare"></span></div>
      <div class="unverified">Unverified client</div>
      <h1>Connect ${name} to Wayfare?</h1>
      <p class="sub">This lets the MCP client act on your trips with the permissions below.</p>
      <div class="connection-route"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3M14 4l4 4-4 4M18 8H9"/></svg><div><span>Returns to ${name}${returnsToThisDevice ? ' on this device' : ''}</span><code>${redirectOrigin}</code></div></div>
      <details class="technical-details"><summary>Connection details</summary><div class="technical-copy"><span>Client ID</span><code>${escapeHtml(client.id)}</code>${clientUri ? `<span>Self-reported website</span><a class="client-link" href="${escapeHtml(clientUri)}" rel="noreferrer">${escapeHtml(clientUri)}</a>` : ''}</div></details>
    </div>
    <div class="body">
      <div class="label">Requested access</div>
      <div class="permission"><span class="permission-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/></svg></span><div class="permission-copy"><strong>View your trips</strong><span>Trip details, stops, routes, photo metadata and comments</span></div><input type="checkbox" checked disabled aria-label="View trips required"></div>
      ${writeRequested ? `<div class="permission"><span class="permission-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16zM13.5 6.5l4 4"/></svg></span><div class="permission-copy"><strong>Create and edit trip details</strong><span>Add or change trips, stops, routes, photos, comments and invitations</span></div><input id="write-scope" type="checkbox" checked aria-label="Allow trip editing"></div>` : ''}
      <div id="identity" class="identity">Checking your Wayfare sign-in…</div>
      <div id="login" class="login">
        <div class="label">Sign in to continue</div>
        <a href="${signInHref}">Continue to sign in</a>
      </div>
      <input type="hidden" name="request_token" value="${escapeHtml(requestToken)}">
      <div class="actions"><button id="deny" class="deny" type="button">Cancel</button><button id="approve" class="approve" type="button" disabled>Allow access</button></div>
      <p id="message" class="message" role="status"></p>
    </div>
    <div class="fine">Your MCP client can revoke this connection through Wayfare’s OAuth revocation endpoint. Wayfare never shares your password.</div>
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
const entityId = z.uuid()
const pgInteger = z.number().int().min(0).max(2_147_483_647)
const externalUrl = z.url().max(2048).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), {
  message: 'Use an HTTP or HTTPS URL',
})

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

function buildMcpServer({ repository, user, scopes, fileStore, sendInvite, logger, clock }) {
  const server = new McpServer({ name: 'Wayfare Trips', version: '1.0.0' }, {
    instructions: 'Use these tools to read and maintain the authenticated user’s Wayfare trips. IDs returned by get_trip are required by mutation tools.',
  })
  server.registerTool('list_trips', {
    description: 'List every trip accessible to the authenticated user, including IDs, slugs and the user’s role.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => result(await repository.listTrips(user)))
  server.registerTool('get_trip', {
    description: 'Get the authenticated user’s current trip, or a trip selected by slug.',
    inputSchema: z.object({ slug: z.string().trim().min(1).max(200).regex(/^[a-z0-9-]+$/).optional() }),
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
      tripId: entityId, title: z.string().trim().min(1).max(160).optional(),
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
      tripId: entityId, name: z.string().trim().min(1).max(200),
      lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90),
      kind: z.string().max(80).nullable().optional(), icon: z.string().max(80).optional(), day: pgInteger.max(10_000).nullable().optional(),
      time: z.string().max(80).nullable().optional(), status: z.enum(['done', 'now', 'next', 'planned']).optional(), note: z.string().max(5000).nullable().optional(),
      src: externalUrl.nullable().optional(), sourceUrl: externalUrl.nullable().optional(), seq: pgInteger.optional(),
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
      tripId: entityId, stopId: entityId, name: z.string().trim().min(1).max(200).optional(),
      lng: z.number().min(-180).max(180).optional(), lat: z.number().min(-90).max(90).optional(),
      kind: z.string().max(80).nullable().optional(), icon: z.string().max(80).optional(), day: pgInteger.max(10_000).nullable().optional(),
      time: z.string().max(80).nullable().optional(), status: z.enum(['done', 'now', 'next', 'planned']).optional(), note: z.string().max(5000).nullable().optional(),
      src: externalUrl.nullable().optional(), sourceUrl: externalUrl.nullable().optional(), seq: pgInteger.optional(),
    }), annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ tripId, stopId, ...changes }) => {
    const stop = await repository.updateStop(user, tripId, stopId, changes)
    return stop ? result(stop) : toolFailure('The stop was not found or is not editable by this user.')
  })

  server.registerTool('delete_stop', {
    description: 'Delete a stop from an editable trip. Photos at that stop remain but become unassigned.',
    inputSchema: z.object({ tripId: entityId, stopId: entityId }),
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ tripId, stopId }) => await repository.deleteStop(user, tripId, stopId)
    ? result({ deleted: true, stopId }) : toolFailure('The stop was not found or is not editable by this user.'))

  server.registerTool('replace_route', {
    description: 'Replace all route points for an editable trip with ordered [longitude, latitude] pairs.',
    inputSchema: z.object({
      tripId: entityId, points: z.array(z.tuple([
        z.number().min(-180).max(180), z.number().min(-90).max(90),
      ])).max(10000),
    }), annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ tripId, points }) => await repository.replaceRoute(user, tripId, points)
    ? result({ replaced: true, pointCount: points.length }) : toolFailure('The trip was not found or is not editable by this user.'))

  server.registerTool('update_photo', {
    description: 'Update a photo caption or assign it to a stop.',
    inputSchema: z.object({
      tripId: entityId, photoId: entityId,
      caption: z.string().max(2000).optional(), stopId: entityId.nullable().optional(),
    }), annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ tripId, photoId, ...changes }) => {
    const photo = await repository.updatePhoto(user, tripId, photoId, changes)
    return photo ? result({ id: photo.id, stopId: photo.stopId, caption: photo.caption })
      : toolFailure('The photo was not found or is not editable by this user.')
  })

  server.registerTool('delete_photo', {
    description: 'Permanently delete a trip photo and its stored resized copies.',
    inputSchema: z.object({ tripId: entityId, photoId: entityId }),
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ tripId, photoId }) => {
    const removed = await repository.deletePhoto(user, tripId, photoId)
    if (!removed) return toolFailure('The photo was not found or is not editable by this user.')
    if (fileStore) {
      const failures = []
      for (const path of [removed.storagePath, removed.thumbPath].filter(Boolean)) {
        try {
          await fileStore.remove(path)
          await repository.completeFileDeletion?.(path)
        } catch (error) {
          failures.push({ path, error })
          await repository.failFileDeletion?.(path, error.message, clock())
        }
      }
      if (failures.length) {
        logger?.error({ failures, tripId, photoId }, 'MCP photo record deleted but stored file cleanup failed')
        return toolFailure('The photo record was deleted, but stored-file cleanup failed and requires administrator reconciliation.')
      }
    }
    return result({ deleted: true, photoId })
  })

  server.registerTool('add_comment', {
    description: 'Add a comment to a photo in an accessible trip.',
    inputSchema: z.object({ tripId: entityId, photoId: entityId, body: z.string().trim().min(1).max(4000) }),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ tripId, photoId, body }) => {
    const comment = await repository.addComment(user, tripId, photoId, body)
    return comment ? result(comment) : toolFailure('The trip or photo was not found.')
  })

  server.registerTool('delete_comment', {
    description: 'Delete the user’s comment, or any comment when the user can edit the trip.',
    inputSchema: z.object({ tripId: entityId, commentId: entityId }),
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ tripId, commentId }) => await repository.deleteComment(user, tripId, commentId)
    ? result({ deleted: true, commentId }) : toolFailure('The comment was not found or cannot be deleted by this user.'))

  server.registerTool('set_photo_like', {
    description: 'Like or unlike a photo in an accessible trip.',
    inputSchema: z.object({ tripId: entityId, photoId: entityId, liked: z.boolean() }),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ tripId, photoId, liked }) => await repository.setLike(user, tripId, photoId, liked)
    ? result({ photoId, liked }) : toolFailure('The trip or photo was not found.'))

  server.registerTool('list_invitations', {
    description: 'List invitations for a trip owned by the authenticated user.',
    inputSchema: z.object({ tripId: entityId }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ tripId }) => {
    const invitations = await repository.listInvites(user, tripId)
    return invitations ? result(invitations) : toolFailure('Only a trip owner can view invitations.')
  })

  server.registerTool('invite_person', {
    description: 'Invite a person to a trip as an editor or viewer. This sends a Wayfare sign-in email.',
    inputSchema: z.object({
      tripId: entityId, email: z.string().email(), name: z.string().trim().max(160).nullable().optional(),
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
    inputSchema: z.object({ tripId: entityId, invitationId: entityId }),
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
      if (oauthWindows.size > 10_000) {
        for (const [candidate, value] of oauthWindows) {
          if (now - value.startedAt >= windowMs) oauthWindows.delete(candidate)
        }
        while (oauthWindows.size > 10_000) oauthWindows.delete(oauthWindows.keys().next().value)
      }
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
    const page = consentPage({
      client, requestToken, scopes, root, redirectUri,
      continuation: request.raw.url,
    })
    return reply.header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('content-security-policy', `default-src 'none'; img-src 'self'; script-src 'nonce-${page.nonce}'; style-src 'nonce-${page.nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`)
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
    repository, user: authInfo.user, scopes: authInfo.scopes, fileStore, logger: app.log, clock,
    sendInvite: async email => {
      const now = clock().getTime()
      const increment = (key, max) => {
        let window = inviteWindows.get(key)
        if (!window || now - window.startedAt >= 60 * 60_000) {
          window = { startedAt: now, count: 0 }
          inviteWindows.set(key, window)
          if (inviteWindows.size > 10_000) {
            for (const [candidate, value] of inviteWindows) {
              if (now - value.startedAt >= 60 * 60_000) inviteWindows.delete(candidate)
            }
            while (inviteWindows.size > 10_000) inviteWindows.delete(inviteWindows.keys().next().value)
          }
        }
        return ++window.count > max
      }
      if (increment(`user:${authInfo.user.id}`, 10) || increment(`target:${authInfo.user.id}:${email}`, 3)) {
        throw new Error('Invitation email rate limit exceeded')
      }
      return sendInvite(email)
    },
  }), { legacy: 'stateless' })
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror(error) { app.log.error({ err: error }, 'MCP transport error') },
  })
  app.addHook('onClose', async () => { await mcpHandler.close() })

  app.route({
    method: ['GET', 'POST', 'DELETE'], url: '/mcp', bodyLimit: 1024 * 1024,
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
