import { createServer } from 'node:http'
import { createS3FileStore } from '../src/s3-store.js'

/* An object store made of a Map. It is deliberately strict about the things
   that are easy to get wrong and invisible when you do — an unsigned request,
   a range ignored — so the test fails here rather than against a real bucket
   at three in the morning. */
export async function stubStore(t) {
  const objects = new Map()
  const seen = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const key = decodeURIComponent(request.url.split('?')[0].replace(/^\/[^/]+\//, ''))
    seen.push({
      method: request.method,
      key,
      auth: request.headers.authorization,
      contentType: request.headers['content-type'],
    })

    if (!request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=')) {
      response.writeHead(403).end('unsigned')
      return
    }
    /* The bucket listing, which is the only way to find everything under a
       prefix on a store that has no directories. Paged deliberately small, so
       the continuation the client has to follow is exercised rather than
       assumed. */
    const query = new URLSearchParams(request.url.split('?')[1] || '')
    if (request.method === 'GET' && query.get('list-type') === '2') {
      const prefix = query.get('prefix') || ''
      const all = [...objects.keys()].filter(name => name.startsWith(prefix)).sort()
      /* Continuation by key, which is what S3 does: the token names the last
         thing handed over and the next page starts after it. Paged two at a
         time so the client has to follow it rather than being handed
         everything and appearing to work. */
      const after = query.get('continuation-token')
      const rest = after ? all.filter(name => name > after) : all
      const size = Math.min(Number(query.get('max-keys')) || 1000, 2)
      const page = rest.slice(0, size)
      const more = rest.length > size
      response
        .writeHead(200, { 'content-type': 'application/xml' })
        .end(
          `<?xml version="1.0"?><ListBucketResult>${page
            .map(name => `<Contents><Key>${name}</Key></Contents>`)
            .join('')}<IsTruncated>${more}</IsTruncated>${
            more ? `<NextContinuationToken>${page[page.length - 1]}</NextContinuationToken>` : ''
          }</ListBucketResult>`,
        )
      return
    }
    if (request.method === 'PUT') {
      objects.set(key, body)
      response.writeHead(200).end()
    } else if (request.method === 'DELETE') {
      objects.delete(key)
      response.writeHead(204).end()
    } else if (request.method === 'HEAD') {
      const held = objects.get(key)
      if (!held && key) return response.writeHead(404).end()
      response.writeHead(200, { 'content-length': String(held ? held.length : 0) }).end()
    } else {
      const held = objects.get(key)
      if (!held) return response.writeHead(404).end()
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '')
      if (!range) return response.writeHead(200).end(held)
      const start = range[1] === '' ? held.length - Number(range[2]) : Number(range[1])
      const end = range[1] === '' || range[2] === '' ? held.length - 1 : Number(range[2])
      response
        .writeHead(206, { 'content-range': `bytes ${start}-${end}/${held.length}` })
        .end(held.subarray(start, end + 1))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const store = createS3FileStore({
    bucket: 'trips',
    region: 'auto',
    endpoint: `http://127.0.0.1:${server.address().port}`,
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    forcePathStyle: true,
  })
  return { store, objects, seen }
}
