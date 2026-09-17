#!/usr/bin/env node
/* What the airports actually serve, looked at rather than assumed.
 *
 * Run from a machine with open internet (the GitHub Actions runner; the
 * development sandbox cannot reach any of these hosts). For every candidate
 * source it records the status, the headers that say how the response is
 * cached and rate-limited, the shape of the body, and a couple of records —
 * then, for an HTML page, reads the scripts the page loads, quotes the code
 * around anything that looks like a flight endpoint, a status vocabulary or
 * an API key, and fetches the likeliest endpoints too. Feeds small enough to
 * be fixtures are printed whole. The full bodies go to probe-out/ for the
 * artifact.
 *
 * Nothing here is a parser. A parser is written against what this prints,
 * and not before.
 *
 *   node server/scripts/probe-flight-sources.mjs [--out probe-out]
 */

import { mkdir, writeFile } from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'probe-out'

const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'accept-language': 'en-IE,en-CA;q=0.9,en;q=0.8',
}

const JSON_HEADERS = {
  'user-agent': BROWSER_HEADERS['user-agent'],
  accept: 'application/json, text/plain, */*',
  'accept-language': BROWSER_HEADERS['accept-language'],
}

const DAY_MS = 24 * 60 * 60 * 1000
const today = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10)
const nowSeconds = Math.floor(Date.now() / 1000)

const DUB = { origin: 'https://www.dublinairport.com', referer: 'https://www.dublinairport.com/' }
const YYZ = { origin: 'https://www.torontopearson.com', referer: 'https://www.torontopearson.com/' }
const PEARSON_LIST = 'https://gtaa-fl-prod.azureedge.net/api/flights/list'

/* Every candidate, with where the idea of it came from. "memory" means it
   was seen in a browser's network tab at some point and may have moved;
   "public code" means a public repository requests it today; "probe" means
   an earlier run of this script found it. */
const PROBES = [
  // Dublin — daa. A Next.js site over a JSON API at api.dublinairport.com,
  // first seen in public code (odinglyn0/eidw-times) and confirmed by probe:
  // {content: [...], pagination: {...}, lastUpdated}, 30 s public cache.
  html('dub-departures-page', 'https://www.dublinairport.com/flight-information/live-departures'),
  json(
    'dub-api-departures-today',
    `https://api.dublinairport.com/dap/flight-listing/departures?date=${today}&limit=200`,
    DUB,
    { full: true },
  ),
  json(
    'dub-api-arrivals-today',
    `https://api.dublinairport.com/dap/flight-listing/arrivals?date=${today}&limit=200`,
    DUB,
    { full: true },
  ),
  json(
    'dub-api-departures-tomorrow',
    `https://api.dublinairport.com/dap/flight-listing/departures?date=${tomorrow}&limit=200`,
    DUB,
    { full: true },
  ),
  json(
    'dub-api-arrivals-tomorrow',
    `https://api.dublinairport.com/dap/flight-listing/arrivals?date=${tomorrow}&limit=200`,
    DUB,
  ),
  // Pagination guesses: the response echoes earliestTimestamp/latestTimestamp
  // and hasPrevious, so the listing is a window that may start at "now".
  json(
    'dub-api-departures-from-midnight',
    `https://api.dublinairport.com/dap/flight-listing/departures?date=${today}&limit=200&earliestTimestamp=${today}T00:00:00.000Z`,
    DUB,
  ),
  json(
    'dub-api-departures-previous',
    `https://api.dublinairport.com/dap/flight-listing/departures?date=${today}&limit=200&direction=previous`,
    DUB,
  ),
  json(
    'dub-api-flight-search',
    `https://api.dublinairport.com/dap/flight-listing/departures?date=${today}&limit=200&search=EI`,
    DUB,
  ),

  // Toronto Pearson — GTAA. The board pages answer with headers too large
  // for Node's default fetch (an earlier probe died on UND_ERR_HEADERS_OVERFLOW),
  // so they go through node:https with a large limit; the CDN endpoint from
  // memory now answers 401, so the page's scripts are read for the header
  // it wants and the endpoint retried with anything they give away.
  html('yyz-departures-page', 'https://www.torontopearson.com/en/departures', { bigHeaders: true }),
  html('yyz-arrivals-page', 'https://www.torontopearson.com/en/arrivals', { bigHeaders: true }),
  json('yyz-cdn-departures', `${PEARSON_LIST}?type=DEP&day=today&useScheduleTimeOnly=false`, YYZ),
  json('yyz-cdn-arrivals', `${PEARSON_LIST}?type=ARR&day=today&useScheduleTimeOnly=false`, YYZ),

  // Regina — Regina Airport Authority. A WordPress page whose theme script
  // fetches the display vendor's public XML feed (found by probe).
  html('yqr-departures-page', 'https://www.yqr.ca/en/passengers/flights/departures'),
  {
    id: 'yqr-simpleway-departures',
    url: 'https://yqr.simpleway.cloud/data-feed/public/departure-web',
    kind: 'xml',
    method: 'GET',
    headers: {
      ...JSON_HEADERS,
      accept: 'application/xml, text/xml, */*',
      referer: 'https://www.yqr.ca/',
    },
    full: true,
  },
  {
    id: 'yqr-simpleway-arrivals',
    url: 'https://yqr.simpleway.cloud/data-feed/public/arrivals-web',
    kind: 'xml',
    method: 'GET',
    headers: {
      ...JSON_HEADERS,
      accept: 'application/xml, text/xml, */*',
      referer: 'https://www.yqr.ca/',
    },
    full: true,
  },

  // Community ADS-B. Positions only — no gates — but an aircraft that has
  // left the ground is the one fact no board can be wrong about. adsb.lol
  // answered without a key; airplanes.live wants an email first; OpenSky
  // allows 400 anonymous calls a day.
  json('adsblol-point-yyz', 'https://api.adsb.lol/v2/point/43.6777/-79.6248/25'),
  json('adsblol-callsign', 'https://api.adsb.lol/v2/callsign/ACA872'),
  json('adsblol-hex-sample', 'https://api.adsb.lol/v2/hex/4caa58'),
  json(
    'opensky-states-yqr',
    'https://opensky-network.org/api/states/all?lamin=50.30&lomin=-104.85&lamax=50.55&lomax=-104.45',
  ),
  json(
    'opensky-departures-eidw',
    `https://opensky-network.org/api/flights/departure?airport=EIDW&begin=${nowSeconds - 6 * 3600}&end=${nowSeconds}`,
  ),
]

function html(id, url, extra = {}) {
  return { id, url, kind: 'html', method: 'GET', headers: BROWSER_HEADERS, ...extra }
}

function json(id, url, extraHeaders = {}, extra = {}) {
  return {
    id,
    url,
    kind: 'json',
    method: 'GET',
    headers: { ...JSON_HEADERS, ...extraHeaders },
    ...extra,
  }
}

const HEADERS_OF_INTEREST = [
  'content-type',
  'content-length',
  'cache-control',
  'age',
  'expires',
  'last-modified',
  'etag',
  'vary',
  'server',
  'via',
  'x-cache',
  'x-azure-ref',
  'cf-ray',
  'cf-cache-status',
  'x-served-by',
  'x-powered-by',
  'access-control-allow-origin',
  'www-authenticate',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-rate-limit-limit',
  'x-rate-limit-remaining',
  'ratelimit-limit',
  'ratelimit-remaining',
  'retry-after',
  'x-robots-tag',
]

const ENDPOINT_HINT =
  /api|flight|json|graphql|feed|fids|azure|sitecore|status|board|arrival|depart/i
const URL_LITERAL =
  /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'`<>)]*)?|(?:^|["'`(])(\/[a-z0-9_./-]*(?:api|flight|json|graphql|feed|fids)[a-z0-9_./?=&%-]*)/gi

/* Code worth quoting from a bundle: where the flight endpoints are called,
   what the statuses are called, and any key that goes in a header. */
const CODE_HINTS = [
  /flight-listing|flights\/list|azureedge|simpleway|data-feed/gi,
  /statusMessage|GO TO GATE|FINAL CALL|GATE CLOSED|BOARDING|LANDED|DEPARTED|CANCELLED|DIVERTED|EXPECTED|useScheduleTimeOnly/g,
  /earliestTimestamp|latestTimestamp|hasNext|hasPrevious|pageSize|direction=/g,
  /Ocp-Apim-Subscription-Key|x-api-key|apikey|subscription[-_]?key|x-functions-key|authorization/gi,
]

const KEY_LITERAL =
  /["'](Ocp-Apim-Subscription-Key|x-api-key|apikey|x-functions-key|subscription-key)["']\s*[:,]\s*["']([A-Za-z0-9._~+/=-]{16,})["']/gi

const started = Date.now()
const summary = []

/* fetch, or node:https when the answer's headers are too big for fetch. Both
   come back in one shape: status, statusText, url, headers.get(), bytes. */
async function fetchOne(probe) {
  const at = Date.now()
  if (probe.bigHeaders) return httpsGet(probe, at)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(probe.url, {
      method: probe.method || 'GET',
      headers: probe.headers,
      body: probe.body,
      redirect: 'follow',
      signal: controller.signal,
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    return {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: response.headers,
      cookies: response.headers.getSetCookie?.() || [],
      bytes,
      ms: Date.now() - at,
    }
  } catch (error) {
    if (/HEADERS_OVERFLOW/.test(String(error?.cause?.code || error?.message))) {
      return httpsGet(probe, at)
    }
    return { error, bytes: Buffer.alloc(0), ms: Date.now() - at }
  } finally {
    clearTimeout(timer)
  }
}

function httpsGet(probe, at, hops = 0) {
  return new Promise(resolve => {
    const request = https.request(
      probe.url,
      {
        method: probe.method || 'GET',
        headers: probe.headers,
        maxHeaderSize: 1 << 20,
        timeout: 30_000,
      },
      response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => {
          const location = response.headers.location
          if ([301, 302, 303, 307, 308].includes(response.statusCode) && location && hops < 5) {
            resolve(
              httpsGet({ ...probe, url: new URL(location, probe.url).toString() }, at, hops + 1),
            )
            return
          }
          const lower = new Map(
            Object.entries(response.headers).map(([k, v]) => [
              k.toLowerCase(),
              Array.isArray(v) ? v.join(', ') : v,
            ]),
          )
          resolve({
            status: response.statusCode,
            statusText: `${response.statusMessage || ''} (node:https, headers ${JSON.stringify(response.headers).length} bytes)`,
            url: probe.url,
            headers: { get: name => lower.get(name.toLowerCase()) ?? null },
            cookies: [].concat(response.headers['set-cookie'] || []),
            bytes: Buffer.concat(chunks),
            ms: Date.now() - at,
          })
        })
      },
    )
    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', error => resolve({ error, bytes: Buffer.alloc(0), ms: Date.now() - at }))
    if (probe.body) request.write(probe.body)
    request.end()
  })
}

function extensionFor(contentType, kind) {
  const type = String(contentType || '').toLowerCase()
  if (type.includes('json')) return 'json'
  if (type.includes('html')) return 'html'
  if (type.includes('xml')) return 'xml'
  if (type.includes('javascript')) return 'js'
  return kind === 'json' ? 'json' : kind === 'xml' ? 'xml' : 'txt'
}

function describeJson(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    return `not JSON (${error.message}); first bytes: ${JSON.stringify(text.slice(0, 300))}`
  }
  const lines = []
  const describe = (node, label) => {
    if (Array.isArray(node)) {
      lines.push(`${label}: array of ${node.length}`)
      if (node.length) {
        lines.push(`${label}[0] keys: ${keysOf(node[0])}`)
        lines.push(`${label}[0]: ${short(node[0])}`)
        if (node.length > 1) lines.push(`${label}[1]: ${short(node[1])}`)
      }
    } else if (node && typeof node === 'object') {
      lines.push(`${label} keys: ${keysOf(node)}`)
      for (const [key, child] of Object.entries(node)) {
        if (Array.isArray(child) && child.length && typeof child[0] === 'object') {
          describe(child, `${label}.${key}`)
        } else if (child && typeof child === 'object' && !Array.isArray(child)) {
          lines.push(`${label}.${key}: ${short(child)}`)
        }
      }
      if (!Object.values(node).some(child => Array.isArray(child) && child.length)) {
        lines.push(`${label}: ${short(node)}`)
      }
    } else {
      lines.push(`${label}: ${short(node)}`)
    }
  }
  describe(value, 'body')
  return lines.join('\n')
}

const keysOf = node =>
  node && typeof node === 'object' ? Object.keys(node).slice(0, 60).join(', ') : typeof node
const short = value => {
  const text = JSON.stringify(value, null, 1) ?? String(value)
  return text.length > 3500 ? `${text.slice(0, 3500)} …(${text.length} chars)` : text
}

function describeHtml(text, baseUrl) {
  const lines = []
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim()
  lines.push(`title: ${title || '(none)'}`)
  const tableRows = (text.match(/<tr\b/gi) || []).length
  lines.push(
    `table rows: ${tableRows}; occurrences of "flight": ${(text.match(/flight/gi) || []).length}`,
  )
  const scripts = [...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m =>
    resolve(m[1], baseUrl),
  )
  lines.push(`scripts (${scripts.length}):`)
  for (const src of scripts.slice(0, 40)) lines.push(`  ${src}`)
  const iframes = [...text.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map(m =>
    resolve(m[1], baseUrl),
  )
  if (iframes.length) lines.push(`iframes: ${iframes.join(' | ')}`)
  const hints = urlHints(text, baseUrl)
  lines.push(`endpoint-looking strings in the page (${hints.length}):`)
  for (const hint of hints.slice(0, 60)) lines.push(`  ${hint}`)
  const inlineJson = [
    ...text.matchAll(
      /<script[^>]+type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]{0,4000}?)<\/script>/gi,
    ),
  ]
  if (inlineJson.length)
    lines.push(`inline JSON blocks: ${inlineJson.length}; first: ${inlineJson[0][1].slice(0, 400)}`)
  const inline = [...text.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .join('\n')
  const quoted = snippets(inline)
  if (quoted.length) {
    lines.push(`inline script, around the interesting words (${quoted.length}):`)
    for (const one of quoted) lines.push(`  … ${one} …`)
  }
  return { text: lines.join('\n'), scripts, hints, inline }
}

function resolve(candidate, baseUrl) {
  try {
    return new URL(candidate, baseUrl).toString()
  } catch {
    return candidate
  }
}

function urlHints(text, baseUrl) {
  const found = new Set()
  for (const match of text.matchAll(URL_LITERAL)) {
    const literal = (match[1] || match[0]).replace(/^["'`(]/, '')
    if (!ENDPOINT_HINT.test(literal)) continue
    if (/\.(?:png|jpe?g|gif|svg|webp|woff2?|ttf|css|ico|mp4)(?:\?|$)/i.test(literal)) continue
    if (
      /googletagmanager|google-analytics|doubleclick|facebook|hotjar|cookielaw|onetrust|fonts\.g|whatsapp|linkedin|ctfassets/i.test(
        literal,
      )
    )
      continue
    found.add(resolve(literal, baseUrl))
    if (found.size >= 300) break
  }
  return [...found]
}

/* The code around the words that matter, deduplicated, bounded. */
function snippets(text, radius = 320, max = 24) {
  const out = []
  const seen = new Set()
  for (const pattern of CODE_HINTS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const start = Math.max(0, match.index - radius)
      const piece = text.slice(start, match.index + match[0].length + radius).replace(/\s+/g, ' ')
      const key = piece.slice(0, 120)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(piece)
      if (out.length >= max) return out
    }
  }
  return out
}

function keysIn(text) {
  const found = []
  for (const match of text.matchAll(KEY_LITERAL)) found.push({ header: match[1], value: match[2] })
  return found
}

async function record(probe) {
  const result = await fetchOne(probe)
  console.log(
    `\n${'='.repeat(78)}\n${probe.id}  ${probe.method || 'GET'} ${probe.url}\n${'='.repeat(78)}`,
  )
  if (result.error) {
    console.log(
      `UNREACHABLE after ${result.ms} ms: ${result.error?.cause?.code || ''} ${result.error?.message}`,
    )
    summary.push({ id: probe.id, status: 'ERR', type: '', bytes: 0, ms: result.ms })
    return null
  }
  const contentType = result.headers.get('content-type') || ''
  console.log(
    `status ${result.status} ${result.statusText}  ${result.ms} ms  ${result.bytes.length} bytes  final url: ${result.url}`,
  )
  for (const name of HEADERS_OF_INTEREST) {
    const value = result.headers.get(name)
    if (value) console.log(`  ${name}: ${String(value).slice(0, 200)}`)
  }
  if (result.cookies.length)
    console.log(`  set-cookie names: ${result.cookies.map(c => c.split('=')[0]).join(', ')}`)
  summary.push({
    id: probe.id,
    status: result.status,
    type: contentType.split(';')[0],
    bytes: result.bytes.length,
    ms: result.ms,
  })

  const text = result.bytes.toString('utf8')
  const ext = extensionFor(contentType, probe.kind)
  await writeFile(path.join(OUT, `${probe.id}.${ext}`), result.bytes)

  if (probe.full && result.status === 200 && text.length <= 120_000) {
    console.log(`FULL BODY (${text.length} chars) >>>`)
    console.log(text)
    console.log('<<< END FULL BODY')
  }
  const trimmed = text.trim()
  if (ext === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    console.log(describeJson(text))
    return { kind: 'json' }
  }
  if (ext === 'html') {
    const described = describeHtml(text, result.url)
    console.log(described.text)
    return { kind: 'html', ...described, baseUrl: result.url }
  }
  if (!probe.full) console.log(`first bytes: ${JSON.stringify(text.slice(0, 1500))}`)
  return { kind: 'text' }
}

/* The scripts an HTML page loads, read for the endpoints the page's own
   JavaScript calls, the words it uses for a status, and any key it carries.
   A bundle is a few megabytes at most; sixteen per page. */
async function readScripts(pageId, scripts, baseUrl) {
  const found = new Set()
  const keys = []
  let read = 0
  for (const src of scripts) {
    if (read >= 16) break
    if (
      /googletagmanager|google-analytics|doubleclick|facebook|hotjar|cookielaw|onetrust|recaptcha|gstatic|jquery/i.test(
        src,
      )
    )
      continue
    read += 1
    const result = await fetchOne({
      id: `${pageId}-script`,
      url: src,
      headers: BROWSER_HEADERS,
      bigHeaders: /torontopearson/.test(src),
    })
    if (result.error || result.status !== 200) {
      console.log(
        `  script ${src}: ${result.error ? `unreachable (${result.error.message})` : result.status}`,
      )
      continue
    }
    if (result.bytes.length > 4_000_000) {
      console.log(`  script ${src}: ${result.bytes.length} bytes, skipped (too large)`)
      continue
    }
    const code = result.bytes.toString('utf8')
    const hints = urlHints(code, baseUrl)
    const quoted = snippets(code)
    console.log(
      `  script ${src}: ${result.bytes.length} bytes, ${hints.length} endpoint-looking strings, ${quoted.length} quotable places`,
    )
    for (const one of quoted) console.log(`    … ${one} …`)
    for (const hint of hints) found.add(hint)
    keys.push(...keysIn(code))
  }
  return { hints: [...found], keys }
}

/* Of everything the page and its scripts mention, the few worth a GET:
   flight-ish JSON or XML on any host. Bounded, and never a page already
   fetched. */
function worthFetching(hints, seen) {
  return hints
    .filter(hint => /^https?:\/\//.test(hint))
    .filter(
      hint =>
        /flight|departure|arrival|fids|board|data-feed/i.test(hint) &&
        /api|json|graphql|feed|fids|azure|xml/i.test(hint),
    )
    .filter(hint => !/\.(?:js|css|html?)(?:\?|$)/i.test(hint))
    .filter(hint => !/oembed|wp-json\/wp\/v2/i.test(hint))
    .filter(hint => !seen.has(hint))
    .slice(0, 10)
}

await mkdir(OUT, { recursive: true })
console.log(`flight source probe — ${new Date().toISOString()} — node ${process.version}`)

const seen = new Set(PROBES.map(probe => probe.url))
const discovered = []
const foundKeys = []
for (const probe of PROBES) {
  const result = await record(probe)
  if (result?.kind === 'html') {
    const fromScripts = await readScripts(probe.id, result.scripts, result.baseUrl)
    const all = [...new Set([...result.hints, ...fromScripts.hints])]
    console.log(`endpoint-looking strings from page + scripts (${all.length}):`)
    for (const hint of all.slice(0, 120)) console.log(`  ${hint}`)
    const keys = [...keysIn(result.inline || ''), ...fromScripts.keys]
    if (keys.length) {
      console.log(`API KEYS IN THE FRONT END (${keys.length}):`)
      for (const one of keys)
        console.log(`  ${one.header}: ${one.value.slice(0, 6)}…(${one.value.length} chars)`)
      foundKeys.push(...keys.map(one => ({ ...one, from: probe.id })))
    }
    for (const url of worthFetching(all, seen)) {
      seen.add(url)
      discovered.push({
        id: `${probe.id}-discovered-${discovered.length + 1}`,
        url,
        kind: 'json',
        method: 'GET',
        headers: {
          ...JSON_HEADERS,
          referer: result.baseUrl,
          origin: new URL(result.baseUrl).origin,
        },
        full: /simpleway|data-feed/.test(url),
      })
    }
  }
}

/* Pearson's endpoint, retried with whatever key the front end gave away,
   under each header name it might be expected in. */
if (foundKeys.length) {
  for (const key of foundKeys.filter(one => /yyz/.test(one.from)).slice(0, 4)) {
    for (const header of new Set([key.header, 'Ocp-Apim-Subscription-Key', 'x-api-key'])) {
      discovered.push({
        id: `yyz-cdn-departures-with-${header.toLowerCase()}-${discovered.length + 1}`,
        url: `${PEARSON_LIST}?type=DEP&day=today&useScheduleTimeOnly=false`,
        kind: 'json',
        method: 'GET',
        headers: { ...JSON_HEADERS, ...YYZ, [header]: key.value },
        full: true,
      })
    }
  }
}

if (discovered.length) {
  console.log(`\n${'#'.repeat(78)}\nDISCOVERED ENDPOINTS (${discovered.length})\n${'#'.repeat(78)}`)
  for (const probe of discovered) await record(probe)
}

console.log(
  `\n${'#'.repeat(78)}\nSUMMARY (${Math.round((Date.now() - started) / 1000)} s)\n${'#'.repeat(78)}`,
)
for (const row of summary) {
  console.log(
    `${String(row.status).padEnd(5)} ${String(row.bytes).padStart(9)} B ${String(row.ms).padStart(6)} ms  ${row.type.padEnd(24)} ${row.id}`,
  )
}
await writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
