#!/usr/bin/env node
/* What the airports actually serve, looked at rather than assumed.
 *
 * Run from a machine with open internet (the GitHub Actions runner; the
 * development sandbox cannot reach any of these hosts). For every candidate
 * source it records the status, the headers that say how the response is
 * cached and rate-limited, the shape of the body, and a couple of records —
 * then reads the scripts behind a board page and quotes the code around
 * anything that looks like a flight endpoint, a field name or a status
 * vocabulary, so a parser can be written against what the page itself
 * reads. Feeds small enough to be fixtures are printed whole. The full
 * bodies go to probe-out/ for the artifact.
 *
 * It reads what a browser is served and nothing else: no credential is
 * looked for, extracted or used. A board that wants one is reported as
 * wanting one, and the door for that is the airport's own developer
 * programme.
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

const DUB = { origin: 'https://www.dublinairport.com', referer: 'https://www.dublinairport.com/' }
const DUB_LISTING = 'https://api.dublinairport.com/dap/flight-listing'
const YYZ = { origin: 'https://www.torontopearson.com', referer: 'https://www.torontopearson.com/' }
const PEARSON_LIST = 'https://gtaa-fl-prod.azureedge.net/api/flights/list'

/* Every candidate, with where the idea of it came from. "memory" means it
   was seen in a browser's network tab at some point and may have moved;
   "public code" means a public repository requests it today; "probe" means
   an earlier run of this script found it. */
const PROBES = [
  // Dublin — daa. A Next.js site over a JSON API at api.dublinairport.com.
  // Its listing component (quoted whole by an earlier run) builds
  // ?date=&limit=10, turns the page with after=<latestTimestamp> and
  // after-id=<latestId> (before/before-id the other way), narrows with
  // terminal=T1|T2 and filter=<text>; the API refuses limit above 200.
  json('dub-departures-today', `${DUB_LISTING}/departures?date=${today}&limit=200`, DUB, {
    full: true,
    pageOn: 'departures',
  }),
  json('dub-arrivals-today', `${DUB_LISTING}/arrivals?date=${today}&limit=200`, DUB, {
    full: true,
  }),
  json(
    'dub-departures-filter',
    `${DUB_LISTING}/departures?date=${tomorrow}&limit=200&filter=EI`,
    DUB,
  ),
  json(
    'dub-departures-filter-number',
    `${DUB_LISTING}/departures?date=${tomorrow}&limit=200&filter=FR457`,
    DUB,
  ),
  json(
    'dub-departures-filter-spaced',
    `${DUB_LISTING}/departures?date=${tomorrow}&limit=200&filter=${encodeURIComponent('FR 457')}`,
    DUB,
  ),
  json(
    'dub-departures-filter-digits',
    `${DUB_LISTING}/departures?date=${tomorrow}&limit=200&filter=457`,
    DUB,
  ),
  json(
    'dub-departures-filter-city',
    `${DUB_LISTING}/departures?date=${tomorrow}&limit=200&filter=Leeds`,
    DUB,
  ),
  json(
    'dub-departures-terminal',
    `${DUB_LISTING}/departures?date=${tomorrow}&limit=200&terminal=T2`,
    DUB,
  ),
  json('dub-search-bff', 'https://api.dublinairport.com/dap/search?q=FR457', DUB, { full: true }),

  // Toronto Pearson — GTAA. Its real-time-data chunk (read by an earlier
  // run) calls the site's own origin, not the CDN host: /api/flightsapidata/
  // getflightlist?type=DEP|ARR&day=today&useScheduleTimeOnly=false answers
  // {list: [...]}, getflightsearch?term= and getflightsearchbykey?flightkey=
  // beside it. Asked first in the run, as a browser on the departures page
  // would, because the bot manager challenges a second visit.
  ...['DEP', 'ARR'].map(type => ({
    id: `yyz-site-list-${type.toLowerCase()}`,
    url: `https://www.torontopearson.com/api/flightsapidata/getflightlist?type=${type}&day=today&useScheduleTimeOnly=false`,
    kind: 'json',
    method: 'GET',
    headers: {
      ...JSON_HEADERS,
      referer: 'https://www.torontopearson.com/en/departures',
      'x-requested-with': 'XMLHttpRequest',
    },
    bigHeaders: true,
    full: true,
  })),
  {
    id: 'yyz-site-search',
    url: 'https://www.torontopearson.com/api/flightsapidata/getflightsearch?term=AC872',
    kind: 'json',
    method: 'GET',
    headers: { ...JSON_HEADERS, referer: 'https://www.torontopearson.com/en/departures' },
    bigHeaders: true,
    full: true,
  },
  json('yyz-cdn-departures', `${PEARSON_LIST}?type=DEP&day=today&useScheduleTimeOnly=false`, YYZ),

  // Regina — Regina Airport Authority. A WordPress page whose theme script
  // fetches the display vendor's public XML feed (found by probe).
  xml('yqr-simpleway-departures', 'https://yqr.simpleway.cloud/data-feed/public/departure-web'),
  xml('yqr-simpleway-arrivals', 'https://yqr.simpleway.cloud/data-feed/public/arrivals-web'),
]

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

function xml(id, url) {
  return {
    id,
    url,
    kind: 'xml',
    method: 'GET',
    headers: {
      ...JSON_HEADERS,
      accept: 'application/xml, text/xml, */*',
      referer: 'https://www.yqr.ca/',
    },
    full: true,
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

/* Code worth quoting from a bundle: where the flight endpoints are called,
   what the fields are called, what the statuses are called. */
const CODE_HINTS = [
  /flight-listing\/|flights\/list|azureedge|simpleway|data-feed|waittimeapidata|gtaa/gi,
  /useScheduleTimeOnly|carousel|codeshare|latestTm|schedTm|"routes"|"terminal"|"gate"/g,
  /GO TO GATE|FINAL CALL|GATE CLOSED|NOW BOARDING|LANDED|DEPARTED|CANCELLED|DIVERTED/g,
]

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
  return kind === 'json' ? 'json' : kind === 'xml' ? 'xml' : kind === 'js' ? 'js' : 'txt'
}

function describeJson(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    return {
      text: `not JSON (${error.message}); first bytes: ${JSON.stringify(text.slice(0, 300))}`,
    }
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
  return { text: lines.join('\n'), value }
}

const keysOf = node =>
  node && typeof node === 'object' ? Object.keys(node).slice(0, 60).join(', ') : typeof node
const short = value => {
  const text = JSON.stringify(value, null, 1) ?? String(value)
  return text.length > 3500 ? `${text.slice(0, 3500)} …(${text.length} chars)` : text
}

/* The code around the words that matter, deduplicated, bounded. */
function snippets(text, radius = 360, max = 40) {
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

const pages = []

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
  if (result.cookies.length) {
    console.log(`  set-cookie names: ${result.cookies.map(c => c.split('=')[0]).join(', ')}`)
  }
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
  if (probe.quote && result.status === 200) {
    const quoted = snippets(text)
    console.log(`${quoted.length} quotable places:`)
    for (const one of quoted) console.log(`    … ${one} …`)
    return { kind: 'js' }
  }
  const trimmed = text.trim()
  if (ext === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const described = describeJson(text)
    console.log(described.text)
    if (probe.pageOn && described.value?.pagination) pages.push({ probe, body: described.value })
    return { kind: 'json', value: described.value }
  }
  if (!probe.full) console.log(`first bytes: ${JSON.stringify(text.slice(0, 1500))}`)
  return { kind: 'text' }
}

await mkdir(OUT, { recursive: true })
console.log(`flight source probe — ${new Date().toISOString()} — node ${process.version}`)

for (const probe of PROBES) await record(probe)

/* Dublin, turned a page each way with the names its listing uses, and one
   flight looked up by the id its listing gives. */
const followUps = []
for (const { probe, body } of pages) {
  const { pagination, content } = body
  if (pagination.hasNext && pagination.latestTimestamp) {
    followUps.push(
      json(
        `${probe.id}-next-page`,
        `${DUB_LISTING}/${probe.pageOn}?date=${today}&limit=200&after=${encodeURIComponent(pagination.latestTimestamp)}&after-id=${pagination.latestId}`,
        DUB,
      ),
    )
  }
  if (pagination.hasPrevious && pagination.earliestTimestamp) {
    followUps.push(
      json(
        `${probe.id}-previous-page`,
        `${DUB_LISTING}/${probe.pageOn}?date=${today}&limit=200&before=${encodeURIComponent(pagination.earliestTimestamp)}&before-id=${pagination.earliestId}`,
        DUB,
        { full: true },
      ),
    )
  }
  const id = content?.[0]?.internalFlightId
  if (id) {
    followUps.push(
      json(`${probe.id}-single-by-id`, `${DUB_LISTING}/${encodeURIComponent(id)}`, DUB),
      json(
        `${probe.id}-single-by-path`,
        `${DUB_LISTING}/${probe.pageOn}/${encodeURIComponent(id)}`,
        DUB,
      ),
      json(
        `${probe.id}-single-by-query`,
        `${DUB_LISTING}/${probe.pageOn}?date=${today}&limit=200&filter=${encodeURIComponent(id.split('-')[0])}`,
        DUB,
      ),
    )
  }
}

if (followUps.length) {
  console.log(`\n${'#'.repeat(78)}\nFOLLOW-UPS (${followUps.length})\n${'#'.repeat(78)}`)
  for (const probe of followUps) await record(probe)
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
