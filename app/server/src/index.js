import { createPostgresRepository } from './postgres.js'
import { createDiskFileStore } from './files.js'
import { createSmtpMailer } from './mailer.js'
import { buildServer } from './app.js'

const required = name => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const repository = await createPostgresRepository({
  databaseUrl: required('DATABASE_URL'), adminEmail: required('WAYFARE_ADMIN_EMAIL'),
})
await repository.migrate()

const app = await buildServer({
  repository,
  fileStore: createDiskFileStore({ directory: process.env.UPLOAD_DIR || '/data/uploads' }),
  mailer: createSmtpMailer({
    host: required('SMTP_HOST'), port: process.env.SMTP_PORT || '587',
    secure: process.env.SMTP_SECURE === 'true', user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS_B64
      ? Buffer.from(process.env.SMTP_PASS_B64, 'base64').toString('utf8')
      : process.env.SMTP_PASS,
    from: required('SMTP_FROM'),
  }),
  publicUrl: required('WAYFARE_PUBLIC_URL'),
  sessionSecret: required('WAYFARE_SESSION_SECRET'),
  oauthSecret: required('WAYFARE_OAUTH_SECRET'),
  appleTeamId: required('APPLE_TEAM_ID'),
  appleBundleId: process.env.APPLE_BUNDLE_ID || 'ai.threadway.wayfare',
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
})

const port = Number(process.env.PORT || 3000)
await app.listen({ host: '0.0.0.0', port })

const stop = async signal => {
  app.log.info({ signal }, 'shutting down')
  await app.close().catch(() => {})
  await repository.close().catch(() => {})
  process.exit(0)
}
process.once('SIGTERM', () => stop('SIGTERM'))
process.once('SIGINT', () => stop('SIGINT'))
