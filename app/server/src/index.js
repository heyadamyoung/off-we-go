import { createPostgresRepository } from './postgres.js'
import { createDiskFileStore } from './files.js'
import { createS3FileStore } from './s3-store.js'
import { createSmtpMailer } from './mailer.js'
import { buildServer } from './app.js'
import { startTravelWatch } from './travel-watch.js'
import { createFlightSources } from './flights/registry.js'
import { startFlightWatch } from './flights/watch.js'
import { createWebPushSender } from './push/sender.js'
import { startPushTick } from './push/tick.js'
import { writeFile } from 'node:fs/promises'
import { createCodexRunner, prepareCodexHome } from './codex.js'
import { createCoverage } from './coverage.js'
import { createFooterStore, createReleaseLoader, DEFAULT_INDEX_DIR } from './places/upstream.js'
import { createPlaceWorker } from './places/worker.js'
import { productionLoggerOptions } from './logging.js'
import { createOidcIdentityProvider, readOidcConfig } from './oidc.js'
import { createMediaWorker } from './media-worker.js'
import { transcoderAvailable } from './transcode.js'

const required = name => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const repository = await createPostgresRepository({
  databaseUrl: required('DATABASE_URL'),
  adminEmail: required('WAYFARE_ADMIN_EMAIL'),
})
await repository.migrate()

/* The key pair every push is signed with: made once, kept in the database,
   handed to browsers as the thing they subscribe under. */
const push = await createWebPushSender({ repository, subject: required('WAYFARE_PUBLIC_URL') })
const oidcConfig = readOidcConfig(process.env)

/* The AI assistant exists only when the deploy delivered a Codex login —
   `codex login` on a laptop, the auth.json base64'd into a secret. A garbled
   secret disables the assistant rather than taking the whole API down with
   it: everything else on this server works without a model. */
let assistant = null
if (process.env.CODEX_AUTH_JSON_B64) {
  const home = process.env.CODEX_HOME || '/data/codex'
  try {
    await prepareCodexHome({
      home,
      authJsonB64: process.env.CODEX_AUTH_JSON_B64,
      // The agent talks to this same process: MCP over loopback, in-container.
      mcpUrl:
        process.env.WAYFARE_MCP_URL || `http://127.0.0.1:${Number(process.env.PORT || 3000)}/mcp`,
    })
    assistant = {
      run: createCodexRunner({
        home,
        model: process.env.WAYFARE_AI_MODEL || 'gpt-5.6-luna',
        reasoningEffort: process.env.WAYFARE_AI_REASONING || 'xhigh',
        /* Ten minutes: a real "read my mail and fill in the legs" run crawls
           dozens of messages and writes a whole trip's segments. The wire no
           longer has to survive it — the phone polls the job — so the budget
           can be what the work actually needs. */
        timeoutMs: Number(process.env.WAYFARE_AI_TIMEOUT_MS) || 600_000,
      }),
    }
  } catch (error) {
    // Structured, or Loki's `| json` never sees the one line that explains
    // why the assistant is missing from this deploy.
    console.error(
      JSON.stringify({
        level: 50,
        evt: 'boot.assistant',
        msg: 'The AI assistant is disabled: could not seed the Codex login',
        err: String(error.message || error),
      }),
    )
  }
}

/* The routing engine's coverage follows the trips (coverage.js): the wanted
   extract list is written onto the shared tiles volume, where the engine's
   supervisor rebuilds. The logger arrives once the app exists. */
const coverageLog = { current: console }
const coverage = process.env.VALHALLA_URL
  ? createCoverage({
      listPoints: () => repository.listStopCoordinates(),
      wantedPath: process.env.VALHALLA_WANTED_FILE || '/valhalla-tiles/wanted_tile_urls',
      fs: { writeFile },
      logger: {
        info: (o, m) => coverageLog.current.info(o, m),
        warn: (o, m) => coverageLog.current.warn(o, m),
      },
    })
  : null

/* The places layer's third tier. A cell nobody has ingested yet is answered
   from the publisher's own Parquet over HTTP, marked degraded, and queued —
   see places/upstream.js. On unless PLACES_UPSTREAM=off, because a box that
   quietly answers "nothing near you" for a country it has not loaded is the
   silent degradation this tier exists to prevent; off is for a box with no
   egress, where the reads would only ever time out.

   PLACES_RELEASE pins a release version. Unset — the normal case — the newest
   published one is discovered, which is what has to happen anyway: upstream
   deletes its own releases after about sixty days. */
const placesLog = { current: console }
const placesDirectory = process.env.PLACES_INDEX_DIR || DEFAULT_INDEX_DIR
const placesSay = message => placesLog.current.info?.(message)
const placesRelease = source =>
  createReleaseLoader({
    source,
    pinned: source === 'overture' ? process.env.PLACES_RELEASE || null : null,
    directory: placesDirectory,
    log: placesSay,
  })
const placesOn = process.env.PLACES_UPSTREAM !== 'off'
const placesUpstream = placesOn ? placesRelease('overture') : null

/* Where media lives. A volume on this box until S3_BUCKET says otherwise —
   and nothing above this line knows which, because both stores answer the
   same calls. A single volume is the thing that stops there being a second
   web node, so this is the switch that makes one possible. */
const fileStore = process.env.S3_BUCKET
  ? createS3FileStore({
      bucket: process.env.S3_BUCKET,
      endpoint: required('S3_ENDPOINT'),
      region: process.env.S3_REGION || 'auto',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      prefix: process.env.S3_PREFIX || '',
    })
  : createDiskFileStore({ directory: process.env.UPLOAD_DIR || '/data/uploads' })

/* Can this box convert film? Asked once, at boot, rather than per upload —
   and reported at /api/health, because "why is my video still spinning" is
   first a question about whether anything is standing by to convert it. */
const transcoding = process.env.WAYFARE_TRANSCODE === 'off' ? false : await transcoderAvailable()
if (!transcoding) {
  console.warn(
    JSON.stringify({
      level: 40,
      evt: 'boot.transcoding',
      msg: 'Video conversion is off: ffmpeg was not found, so films are stored exactly as filmed',
    }),
  )
}

const app = await buildServer({
  repository,
  fileStore,
  transcoding,
  mailer: createSmtpMailer({
    host: required('SMTP_HOST'),
    port: process.env.SMTP_PORT || '587',
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS_B64
      ? Buffer.from(process.env.SMTP_PASS_B64, 'base64').toString('utf8')
      : process.env.SMTP_PASS,
    from: required('SMTP_FROM'),
  }),
  publicUrl: required('WAYFARE_PUBLIC_URL'),
  sessionSecret: required('WAYFARE_SESSION_SECRET'),
  push,
  oauthSecret: required('WAYFARE_OAUTH_SECRET'),
  identityProvider: createOidcIdentityProvider(oidcConfig),
  appleTeamId: required('APPLE_TEAM_ID'),
  /* Optional: with no Azure application configured the connector routes say so
     and the screen offers nothing, rather than sending somebody to a sign-in
     that cannot work. */
  microsoft: process.env.MS_CLIENT_ID
    ? {
        clientId: process.env.MS_CLIENT_ID,
        clientSecret: process.env.MS_CLIENT_SECRET || null,
        tenant: process.env.MS_TENANT || 'consumers',
      }
    : null,
  mailboxTokenKey: process.env.MAILBOX_TOKEN_KEY || null,
  /* How much film one upload may be. The default suits a couple of minutes
     off a phone; a box with a small volume lowers it rather than discovering
     the ceiling as a full disk. */
  maxVideoBytes: Number(process.env.WAYFARE_MAX_VIDEO_BYTES) || undefined,
  /* How wide the window in which every reader is handed the same media URL,
     and how long anything in front of us may hold the bytes. Both matter only
     once there is a cache there; until then the first is a smaller number of
     distinct URLs and the second is the browser's own cache. Zero the window
     to go back to a unique link per request. */
  mediaLinkBucketSeconds:
    process.env.WAYFARE_MEDIA_LINK_WINDOW === undefined
      ? undefined
      : Number(process.env.WAYFARE_MEDIA_LINK_WINDOW),
  mediaCacheSeconds: Number(process.env.WAYFARE_MEDIA_CACHE_SECONDS) || undefined,
  valhallaUrl: process.env.VALHALLA_URL || null,
  coverage,
  assistant,
  appleBundleId: process.env.APPLE_BUNDLE_ID || 'ai.threadway.wayfare',
  androidPackageName: process.env.ANDROID_PACKAGE_NAME || 'ai.threadway.wayfare',
  androidCertFingerprints: (process.env.ANDROID_SHA256_CERT_FINGERPRINTS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
  logger: productionLoggerOptions(process.env.LOG_LEVEL || 'info'),
  /* The airports' boards, read from here — the routes and the watch share
     the cache, so ten legs at Dublin are one request a minute, not ten. */
  flights: createFlightSources(),
  placesUpstream,
  placesReleases: () => (placesUpstream?.current ? { overture: placesUpstream.current } : {}),
  placesFooters: placesOn
    ? createFooterStore({ directory: placesDirectory, log: placesSay })
    : null,
})

/* The conversion worker. In-process today because this is one box; it claims
   with `for update skip locked`, so the day it is several boxes this same
   file runs on each of them and nothing else changes. WAYFARE_MEDIA_WORKERS=0
   turns it off on a web node once the work lives elsewhere. */
const workerCount = transcoding ? Math.max(0, Number(process.env.WAYFARE_MEDIA_WORKERS ?? 1)) : 0
const workers = Array.from({ length: workerCount }, () =>
  createMediaWorker({
    repository,
    fileStore,
    logger: app.log,
    /* Adaptive streams as well as conversions, unless a deployment says
       otherwise. A ladder is several encodes rather than one, so a box that
       is already at its limit converting can be told to stop at that. */
    ladders: process.env.WAYFARE_VIDEO_LADDERS !== '0',
    onFinished: job => app.announceMediaReady?.(job),
  }),
)
for (const worker of workers) worker.start()

/* And the places worker, which drains what a trip's stops and a degraded
   query put in the coverage queue. Nothing else reads that queue on this box,
   so without it every places query stays degraded for ever and asks again for
   a cell nobody will ever fetch. A few cells a minute: the API server must
   not spend its afternoon reading Parquet instead of answering people. See
   places/worker.js for the four rules it keeps.

   Off when the upstream tier is off — there is nothing to ingest from — and
   PLACES_WORKER=off turns it off on its own, for the day this work lives
   somewhere that is not the web node. */
const placesWorker =
  placesOn && process.env.PLACES_WORKER !== 'off'
    ? createPlaceWorker({
        pool: repository.pool,
        loadIndex: placesUpstream,
        loadSecondIndex: placesRelease('fsq'),
        footers: createFooterStore({ directory: placesDirectory, log: placesSay }),
        log: placesSay,
        cellsPerTick: Number(process.env.PLACES_CELLS_PER_TICK) || undefined,
      })
    : null

const port = Number(process.env.PORT || 3000)
coverageLog.current = app.log
placesLog.current = app.log
await app.listen({ host: '0.0.0.0', port })
placesWorker?.start()

/* The privacy policy promises GPS fixes are deleted after 30 days; this is
   what keeps the promise. Cheap enough to run often, checked on boot so a
   long-stopped instance catches up immediately. */
/* What actually happened, written down before the trail it is read from is
   deleted. The rule is in stop-visits and the query is in the repository; this
   is the clock.

   Ten minutes because an arrival nobody is shown for ten minutes is an arrival
   nobody misses — the live layer is already lighting the pin on the map in real
   time from the same fixes, and this is the durable copy behind it. Stops that
   already carry both times cost one small query, so a fleet of finished trips
   is nearly free. */
const stampVisits = () =>
  repository
    .stampVisits()
    .then(stamped => {
      if (stamped) app.log.info({ evt: 'stamp.visits', stamped }, 'arrival times recorded')
    })
    .catch(error => app.log.warn({ err: error }, 'recording arrival times failed'))

const prunePositions = () =>
  /* Always immediately before the delete, never after it. The fixes are the
     evidence and the stamps are the finding, and a finding not yet drawn when
     its evidence is destroyed is a finding lost — a trip going quiet for a
     month and then losing the day it happened on. */
  stampVisits()
    .then(() => repository.prunePositions())
    .then(removed => {
      // Always, not only when something was removed: a prune timer that quietly
      // stopped must not be indistinguishable from a healthy no-op — this job
      // keeps a privacy promise.
      app.log.info({ evt: 'prune.positions', removed }, 'GPS fix prune ran')
    })
    .catch(error => app.log.warn({ err: error }, 'GPS fix prune failed'))
await prunePositions()
const pruneTimer = setInterval(prunePositions, 6 * 60 * 60 * 1000)
pruneTimer.unref?.()
const stampTimer = setInterval(stampVisits, 10 * 60 * 1000)
stampTimer.unref?.()

/* The mailbox, looking without being asked — but only for the mailboxes whose
   owner turned it on, only around legs departing soon, and only for the flight
   number and booking reference the traveller typed in themselves. The rule is
   in travel-mail.js and the restraint is in travel-watch.js; this is the clock.

   Absent entirely when no connector is configured, which is most deployments:
   there is nothing to look in. */
const travelWatch = app.mailboxReader
  ? startTravelWatch({ repository, reader: app.mailboxReader, log: app.log })
  : null

/* The airports, looking at the trip's legs without being asked. Public
   boards, every leg whose airport has one, once a minute; what they say is
   written onto the leg and announced to whoever is watching the trip. The
   rule is in flights/watch.js; this is the clock. */
const flightWatch = startFlightWatch({
  repository,
  sources: app.flightSources,
  announce: app.announceTrip,
  log: app.log,
})

/* The phones that asked to be told, told: one card per leg, replaced in
   place, a sound only for the moments worth one. The rule is in
   push/card.js; this is the clock. */
const pushTick = startPushTick({
  repository,
  sender: push,
  secret: required('WAYFARE_SESSION_SECRET'),
  log: app.log,
})

const stop = async signal => {
  app.log.info({ signal }, 'shutting down')
  clearInterval(pruneTimer)
  clearInterval(stampTimer)
  travelWatch?.stop()
  flightWatch.stop()
  pushTick.stop()
  /* Awaited, unlike the rest: the cell in flight is a transaction, and the
     ingest leaves it resumable only if it is allowed to finish abandoning
     it. See places/worker.js. */
  await placesWorker?.stop().catch(() => {})
  await app.close().catch(() => {})
  await repository.close().catch(() => {})
  process.exit(0)
}
process.once('SIGTERM', () => stop('SIGTERM'))
process.once('SIGINT', () => stop('SIGINT'))
