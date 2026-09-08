/* Signature Version 4, by hand.

   The alternative was ~15MB of AWS SDK to make a handful of PUTs and GETs
   against an S3-compatible endpoint. This is the whole protocol in a page,
   it has no dependencies to keep current, and — because it is pure — it can
   be checked against Amazon's own published test vectors rather than against
   whatever a live bucket happens to accept today.

   Deliberately generic: R2, B2, MinIO and S3 all speak this. */

import { createHash, createHmac } from 'node:crypto'

const sha256Hex = value => createHash('sha256').update(value).digest('hex')
const hmac = (key, value) => createHmac('sha256', key).update(value).digest()

/** `20150830T123600Z` and `20150830`, which SigV4 wants in both shapes. */
export function stamps(date) {
  const iso = date.toISOString().replace(/[-:]|\.\d{3}/g, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

/* Every segment encoded, but the slashes between them left alone — S3 keys
   are paths, and encodeURIComponent would turn each separator into %2F and
   sign a different object than the one requested. */
export const encodeKey = key =>
  String(key)
    .split('/')
    .map(segment =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/')

/**
 * The Authorization header (and the headers it covers) for one request.
 * @returns {{ headers: Record<string,string> }}
 */
export function signRequest({
  method,
  url,
  headers = {},
  payloadHash,
  accessKeyId,
  secretAccessKey,
  sessionToken = null,
  region,
  service = 's3',
  date = new Date(),
}) {
  const target = url instanceof URL ? url : new URL(url)
  const { amzDate, dateStamp } = stamps(date)

  const signed = {
    ...headers,
    host: target.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
  }
  /* Header names lowercased and ordered, values trimmed and inner runs of
     whitespace collapsed — the canonical form both ends must agree on
     exactly, or the signature differs for no visible reason. */
  const canonicalHeaders = Object.keys(signed)
    .map(name => name.toLowerCase())
    .sort()
    .map(name => {
      const value = String(signed[Object.keys(signed).find(k => k.toLowerCase() === name)] ?? '')
      return `${name}:${value.trim().replace(/\s+/g, ' ')}\n`
    })
    .join('')
  const signedHeaders = Object.keys(signed)
    .map(name => name.toLowerCase())
    .sort()
    .join(';')

  // Query parameters are sorted by name, then by value, both encoded.
  const canonicalQuery = [...target.searchParams.entries()]
    .map(([name, value]) => [encodeURIComponent(name), encodeURIComponent(value)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(pair => pair.join('='))
    .join('&')

  const canonicalRequest = [
    method.toUpperCase(),
    target.pathname || '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  /* The signing key is derived down the scope, so a leaked daily key is
     useless tomorrow and useless for another region or service. */
  const signingKey = ['aws4_request'].reduce(
    (key, part) => hmac(key, part),
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return {
    canonicalRequest,
    stringToSign,
    signature,
    headers: {
      ...signed,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  }
}

/** The hash S3 wants when the body is not being hashed up front. */
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'
export const EMPTY_SHA256 = sha256Hex('')
export { sha256Hex }
