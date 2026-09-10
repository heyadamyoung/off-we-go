import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* The compose check needs docker to read the file the way the VPS will, and the
   macOS runner that builds the iOS beta has none. It skips there rather than
   failing — but the deployment pipeline, which does have docker and is the
   place this guard exists for, sets REQUIRE_DOCKER=1 so a silent skip cannot
   pass for a green deployment check. */
/* Two different needs, and conflating them cost this suite a permanent red.
   Rendering a compose file is the client parsing YAML and never leaves the
   machine; running Caddy to validate a Caddyfile needs a daemon to start a
   container in. The binary being on the PATH says nothing about whether a
   daemon will answer, so the test that needs one asked the wrong question and
   reported "no daemon" as a failure — which is how a guard trains people to
   ignore it. */
const dockerAvailable = spawnSync('docker', ['--version'], { encoding: 'utf8' }).status === 0
const dockerRuns =
  dockerAvailable &&
  spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8',
    timeout: 20_000,
  }).status === 0

/* Everything object-storage.sh and merge-env.sh reach for, so a PATH can be
   built that holds all of it and not `timeout`. */
const NEEDED = [
  'awk',
  'bash',
  'cat',
  'chmod',
  'cp',
  'date',
  'dirname',
  'grep',
  'head',
  'mkdir',
  'mktemp',
  'mv',
  'od',
  'printf',
  'rm',
  'sed',
  'sh',
  'sort',
  'tail',
  'touch',
  'tr',
  'wc',
]

test('docker is present wherever the deployment guard is required', {
  skip: !process.env.REQUIRE_DOCKER,
}, () => {
  assert.equal(dockerAvailable, true, 'REQUIRE_DOCKER is set but docker is not installed')
  assert.equal(dockerRuns, true, 'REQUIRE_DOCKER is set but no Docker daemon answered')
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

const stackEnv = extra => ({
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
  COMPOSE_PROFILES: '',
  MINIO_ROOT_PASSWORD: '',
  S3_SECRET_ACCESS_KEY: '',
  ...extra,
})

const renderCompose = extra =>
  spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: appRoot,
    env: stackEnv(extra),
    encoding: 'utf8',
  })

/* `docker compose config` is the deploy's own gate: it runs before a single
   container is touched, and a file it will not render stops the release.

   This has cost one. Object storage was added with its credentials marked
   required, so every deploy demanded secrets for a service nothing was using
   yet — and compose interpolates a service's variables whether or not its
   profile is active, so gating it was not enough on its own. A stack with no
   object storage configured has to render, because that is every deployment
   that has not opted in. */
test('the stack still renders with no object storage configured at all', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const result = renderCompose({})
  assert.equal(result.status, 0, result.stderr || result.error?.message)

  const compose = JSON.parse(result.stdout)
  assert.equal(
    compose.services.minio,
    undefined,
    'an unasked-for object store must not be in the stack at all',
  )
  // And the rest of the stack is untouched by its absence.
  for (const name of ['api', 'web', 'db', 'logto']) {
    assert.ok(compose.services[name], `${name} is missing`)
  }
})

/* The object store holds every photograph anyone has taken on a trip. Two
   things about how it is run are worth a test rather than a habit, because
   both are invisible when they are wrong and catastrophic when they are. */
test('the object store is private, and the api is not its root user', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const result = renderCompose({
    COMPOSE_PROFILES: 'objectstore',
    MINIO_ROOT_PASSWORD: 'object-store-root-secret',
    S3_SECRET_ACCESS_KEY: 'object-store-app-secret',
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const compose = JSON.parse(result.stdout)
  assert.ok(compose.services.minio, 'the profile brings the object store in')

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
  skip: dockerRuns ? false : 'no Docker daemon on this machine to run Caddy in',
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

/* Turning object storage on used to be a runbook — invent two secrets, set a
   profile, deploy, exec a migration, read its output, set one more variable,
   deploy again — and getting the order wrong meant every photograph on the
   volume with nothing pointing at it. The deploy does it now, which means the
   deploy can also get it wrong, on a box holding the only copy of somebody's
   holiday. So every branch of it is exercised here.

   Docker and curl are stubbed onto the PATH, so this runs anywhere and tests
   the decisions rather than the containers. */

const objectStorage = ({ env, ...world }) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offwego-cutover-'))
  writeFileSync(path.join(dir, '.env'), env)
  for (const name of ['object-storage.sh', 'merge-env.sh']) {
    writeFileSync(path.join(dir, name), readFileSync(path.join(appRoot, 'deploy', name)))
  }
  mkdirSync(path.join(dir, 'stub'))
  const script = lines => lines.join('\n')
  writeFileSync(
    path.join(dir, 'stub', 'docker'),
    script([
      '#!/bin/sh',
      'case "$*" in',
      '  *"ps --services --status running"*) [ "$MINIO_UP" = 1 ] && echo minio; exit 0 ;;',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion, inside a shell script
      '  *"migrate-media-to-bucket"*) exit ${MIGRATION_EXIT:-0} ;;',
      '  *) exit 0 ;;',
      'esac',
      '',
    ]),
  )
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion, inside a shell script
  const health = 'exit ${HEALTH_EXIT:-0}'
  writeFileSync(path.join(dir, 'stub', 'curl'), script(['#!/bin/sh', health, '']))
  chmodSync(path.join(dir, 'stub', 'docker'), 0o755)
  chmodSync(path.join(dir, 'stub', 'curl'), 0o755)

  /* A PATH with no `timeout` on it, for the machine that has none. It cannot
     be done by dropping a directory — on Linux `timeout` sits in /usr/bin
     beside everything else — so this is a farm of symlinks to what the script
     actually uses, with that one left out. A command missing from the list
     fails the run loudly rather than silently changing what is being tested. */
  const withoutTimeout = () => {
    const farm = path.join(dir, 'nogtimeout')
    mkdirSync(farm, { recursive: true })
    for (const name of NEEDED) {
      const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' })
      if (found.status === 0) {
        const target = found.stdout.trim()
        try {
          symlinkSync(target, path.join(farm, name))
        } catch {
          /* already linked */
        }
      }
    }
    return farm
  }

  return {
    dir,
    run(phase, extra = {}) {
      const lean = world.hideTimeout ? withoutTimeout() : null
      const result = spawnSync(
        'bash',
        [`${dir}/object-storage.sh`, phase, `${dir}/.env`, 'offwego.example.com'],
        {
          cwd: dir,
          env: {
            ...process.env,
            PATH: lean ? `${dir}/stub:${lean}` : `${dir}/stub:${process.env.PATH}`,
            ...world,
            ...extra,
          },
          encoding: 'utf8',
        },
      )
      assert.equal(result.status, 0, result.stderr)
      return result
    },
    bucket() {
      const text = readFileSync(path.join(dir, '.env'), 'utf8')
      return (/^S3_BUCKET=(.*)$/m.exec(text) || [])[1]
    },
    env() {
      return readFileSync(path.join(dir, '.env'), 'utf8')
    },
  }
}

const BARE_ENV = [
  'WAYFARE_DOMAIN=offwego.example.com',
  'POSTGRES_PASSWORD=a-secret-with-$-and-/-in-it',
  'S3_BUCKET=',
  'S3_SECRET_ACCESS_KEY=',
  '',
].join('\n')

test('the first deploy makes the object store its own credentials', () => {
  const world = objectStorage({ env: BARE_ENV })
  world.run('prepare')

  const env = world.env()
  /* Made on the box and never anywhere else: nothing to put in a GitHub
     secret, nothing to paste into a terminal, nothing to leak in transit. */
  const secret = /^S3_SECRET_ACCESS_KEY=(.+)$/m.exec(env)?.[1] || ''
  const root = /^MINIO_ROOT_PASSWORD=(.+)$/m.exec(env)?.[1] || ''
  assert.ok(secret.length >= 32, `the app's key is ${secret.length} characters`)
  // MinIO refuses to start under eight, and this is the thing guarding a
  // bucket of everybody's photographs.
  assert.ok(root.length >= 32, `the root password is ${root.length} characters`)
  assert.match(secret, /^[0-9a-f]+$/, 'no / or + to break an .env line or a signature')
  assert.notEqual(secret, root, 'the app is not given the root credential')

  assert.match(env, /^COMPOSE_PROFILES=objectstore$/m)
  assert.match(env, /^S3_ENDPOINT=http:\/\/minio:9000$/m)
  assert.match(env, /^S3_FORCE_PATH_STYLE=true$/m)
  // Everything else on the box is left exactly as it was, awkward bytes and all.
  assert.match(env, /^POSTGRES_PASSWORD=a-secret-with-\$-and-\/-in-it$/m)
  // And nothing reads the bucket until the media is in it.
  assert.equal(world.bucket(), '')
})

test('later deploys do not mint new credentials over the working ones', () => {
  const world = objectStorage({ env: BARE_ENV })
  world.run('prepare')
  const first = world.env()
  world.run('prepare')
  /* A second secret would lock the app out of the bucket its own data is in,
     on an ordinary deploy that changed nothing. */
  assert.equal(world.env(), first)
})

test('nothing is pointed at the bucket until the media is safely in it', () => {
  for (const [why, world] of [
    ['the object store is not running', { MINIO_UP: '0' }],
    ['the copy did not finish', { MINIO_UP: '1', MIGRATION_EXIT: '1' }],
  ]) {
    const box = objectStorage({ env: BARE_ENV, ...world })
    box.run('prepare')
    box.run('cutover')
    assert.equal(box.bucket(), '', `switched over when ${why}`)
  }
})

test('a copy that lands, and an app that answers, switches the bucket on', () => {
  const box = objectStorage({
    env: BARE_ENV,
    MINIO_UP: '1',
    MIGRATION_EXIT: '0',
    HEALTH_EXIT: '0',
  })
  box.run('prepare')
  box.run('cutover')
  assert.equal(box.bucket(), 'offwego-media')

  // And then never touches it again.
  const settled = box.env()
  box.run('prepare')
  box.run('cutover')
  assert.equal(box.env(), settled)
})

test('it switches over on a machine with no timeout command', () => {
  /* `timeout` is GNU coreutils: the box this deploys to has it and the macOS
     runner that builds the iOS beta does not. Without this the copy command
     failed before it began, the script took its "did not finish" branch, and
     the cutover quietly declined to switch over — which is exactly what this
     test found, three TestFlight builds after it started happening.

     A bound on how long the copy may take is a courtesy to the deploy lock,
     not a correctness requirement, so a machine without one runs it plainly. */
  const box = objectStorage({
    env: BARE_ENV,
    MINIO_UP: '1',
    MIGRATION_EXIT: '0',
    HEALTH_EXIT: '0',
    hideTimeout: true,
  })
  box.run('prepare')
  box.run('cutover')
  assert.equal(box.bucket(), 'offwego-media')
})

test('an app that will not come back puts itself on the volume again', () => {
  /* The one that matters. The health check asks the file store whether it is
     really there, so a bucket the app cannot reach fails it — and a deploy
     that switched over into a trip full of grey squares and left it that way
     would be worse than never switching at all. */
  const box = objectStorage({
    env: BARE_ENV,
    MINIO_UP: '1',
    MIGRATION_EXIT: '0',
    HEALTH_EXIT: '22',
  })
  box.run('prepare')
  box.run('cutover')
  assert.equal(box.bucket(), '', 'left the app pointing at a bucket it cannot read')
})

/* The object store's own container, exercised with minio and mc stubbed.

   It has to survive its own setup failing. A container that will not start
   fails `compose up --wait`, which trips the deploy's error trap and rolls
   back a release that had nothing to do with object storage — so the worst
   this is allowed to do is not make the bucket, and let the cutover find
   nothing to copy into. */
const minioEntrypoint = () => {
  const rendered = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: appRoot,
    env: stackEnv({
      COMPOSE_PROFILES: 'objectstore',
      MINIO_ROOT_PASSWORD: 'object-store-root-secret',
      S3_SECRET_ACCESS_KEY: 'object-store-app-secret',
    }),
    encoding: 'utf8',
  })
  assert.equal(rendered.status, 0, rendered.stderr)
  const minio = JSON.parse(rendered.stdout).services.minio
  // compose re-escapes $ as $$ when it prints; the container sees one.
  return { script: minio.entrypoint[2].replaceAll('$$', '$'), service: minio }
}

const runEntrypoint = (script, { mc, seconds = 1 }) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offwego-minio-'))
  writeFileSync(path.join(dir, 'minio'), `#!/bin/sh\nsleep ${seconds}\n`)
  if (mc) writeFileSync(path.join(dir, 'mc'), mc)
  chmodSync(path.join(dir, 'minio'), 0o755)
  if (mc) chmodSync(path.join(dir, 'mc'), 0o755)
  return spawnSync('sh', ['-c', script], {
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      MINIO_ROOT_USER: 'offwego',
      MINIO_ROOT_PASSWORD: 'a-long-enough-password',
      APP_SECRET: 'an-app-secret',
      APP_KEY: 'offwego-api',
      BUCKET: 'offwego-media',
    },
    encoding: 'utf8',
    timeout: 90_000,
  })
}

test('the object store has no healthcheck that can fail a deploy', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  /* `compose up --wait` treats a service without one as ready once it is
     running. A probe leaning on a tool being present in somebody else's
     image is one more way for object storage to roll back a release that
     has nothing to do with it. */
  assert.equal(minioEntrypoint().service.healthcheck, undefined)
})

test('the object store still runs when its own setup cannot', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const { script } = minioEntrypoint()

  // mc missing altogether — the tool the setup leans on is simply not there.
  const bare = runEntrypoint(script, { mc: null, seconds: 1 })
  assert.equal(bare.status, 0, 'the container died because it could not set itself up')
  assert.match(bare.stderr, /could not be set up/)

  // And present, but refusing to make the bucket.
  const refused = runEntrypoint(script, {
    mc: [
      '#!/bin/sh',
      'case "$1" in',
      '  alias) exit 0 ;;',
      '  mb) exit 1 ;;',
      '  *) exit 0 ;;',
      'esac',
      '',
    ].join('\n'),
    seconds: 1,
  })
  assert.equal(refused.status, 0)
  /* And it must not claim otherwise. `set -e` inside a compound command on
     the left of `||` is disabled, so a failing step used to run straight on
     to printing that the bucket was ready. */
  assert.doesNotMatch(refused.stdout, /is ready/, 'said the bucket was ready when it was not')
  assert.match(refused.stderr, /could not be set up/)
})

test('a working object store says so, once', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const { script } = minioEntrypoint()
  const fine = runEntrypoint(script, { mc: '#!/bin/sh\nexit 0\n', seconds: 1 })
  assert.equal(fine.status, 0)
  assert.match(fine.stdout, /bucket offwego-media is ready for offwego-api/)
  assert.doesNotMatch(fine.stderr, /could not be set up/)
})

test('the object store refuses to run on a guessable password', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const { script } = minioEntrypoint()
  const weak = spawnSync('sh', ['-c', script], {
    env: { PATH: process.env.PATH, MINIO_ROOT_PASSWORD: 'short', APP_SECRET: 'x' },
    encoding: 'utf8',
  })
  /* The one refusal that is deliberate. The deploy always writes a real
     password before enabling the profile, so only a hand-edited .env reaches
     this — and running a bucket of everybody's photographs on five
     characters is worse than not running it. */
  assert.equal(weak.status, 78)
  assert.match(weak.stderr, /must be set in .env/)
})

test('the day census only ever reads', () => {
  /* It runs against production on every deploy, so the one property that
     matters is that it cannot change anything. A census that quietly repaired
     a row would be a migration nobody reviewed, running unversioned, every
     time somebody pushed. */
  const source = readFileSync(
    path.join(appRoot, 'server', 'scripts', 'day-census.mjs'),
    'utf8',
  ).toLowerCase()
  for (const write of [
    'insert ',
    'update ',
    'delete ',
    'drop ',
    'alter ',
    'truncate ',
    'create ',
  ]) {
    assert.ok(!source.includes(write), `day-census.mjs contains "${write.trim()}"`)
  }
})
