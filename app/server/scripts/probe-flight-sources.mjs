#!/usr/bin/env node
/* What the airports actually serve, looked at rather than assumed.
 *
 * Run from a machine with open internet (the GitHub Actions runner; the
 * development sandbox cannot reach any of these hosts). For every candidate
 * source it records the status, the headers that say how the response is
 * cached and rate-limited, the shape of the body, and a couple of records —
 * then, for an HTML page, reads the scripts the page loads and lists every
 * URL-ish string in them that looks like a flight endpoint, and fetches the
 * likeliest of those too. The full bodies go to probe-out/ for the artifact.
 *
 * Nothing here is a parser. A parser is written against what this prints,
 * and not before.
 *
 *   node server/scripts/probe-flight-sources.mjs [--out probe-out]
 */

import { mkdir, writeFile } from 'node:fs/promises'
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

const today = new Date().toISOString().slice(0, 10)
const nowSeconds = Math.floor(Date.now() / 1000)

/* Every candidate, with where the idea of it came from. "memory" means it
   was seen in a browser's network tab at some point and may have moved;
   "public code" means a public repository requests it today. */
const PROBES = [
  // Dublin — daa. The site is a JavaScript application; a public repository
  // (odinglyn0/eidw-times) polls api.dublinairport.com/dap/... as JSON with
  // an Origin header, which is what the site's own front end would send.
  html('dub-departures-page', 'https://www.dublinairport.com/flight-information/live-departures'),
  html('dub-arrivals-page', 'https://www.dublinairport.com/flight-information/live-arrivals'),
  json(
    'dub-api-departures',
    `https://api.dublinairport.com/dap/flight-listing/departures?date=${today}&limit=200`,
    { origin: 'https://www.dublinairport.com', referer: 'https://www.dublinairport.com/' },
  ),
  json(
    'dub-api-arrivals',
    `https://api.dublinairport.com/dap/flight-listing/arrivals?date=${today}&limit=200`,
    { origin: 'https://www.dublinairport.com', referer: 'https://www.dublinairport.com/' },
  ),
  json('dub-api-security-times', 'https://api.dublinairport.com/dap/get-security-times', {
    origin: 'https://www.dublinairport.com',
    referer: 'https://www.dublinairport.com/',
  }),

  // Toronto Pearson — GTAA. The board pages are a JavaScript application;
  // the Azure CDN endpoint is from memory of the site's network traffic.
  html('yyz-departures-page', 'https://www.torontopearson.com/en/departures'),
  html('yyz-arrivals-page', 'https://www.torontopearson.com/en/arrivals'),
  json(
    'yyz-cdn-departures',
    'https://gtaa-fl-prod.azureedge.net/api/flights/list?type=DEP&day=today&useScheduleTimeOnly=false',
    { origin: 'https://www.torontopearson.com', referer: 'https://www.torontopearson.com/' },
  ),
  json(
    'yyz-cdn-arrivals',
    'https://gtaa-fl-prod.azureedge.net/api/flights/list?type=ARR&day=today&useScheduleTimeOnly=false',
    { origin: 'https://www.torontopearson.com', referer: 'https://www.torontopearson.com/' },
  ),

  // Regina — Regina Airport Authority. Search results name these pages and
  // an older "view=flightinfo" query string that smells of a FIDS vendor.
  html('yqr-departures-page', 'https://www.yqr.ca/en/passengers/flights/departures'),
  html('yqr-arrivals-page', 'https://www.yqr.ca/en/passengers/flights/arrivals'),
  html(
    'yqr-legacy-flightinfo',
    'https://yqr.ca/en/traveller-info/flight-information/arrivals-departures?arrival-depart=1&device=xhtml&id=1&view=flightinfo',
  ),

  // Community ADS-B. Positions only — no gates — but an aircraft that has
  // left the ground is the one fact no board can be wrong about.
  json('adsblol-point-dub', 'https://api.adsb.lol/v2/point/53.4213/-6.2701/25'),
  json('adsblol-point-yyz', 'https://api.adsb.lol/v2/point/43.6777/-79.6248/25'),
  json('adsblol-point-yqr', 'https://api.adsb.lol/v2/point/50.4319/-104.6658/25'),
  {
    id: 'adsblol-routeset',
    url: 'https://api.adsb.lol/api/0/routeset',
    kind: 'json',
    method: 'POST',
    headers: { ...JSON_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({
      planes: [
        { callsign: 'ACA872', lat: 43.68, lng: -79.62 },
        { callsign: 'EIN123', lat: 53.42, lng: -6.27 },
      ],
    }),
  },
  json('airplaneslive-point-dub', 'https://api.airplanes.live/v2/point/53.4213/-6.2701/25'),
  json(
    'opensky-states-dub',
    'https://opensky-network.org/api/states/all?lamin=53.30&lomin=-6.55&lamax=53.55&lomax=-6.05',
  ),
  json(
    'opensky-arrivals-eidw',
    `https://opensky-network.org/api/flights/arrival?airport=EIDW&begin=${nowSeconds - 3 * 3600}&end=${nowSeconds}`,
  ),

  // Airline status pages, for the status code alone: whether a datacentre
  // address gets a page or a bot wall decides if they are worth a parser.
  html('aircanada-status-page', 'https://www.aircanada.com/ca/en/aco/home/fly/flight-status.html'),
  html('westjet-status-page', 'https://www.westjet.com/en-ca/flight-status'),
]

function html(id, url) {
  return { id, url, kind: 'html', method: 'GET', headers: BROWSER_HEADERS }
}

function json(id, url, extra = {}) {
  return { id, url, kind: 'json', method: 'GET', headers: { ...JSON_HEADERS, ...extra } }
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
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-rate-limit-limit',
  'x-rate-limit-remaining',
  'x-rate-limit-retry-after-seconds',
  'ratelimit-limit',
  'ratelimit-remaining',
  'retry-after',
  'x-robots-tag',
]

const ENDPOINT_HINT =
  /api|flight|json|graphql|feed|fids|azure|sitecore|status|board|arrival|depart/i
const URL_LITERAL =
  /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'`<>)]*)?|(?:^|["'`(])(\/[a-z0-9_./-]*(?:api|flight|json|graphql|feed|fids)[a-z0-9_./?=&%-]*)/gi

const started = Date.now()
const summary = []

async function fetchOne(probe) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  const at = Date.now()
  try {
    const response = await fetch(probe.url, {
      method: probe.method || 'GET',
      headers: probe.headers,
      body: probe.body,
      redirect: 'follow',
      signal: controller.signal,
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    return { response, bytes, ms: Date.now() - at, error: null }
  } catch (error) {
    return { response: null, bytes: Buffer.alloc(0), ms: Date.now() - at, error }
  } finally {
    clearTimeout(timer)
  }
}

function extensionFor(contentType, kind) {
  const type = String(contentType || '').toLowerCase()
  if (type.includes('json')) return 'json'
  if (type.includes('html')) return 'html'
  if (type.includes('xml')) return 'xml'
  if (type.includes('javascript')) return 'js'
  return kind === 'json' ? 'json' : 'txt'
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
          lines.push(`${label}.${key} keys: ${keysOf(child)}`)
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
  const flightish = (text.match(/flight/gi) || []).length
  lines.push(`table rows: ${tableRows}; occurrences of "flight": ${flightish}`)
  lines.push(
    `server-rendered flight rows: ${/\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{2,4}\b/.test(stripTags(text).slice(0, 200_000)) ? 'possibly (flight-number-like text present)' : 'no flight-number-like text'}`,
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
  for (const hint of hints.slice(0, 80)) lines.push(`  ${hint}`)
  const inlineJson = [
    ...text.matchAll(
      /<script[^>]+type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]{0,4000}?)<\/script>/gi,
    ),
  ]
  if (inlineJson.length)
    lines.push(`inline JSON blocks: ${inlineJson.length}; first: ${inlineJson[0][1].slice(0, 600)}`)
  return { text: lines.join('\n'), scripts, hints }
}

const stripTags = text => text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')

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
      /googletagmanager|google-analytics|doubleclick|facebook|hotjar|cookielaw|onetrust|fonts\.g/i.test(
        literal,
      )
    )
      continue
    found.add(resolve(literal, baseUrl))
    if (found.size >= 300) break
  }
  return [...found]
}

async function record(probe) {
  const { response, bytes, ms, error } = await fetchOne(probe)
  const heading = `\n${'='.repeat(78)}\n${probe.id}  ${probe.method || 'GET'} ${probe.url}\n${'='.repeat(78)}`
  console.log(heading)
  if (!response) {
    console.log(`UNREACHABLE after ${ms} ms: ${error?.cause?.code || ''} ${error?.message}`)
    summary.push({ id: probe.id, status: 'ERR', type: '', bytes: 0, ms })
    return null
  }
  const contentType = response.headers.get('content-type') || ''
  console.log(
    `status ${response.status} ${response.statusText}  ${ms} ms  ${bytes.length} bytes  final url: ${response.url}`,
  )
  for (const name of HEADERS_OF_INTEREST) {
    const value = response.headers.get(name)
    if (value) console.log(`  ${name}: ${value.slice(0, 200)}`)
  }
  const cookies = response.headers.getSetCookie?.() || []
  if (cookies.length)
    console.log(`  set-cookie names: ${cookies.map(c => c.split('=')[0]).join(', ')}`)
  summary.push({
    id: probe.id,
    status: response.status,
    type: contentType.split(';')[0],
    bytes: bytes.length,
    ms,
  })

  const text = bytes.toString('utf8')
  const ext = extensionFor(contentType, probe.kind)
  await writeFile(path.join(OUT, `${probe.id}.${ext}`), bytes)

  if (
    ext === 'json' ||
    (probe.kind === 'json' && text.trim().startsWith('{')) ||
    text.trim().startsWith('[')
  ) {
    console.log(describeJson(text))
    return { kind: 'json' }
  }
  if (ext === 'html') {
    const described = describeHtml(text, response.url)
    console.log(described.text)
    return { kind: 'html', ...described, baseUrl: response.url }
  }
  console.log(`first bytes: ${JSON.stringify(text.slice(0, 1500))}`)
  return { kind: 'text' }
}

/* The scripts an HTML page loads, read for the endpoints the page's own
   JavaScript calls. A bundle is a few megabytes at most; twelve per page. */
async function readScripts(pageId, scripts, baseUrl) {
  const found = new Set()
  let read = 0
  for (const src of scripts) {
    if (read >= 12) break
    if (
      /googletagmanager|google-analytics|doubleclick|facebook|hotjar|cookielaw|onetrust|recaptcha|gstatic/i.test(
        src,
      )
    )
      continue
    read += 1
    const { response, bytes, error } = await fetchOne({
      id: `${pageId}-script`,
      url: src,
      headers: BROWSER_HEADERS,
    })
    if (!response || !response.ok) {
      console.log(
        `  script ${src}: ${response ? response.status : `unreachable (${error?.message})`}`,
      )
      continue
    }
    if (bytes.length > 4_000_000) {
      console.log(`  script ${src}: ${bytes.length} bytes, skipped (too large)`)
      continue
    }
    const hints = urlHints(bytes.toString('utf8'), baseUrl)
    console.log(`  script ${src}: ${bytes.length} bytes, ${hints.length} endpoint-looking strings`)
    for (const hint of hints) found.add(hint)
  }
  return [...found]
}

/* Of everything the page and its scripts mention, the few worth a GET:
   flight-ish JSON on any host. Bounded, and never a page we already fetched. */
function worthFetching(hints, seen) {
  return hints
    .filter(hint => /^https?:\/\//.test(hint))
    .filter(
      hint =>
        /flight|departure|arrival|fids|board/i.test(hint) &&
        /api|json|graphql|feed|fids|azure/i.test(hint),
    )
    .filter(hint => !/\.(?:js|css|html?)(?:\?|$)/i.test(hint))
    .filter(hint => !seen.has(hint))
    .slice(0, 10)
}

await mkdir(OUT, { recursive: true })
console.log(`flight source probe — ${new Date().toISOString()} — node ${process.version}`)

const seen = new Set(PROBES.map(probe => probe.url))
const discovered = []
for (const probe of PROBES) {
  const result = await record(probe)
  if (result?.kind === 'html') {
    const fromScripts = await readScripts(probe.id, result.scripts, result.baseUrl)
    const all = [...new Set([...result.hints, ...fromScripts])]
    console.log(`endpoint-looking strings from page + scripts (${all.length}):`)
    for (const hint of all.slice(0, 120)) console.log(`  ${hint}`)
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
