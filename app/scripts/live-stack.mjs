/* The app talking to a real server, which the browser suite has never done.

   Every existing browser test runs against the sample trip, and the sample
   trip has no backend: `uploadPhoto` short-circuits into an in-memory array
   and hands back an object URL. So the suite proves a film can be chosen,
   drawn from and played — all of it inside one tab, with nothing crossing
   the wire. The server suite proves the other half, posting its own multipart
   with `fetch`. Both halves are covered and the join between them is not, and
   the join is where "I am not sure videos actually upload" lives.

   This is that join: the real bundle, signed in, posting the multipart its
   own code builds, to a real Fastify with a real converter behind it.

   It is deliberately its own command rather than another entry in the default
   config. That config's web server builds with VITE_API_URL cleared, and this
   one has to build with it set — two builds of the same tree at once race over
   public/, so they take turns instead.

   Nothing here ships. server/Dockerfile copies server/ alone, and the web
   image takes one named file out of scripts/, so this runs on a developer's
   machine and on CI and nowhere else. */
import { spawn } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { buildServer } from '../server/src/app.js'
import { createDiskFileStore } from '../server/src/files.js'
import { createMediaWorker } from '../server/src/media-worker.js'
import { createMemoryRepository } from '../server/test/memory-repository.js'

const webPort = Number(process.env.LIVE_WEB_PORT || 4190)
const apiPort = Number(process.env.LIVE_API_PORT || 4191)
const webOrigin = `http://localhost:${webPort}`
const apiOrigin = `http://localhost:${apiPort}`
/* What the tests call, and what the bundle is built with, are deliberately
   different spellings of the same place: the bundle gets `/api` verbatim, as
   docker-compose gives it, so the browser is same-origin exactly as in
   production; the tests, running outside the browser, need it absolute.

   The suffix matters either way — the client's baseUrl is `API_URL || '/api'`
   verbatim, so a bare origin puts every call one segment too high and the
   trip simply 404s. */
const apiBase = `${webOrigin}/api`
const root = resolve(import.meta.dirname, '..')
const owner = 'owner@example.com'

const run = (command, args, env) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  return once(child, 'exit').then(([code]) => {
    if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited ${code}`)
  })
}

const media = await mkdtemp(join(tmpdir(), 'offwego-live-'))
const repository = createMemoryRepository({ allowedEmails: [owner] })

/* publicUrl is the origin the API will accept cross-origin calls from, and
   the browser is about to call it from exactly there. Get this wrong and
   every request dies in preflight with nothing in the server log. */
const fileStore = createDiskFileStore({ directory: media })
const app = await buildServer({
  repository,
  fileStore,
  mailer: { async send() {} },
  publicUrl: webOrigin,
  sessionSecret: 'live-stack-secret-that-is-long-enough',
  transcoding: true,
})
await app.listen({ host: '127.0.0.1', port: apiPort })

/* The converter, running rather than pumped by hand. A film uploaded here
   lands 'pending' and becomes 'ready' on its own, which is the behaviour the
   grid is being asked about. */
const worker = createMediaWorker({
  repository,
  fileStore,
  logger: app.log,
  onFinished: job => app.announceMediaReady?.(job),
})
worker.start()

const user = await repository.ensureUser(owner)
const accessToken = randomBytes(32).toString('base64url')
await repository.createSession({
  hash: createHash('sha256').update(accessToken).digest('hex'),
  userId: user.id,
  expiresAt: new Date('2100-01-01T00:00:00.000Z'),
})
/* A trip with dates of its own, unlike the sample — whose stops say September
   while its range floats around today, on purpose, so that nothing on it can
   ever be placed on a date. Every browser test runs against that, which means
   the path a real trip takes once its days are dates was never drawn in a
   browser at all. This is that trip. */
const TRIP_DAYS = { startsOn: '2026-09-03', endsOn: '2026-09-10' }
const trip = await repository.createTrip(user, { title: 'Live stack', ...TRIP_DAYS })

/* Two stops, a kilometre or so apart: far enough that "nearest wins" has
   something to decide, and that somewhere between them belongs to neither.

   Their days are spelled the four ways the database actually holds them — a
   date from the picker, the label the app used to write, a label whose weekday
   is stale, and the bare number somebody typed before there was anywhere to
   pick. Three of these are the fourth of September and must come out as one
   day, not four. */
const stops = []
for (const stop of [
  { name: 'Anne Frank House', lng: 4.8839, lat: 52.3752, day: '2026-09-04' },
  { name: 'Rijksmuseum', lng: 4.8852, lat: 52.36, day: 'Fri 4 Sep' },
  { name: 'Westerkerk', lng: 4.8836, lat: 52.3747, day: 'Tue 4 Sep' },
  { name: 'Vondelpark', lng: 4.8686, lat: 52.3579, day: '4' },
  { name: 'Centraal', lng: 4.9003, lat: 52.379, day: 'Sat 5 Sep' },
  /* And a week of them, so the day bar has enough chips to scroll and enough
     dates to be in the wrong order if anything ever sorts them as text. The
     two-digit days are the ones that would give it away. */
  { name: 'Jordaan', lng: 4.8797, lat: 52.3747, day: '2026-09-06' },
  { name: 'Vondelpark again', lng: 4.869, lat: 52.358, day: '2026-09-07' },
  { name: 'Zaanse Schans', lng: 4.8177, lat: 52.4746, day: '2026-09-08' },
  { name: 'Haarlem', lng: 4.6462, lat: 52.3874, day: '2026-09-09' },
  { name: 'Schiphol', lng: 4.7639, lat: 52.3105, day: '2026-09-10' },
  { name: 'Nowhere in particular', lng: 4.9, lat: 52.37, day: '' },
]) {
  stops.push(await repository.createStop(user, trip.id, { ...stop, icon: 'pin' }))
}

/* Built against this API rather than the sample, then moved aside so the
   default suite's dist/client is never what gets served here by accident. */
await run('pnpm', ['build'], { VITE_API_URL: '/api' })
await rm(join(root, 'dist', 'live-client'), { recursive: true, force: true })
await rename(join(root, 'dist', 'client'), join(root, 'dist', 'live-client'))

/* Written after the build, because the build is entitled to empty dist/ and
   this is the one thing in there the tests cannot re-derive. */
await mkdir(join(root, 'dist'), { recursive: true })
await writeFile(
  join(root, 'dist', 'live-stack.json'),
  JSON.stringify({ webOrigin, apiOrigin, apiBase, accessToken, trip, stops, media }, null, 2),
)

/* One origin, the way Caddy serves it: the bundle from disk, /api proxied to
   the server behind it. Not a convenience — the app's media links are minted
   against publicUrl, so a playlist points its own segments at this origin. A
   static server alone answers those with index.html and a cheerful 200, which
   is a test that proves nothing while passing. Same-origin also means no
   preflight, exactly as in production. */
const staticPort = webPort + 2
const serving = spawn(
  process.execPath,
  [
    join(root, 'scripts', 'serve-release.mjs'),
    join(root, 'dist', 'live-client'),
    String(staticPort),
  ],
  { cwd: root, stdio: 'inherit' },
)

const front = createServer((incoming, outgoing) => {
  const toApi = incoming.url.startsWith('/api/') || incoming.url === '/api'
  const relayed = httpRequest(
    {
      host: '127.0.0.1',
      port: toApi ? apiPort : staticPort,
      method: incoming.method,
      path: incoming.url,
      headers: incoming.headers,
    },
    answer => {
      outgoing.writeHead(answer.statusCode, answer.headers)
      answer.pipe(outgoing)
    },
  )
  relayed.on('error', () => outgoing.writeHead(502).end('bad gateway'))
  incoming.pipe(relayed)
})
front.listen(webPort, () => console.log(`live stack on ${webOrigin} (api proxied)`))

const stop = async () => {
  serving.kill()
  front.close()
  worker.stop?.()
  await app.close().catch(() => {})
  await rm(media, { recursive: true, force: true }).catch(() => {})
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
