import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* The compose check needs docker to read the file the way the VPS will, and the
   macOS runner that builds the iOS beta has none. It skips there rather than
   failing — but the deployment pipeline, which does have docker and is the
   place this guard exists for, sets REQUIRE_DOCKER=1 so a silent skip cannot
   pass for a green deployment check. */
const dockerAvailable = spawnSync('docker', ['--version'], { encoding: 'utf8' }).status === 0

test('docker is present wherever the deployment guard is required', {
  skip: !process.env.REQUIRE_DOCKER,
}, () => {
  assert.equal(dockerAvailable, true, 'REQUIRE_DOCKER is set but docker is not installed')
})

test('the deployment SSH entrypoint rejects arbitrary commands', () => {
  const result = spawnSync('bash', ['-lc', './deploy/github-deploy.sh'], {
    cwd: appRoot,
    env: {
      ...process.env,
      SSH_ORIGINAL_COMMAND: 'bash -i',
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 64, result.stderr || result.error?.message)
  assert.match(result.stderr, /refusing unauthorized deploy command/i)
})

test('production compose runs a private pinned Logto service behind the existing web proxy', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const result = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: appRoot,
    env: {
      ...process.env,
      WAYFARE_DOMAIN: 'offwego.example.com',
      WAYFARE_ADMIN_EMAIL: 'owner@example.com',
      APPLE_TEAM_ID: 'R65UN25Q64',
      POSTGRES_PASSWORD: 'database-secret',
      WAYFARE_SESSION_SECRET: 'session-secret-that-is-long-enough',
      WAYFARE_OAUTH_SECRET: 'oauth-secret-that-is-long-enough',
      WAYFARE_OIDC_ISSUER: 'https://auth.example.com/oidc',
      WAYFARE_OIDC_CLIENT_ID: 'offwego-web',
      WAYFARE_OIDC_CLIENT_SECRET: 'oidc-secret',
      LOGTO_DOMAIN: 'auth.example.com',
      LOGTO_ADMIN_DOMAIN: 'auth-admin.example.com',
      LOGTO_POSTGRES_PASSWORD: 'logto-database-secret',
      LOGTO_SECRET_VAULT_KEK: 'base64-key',
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'Off We Go <owner@example.com>',
      MINIO_ROOT_PASSWORD: 'object-store-root-secret',
      S3_SECRET_ACCESS_KEY: 'object-store-app-secret',
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const compose = JSON.parse(result.stdout)
  assert.equal(compose.services.logto.image, 'ghcr.io/logto-io/logto:1.41.0')
  assert.equal(compose.services.logto.ports, undefined, 'Logto ports must not bypass Caddy')
  assert.equal(compose.services.logto.environment.ENDPOINT, 'https://auth.example.com')
  assert.equal(compose.services.logto.environment.ADMIN_ENDPOINT, 'https://auth-admin.example.com')
  assert.equal(compose.services.logto.environment.TRUST_PROXY_HEADER, '1')
  assert.equal(compose.services.web.environment.LOGTO_DOMAIN, 'auth.example.com')
  assert.equal(compose.services.web.environment.LOGTO_ADMIN_DOMAIN, 'auth-admin.example.com')
})

/* The object store holds every photograph anyone has taken on a trip. Two
   things about how it is run are worth a test rather than a habit, because
   both are invisible when they are wrong and catastrophic when they are. */
test('the object store is private, and the api is not its root user', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const result = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: appRoot,
    env: {
      ...process.env,
      WAYFARE_DOMAIN: 'offwego.example.com',
      POSTGRES_PASSWORD: 'database-secret',
      LOGTO_DOMAIN: 'auth.example.com',
      LOGTO_ADMIN_DOMAIN: 'auth-admin.example.com',
      LOGTO_POSTGRES_PASSWORD: 'logto-database-secret',
      LOGTO_SECRET_VAULT_KEK: 'base64-key',
      WAYFARE_OIDC_ISSUER: 'https://auth.example.com/oidc',
      WAYFARE_OIDC_CLIENT_ID: 'offwego-web',
      WAYFARE_OIDC_CLIENT_SECRET: 'oidc-secret',
      MINIO_ROOT_PASSWORD: 'object-store-root-secret',
      S3_SECRET_ACCESS_KEY: 'object-store-app-secret',
    },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const compose = JSON.parse(result.stdout)

  /* Nothing on the internet. The api reads and writes on a viewer's behalf and
     the console is for a person on the box, so the only port published is the
     console, on loopback, reachable through an SSH tunnel. A bucket of
     somebody's holiday open to the world is the failure this prevents. */
  for (const published of compose.services.minio.ports || []) {
    assert.equal(
      published.host_ip,
      '127.0.0.1',
      `minio published ${published.published} to ${published.host_ip || 'every interface'}`,
    )
    assert.notEqual(String(published.target), '9000', 'the S3 port is never published')
  }

  /* And the api is given its own account rather than the root one, so a
     leaked application key cannot reach the store's administration — it can
     read and write one bucket and nothing else. */
  const api = compose.services.api.environment
  assert.equal(api.S3_ACCESS_KEY_ID, 'offwego-api')
  assert.notEqual(api.S3_SECRET_ACCESS_KEY, 'object-store-root-secret')
  assert.equal(api.S3_ACCESS_KEY_ID === compose.services.minio.environment.MINIO_ROOT_USER, false)
})

test('production restore includes the Logto identity database', () => {
  const restore = readFileSync(path.join(appRoot, 'deploy', 'restore.sh'), 'utf8')

  assert.match(restore, /SOURCE\/logto\.dump/)
  assert.match(restore, /logto-db pg_restore --list/)
  assert.match(restore, /logto_restore/)
  assert.match(restore, /configure-logto\.sh logto_restore/)
  assert.match(restore, /docker compose stop api logto/)
  assert.match(restore, /alter database logto_restore rename to logto/)
})

/* A Caddyfile that does not parse is a site that does not start. This one has
   already cost a deploy: an "encode" response matcher does not accept "not",
   the container refused to come up, and the pipeline rolled the release back.
   Caddy will say so in a second, given the chance. */
test('the production Caddyfile is one Caddy will accept', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${appRoot.split(String.fromCharCode(92)).join('/')}/deploy:/cfg:ro`,
      '-e',
      'WAYFARE_DOMAIN=example.com',
      '-e',
      'LOGTO_DOMAIN=auth.example.com',
      '-e',
      'LOGTO_ADMIN_DOMAIN=admin.example.com',
      'caddy:2.10-alpine',
      'caddy',
      'validate',
      '--config',
      '/cfg/Caddyfile',
      '--adapter',
      'caddyfile',
    ],
    { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  )

  assert.equal(result.status, 0, result.stderr || result.error?.message)
  // Caddy says where it says it; take either stream.
  assert.match(`${result.stdout || ''}${result.stderr || ''}`, /Valid configuration/)
})
