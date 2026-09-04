import { createPostgresRepository } from './postgres.js'
import { createReplayStore } from './replay-store.js'
import { createDiskFileStore } from './files.js'
import { createSmtpMailer } from './mailer.js'
import { buildServer } from './app.js'
import { writeFile } from 'node:fs/promises'
import { createCodexRunner, prepareCodexHome } from './codex.js'
import { createCoverage } from './coverage.js'
import { productionLoggerOptions } from './logging.js'
import { createOidcIdentityProvider, readOidcConfig } from './oidc.js'

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

const app = await buildServer({
  repository,
  fileStore: createDiskFileStore({ directory: process.env.UPLOAD_DIR || '/data/uploads' }),
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
  oauthSecret: required('WAYFARE_OAUTH_SECRET'),
  identityProvider: createOidcIdentityProvider(oidcConfig),
  appleTeamId: required('APPLE_TEAM_ID'),
  replayStore: createReplayStore({ directory: process.env.REPLAY_DIR || '/data/replays' }),
  adminEmail: required('WAYFARE_ADMIN_EMAIL'),
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
})

const port = Number(process.env.PORT || 3000)
coverageLog.current = app.log
await app.listen({ host: '0.0.0.0', port })

/* The privacy policy promises GPS fixes are deleted after 30 days; this is
   what keeps the promise. Cheap enough to run often, checked on boot so a
   long-stopped instance catches up immediately. */
const prunePositions = () =>
  repository
    .prunePositions()
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

/* Replays keep their privacy promise by dying young: a fortnight, then gone.
   Swept on boot and daily, the same rhythm as the GPS prune above. */
const replaySweep = createReplayStore({ directory: process.env.REPLAY_DIR || '/data/replays' })
const pruneReplays = () =>
  replaySweep
    .sweep()
    .then(removed => {
      app.log.info({ evt: 'prune.replays', removed }, 'replay prune ran')
    })
    .catch(error => app.log.warn({ err: error }, 'replay prune failed'))
await pruneReplays()
const replayTimer = setInterval(pruneReplays, 24 * 60 * 60 * 1000)
replayTimer.unref?.()

const stop = async signal => {
  app.log.info({ signal }, 'shutting down')
  clearInterval(pruneTimer)
  await app.close().catch(() => {})
  await repository.close().catch(() => {})
  process.exit(0)
}
process.once('SIGTERM', () => stop('SIGTERM'))
process.once('SIGINT', () => stop('SIGINT'))
