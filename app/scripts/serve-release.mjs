/* Serves dist/client the way Caddy serves /srv in production: the file if it
   exists, the prerendered index.html otherwise. `vite preview` server-renders
   the page instead, which is a shape of HTML the deployed app never sends —
   the browser suite would rather test the artifact that actually ships. */
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(process.argv[2] || 'dist/client')
const port = Number(process.env.PORT || process.argv[3] || 4180)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

async function file(pathname) {
  // resolve() then a prefix check, so a request for /../ cannot escape the root.
  const candidate = join(root, normalize(pathname))
  if (!candidate.startsWith(root)) return null
  try {
    return (await stat(candidate)).isFile() ? candidate : null
  } catch {
    return null
  }
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost')
  const found = (await file(pathname)) || (await file('/index.html'))
  if (!found) {
    response.writeHead(404).end('not found')
    return
  }
  response.writeHead(200, { 'content-type': TYPES[extname(found)] || 'application/octet-stream' })
  createReadStream(found).pipe(response)
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`))
