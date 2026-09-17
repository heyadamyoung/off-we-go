/* A fetch for the boards that Node's fetch cannot read.
 *
 * torontopearson.com answers with seventeen kilobytes of headers, which is
 * past the sixteen the built-in fetch allows, and its bot manager sets
 * cookies on the first answer that it expects back on the second — and
 * sends a browser that fails that test to a captcha page on another host.
 *
 * So: node:https with a generous header budget, a cookie jar per host, and
 * no redirect followed. A redirect off the host is the challenge, and it is
 * reported as one rather than parsed as a board. The shape returned is the
 * slice of fetch's Response the providers use, so a test can hand in a
 * plain async function instead. */

import https from 'node:https'

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'

export function createBoardHttp({
  maxHeaderSize = 1 << 20,
  timeoutMs = 30_000,
  userAgent = BROWSER_UA,
} = {}) {
  const jar = new Map()

  const remember = (host, cookies) => {
    const held = jar.get(host) || new Map()
    for (const cookie of cookies) {
      const [pair] = String(cookie).split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) held.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
    jar.set(host, held)
  }
  const cookieHeader = host => {
    const held = jar.get(host)
    return held?.size ? [...held].map(([k, v]) => `${k}=${v}`).join('; ') : null
  }

  return function boardFetch(url, { method = 'GET', headers = {} } = {}) {
    const target = new URL(url)
    const cookie = cookieHeader(target.host)
    return new Promise((resolve, reject) => {
      const request = https.request(
        target,
        {
          method,
          headers: {
            'user-agent': userAgent,
            'accept-language': 'en-CA,en;q=0.9',
            ...headers,
            ...(cookie ? { cookie } : {}),
          },
          maxHeaderSize,
          timeout: timeoutMs,
        },
        response => {
          const chunks = []
          response.on('data', chunk => chunks.push(chunk))
          response.on('end', () => {
            remember(target.host, [].concat(response.headers['set-cookie'] || []))
            const status = response.statusCode || 0
            const location = response.headers.location || null
            const body = Buffer.concat(chunks)
            const lower = new Map(
              Object.entries(response.headers).map(([k, v]) => [
                k.toLowerCase(),
                Array.isArray(v) ? v.join(', ') : v,
              ]),
            )
            const challenged =
              status >= 300 && status < 400 && !!location && !location.startsWith(target.origin)
            resolve({
              ok: status >= 200 && status < 300,
              status,
              url: target.toString(),
              location,
              challenged,
              headers: { get: name => lower.get(String(name).toLowerCase()) ?? null },
              text: async () => body.toString('utf8'),
              json: async () => JSON.parse(body.toString('utf8')),
            })
          })
        },
      )
      request.on('timeout', () => request.destroy(new Error(`timed out after ${timeoutMs} ms`)))
      request.on('error', reject)
      request.end()
    })
  }
}
