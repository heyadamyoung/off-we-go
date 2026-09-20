import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
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

/** The settings `docker compose config` needs before it will render. */
const composeEnv = () => ({
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

/* The images the box runs are the ones the pipeline built and tested, named
   by commit; a desk and install.sh still build the same Dockerfiles. */
test("the api and web images are the pipeline's, by commit, and still buildable by hand", {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const result = renderCompose({ IMAGE_TAG: 'abc123' })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const compose = JSON.parse(result.stdout)
  assert.equal(compose.services.api.image, 'ghcr.io/heyadamyoung/off-we-go/api:abc123')
  assert.equal(compose.services.web.image, 'ghcr.io/heyadamyoung/off-we-go/web:abc123')
  assert.equal(compose.services.api.build.dockerfile, 'server/Dockerfile')
  assert.equal(compose.services.web.build.dockerfile, 'Dockerfile.web')
})

/* The deploy pulls those images with the pipeline's own short-lived token —
   read from the staged copy, destroyed before anything else runs, never
   copied onto the box — and builds them itself when no token came, which is
   what install.sh and a hand deploy are. The way back is whatever was
   running, tagged before the release touches anything. */
test('the deploy pulls with a token it destroys, builds without one, and keeps the way back', () => {
  const script = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  assert.match(script, /registry_env="\$staged_app\/deploy\/registry\.env"/)
  assert.match(script, /shred -u -- "\$registry_env"/)
  assert.match(script, /--exclude='\/deploy\/registry\.env'/)
  assert.match(script, /rm -f -- "\$APP_ROOT\/deploy\/registry\.env"/)
  assert.match(script, /docker login ghcr\.io -u "\$registry_user" --password-stdin/)
  assert.match(script, /docker compose pull --quiet api web/)
  assert.match(script, /docker logout ghcr\.io/)
  assert.match(script, /docker compose up -d --no-build --wait --wait-timeout 180/)
  assert.match(script, /docker compose up -d --build --wait --wait-timeout 180/)
  assert.match(script, /docker tag "\$running" "\$image_repo\/\$image:rollback"/)
  assert.match(script, /IMAGE_TAG=rollback docker compose up -d --no-build --force-recreate/)
  // Nothing about the token is ever echoed or left in a variable afterwards.
  assert.match(script, /registry_token=""\n {2}docker compose pull/)
  assert.doesNotMatch(script, /echo.*registry_token/)
})

test('the release images are put together beside the tests, and the deploy waits for them', () => {
  const workflow = readFileSync(
    path.join(appRoot, '..', '.github', 'workflows', 'deploy-vps.yml'),
    'utf8',
  )
  const dockerfile = readFileSync(path.join(appRoot, 'server', 'Dockerfile'), 'utf8')
  const webDockerfile = readFileSync(path.join(appRoot, 'Dockerfile.web'), 'utf8')
  assert.match(workflow, /needs: \[checks, server, browser, live\]/)
  /* The images are put together in the checks job, beside the unit tests
     and the guard rather than after them: each is waited on, and one
     failing fails the job. */
  assert.match(
    workflow,
    /wait "\$unit" \|\| failed=1\n\s*wait "\$guard" \|\| failed=1\n\s*wait "\$built" \|\| failed=1/,
  )
  assert.match(workflow, /packages: write/)
  /* The api image is the Dockerfile's base stage with the server laid over
     it by crane, so the final stage — what a hand build makes — must be that
     base and the one COPY, nothing else, and the base is rebuilt only when
     the stage, the dependencies or the node image it starts from change. */
  assert.match(dockerfile, /^FROM node:\S+ AS base$/m)
  assert.match(dockerfile, /\nFROM base\nCOPY server \.\/server\n$/)
  assert.match(
    workflow,
    /sed -n 's\/\^FROM \\\(\[\^ \]\*\\\) AS base\$\/\\1\/p' server\/Dockerfile/,
  )
  /* And the key is the dependencies, not the scripts beside them: a test
     added to the unit suite must not rebuild the runtime. */
  assert.match(
    workflow,
    /runtime=\$\(node -p 'const p = require\("\.\/package\.json"\); delete p\.scripts; JSON\.stringify\(p\)'\)/,
  )
  assert.match(
    workflow,
    /cat server\/Dockerfile pnpm-lock\.yaml <\(printf '%s' "\$runtime"\) <\(crane digest "\$node_image"\)/,
  )
  assert.match(workflow, /--target base/)
  assert.match(workflow, /--transform 's,\^,app\/,' -cf \/tmp\/server\.tar server/)
  assert.match(
    workflow,
    /crane append -b "\$base" -f \/tmp\/server\.tar -t "\$repo\/api:\$GITHUB_SHA"/,
  )
  /* The web image is the bundle over the Caddy Dockerfile.web names, built
     on the runner as that Dockerfile builds it: against /api, stamped with
     the commit, and checked. */
  assert.match(webDockerfile, /^FROM caddy:\S+$/m)
  assert.match(workflow, /sed -n 's\/\^FROM \\\(caddy:\[\^ \]\*\\\)\$\/\\1\/p' Dockerfile\.web/)
  assert.match(workflow, /VITE_API_URL=\/api VITE_APP_SHA="\$GITHUB_SHA" pnpm build/)
  assert.match(workflow, /pnpm build\n\s*node scripts\/check-release-assets\.mjs dist\/client/)
  assert.match(workflow, /--transform 's,\^dist\/client,srv,' -cf \/tmp\/web\.tar dist\/client/)
  assert.match(
    workflow,
    /crane append -b "\$caddy" -f \/tmp\/web\.tar -t "\$repo\/web:\$GITHUB_SHA"/,
  )
  // Both by commit, and both as latest.
  assert.match(workflow, /crane tag "\$repo\/api:\$GITHUB_SHA" latest/)
  assert.match(workflow, /crane tag "\$repo\/web:\$GITHUB_SHA" latest/)
  // The box is told which images the release is, by commit, and handed the
  // pipeline's own token to pull them with — into the file the deploy script
  // reads once and destroys, never into the release values it keeps.
  assert.match(workflow, /echo "IMAGE_TAG=\$GITHUB_SHA"/)
  assert.match(
    workflow,
    /echo "REGISTRY_TOKEN=\$REGISTRY_TOKEN"\n\s*\} > app\/deploy\/registry\.env/,
  )
  assert.doesNotMatch(workflow, /REGISTRY_TOKEN[^\n]*release\.env/)
  // And every step of it signs out again.
  assert.match(workflow, /docker logout ghcr\.io/)
})

/* The backup before a release, exercised with docker stubbed: the deploy
   takes the databases only and stops nothing, because stopping the api to
   archive the uploads volume was a minute and a half of downtime on every
   release; the nightly run still takes everything, stopped. */
const backupWorld = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offwego-backup-'))
  mkdirSync(path.join(dir, 'deploy'))
  mkdirSync(path.join(dir, 'data', 'uploads'), { recursive: true })
  writeFileSync(path.join(dir, 'data', 'uploads', 'a.jpg'), 'jpeg')
  writeFileSync(
    path.join(dir, 'deploy', 'backup.sh'),
    readFileSync(path.join(appRoot, 'deploy', 'backup.sh')),
  )
  mkdirSync(path.join(dir, 'stub'))
  const log = path.join(dir, 'docker.log')
  writeFileSync(
    path.join(dir, 'stub', 'docker'),
    [
      '#!/bin/sh',
      `echo "$*" >> "${log}"`,
      'case "$*" in',
      '  *pg_dump*) echo "dump of $*" ;;',
      '  *"pg_restore --list"*) cat >/dev/null ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
  )
  chmodSync(path.join(dir, 'stub', 'docker'), 0o755)
  return {
    run(mode) {
      const result = spawnSync('bash', [`${dir}/deploy/backup.sh`, ...(mode ? [mode] : [])], {
        cwd: dir,
        env: { ...process.env, PATH: `${dir}/stub:${process.env.PATH}` },
        encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stderr)
      return path.join(dir, result.stdout.trim())
    },
    calls: () => readFileSync(log, 'utf8').trim().split('\n'),
  }
}

test('the quick backup dumps the databases and stops nothing', () => {
  const world = backupWorld()
  const made = world.run('quick')
  assert.ok(readFileSync(path.join(made, 'database.dump'), 'utf8').includes('wayfare'))
  assert.ok(readFileSync(path.join(made, 'logto.dump'), 'utf8').includes('logto'))
  assert.ok(!existsSync(path.join(made, 'uploads.tar.gz')), "the uploads are the nightly run's")
  assert.ok(!world.calls().some(call => /compose (stop|up)/.test(call)), world.calls().join('\n'))
})

test('the full backup still stops the api, takes the uploads, and starts it again', () => {
  const world = backupWorld()
  const made = world.run()
  assert.ok(existsSync(path.join(made, 'uploads.tar.gz')))
  const calls = world.calls()
  assert.ok(
    calls.some(call => call.startsWith('compose stop api logto')),
    calls.join('\n'),
  )
  assert.ok(
    calls.some(call => call.startsWith('compose up -d api logto')),
    calls.join('\n'),
  )
})

test('the deploy takes the quick backup, and a quick backup can be restored', () => {
  const deploy = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  assert.match(deploy, /bash \.\/deploy\/backup\.sh quick/)
  const restore = readFileSync(path.join(appRoot, 'deploy', 'restore.sh'), 'utf8')
  // the uploads archive is no longer required, and every step that touches
  // the uploads is behind the check
  assert.doesNotMatch(restore, /! -f "\$SOURCE\/uploads\.tar\.gz" \]\]; then\n {2}echo "Usage/)
  assert.match(restore, /HAS_UPLOADS=0/)
  assert.match(restore, /if \(\( HAS_UPLOADS \)\); then\n {2}mv "\$UPLOADS_DIR" "\$OLD_UPLOADS"/)
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
      /* The real entrypoint gives the store a minute to answer. A setup that
         cannot answer here is the point of two of these tests, and waiting
         the full minute for it was sixty seconds of every unit run. */
      SETUP_TRIES: '2',
    },
    encoding: 'utf8',
    timeout: 90_000,
  })
}

/* Push to live is four minutes, and the deploy's own backup is what put it
   at twenty-three.
 *
 * The places tables are a cache of Overture: ten million rows and seventeen
 * gigabytes in a database that was under two before they arrived. Dumping
 * them before every release meant a deploy spent thirteen minutes and
 * forty-two seconds writing out a copy of somebody else's open data so it
 * could be restored over the top of itself. Measured, on deploy 360.
 *
 * The rule, guarded here because the next person to touch backup.sh will not
 * know it: the quick dump leaves out data the worker can rebuild, the full
 * one keeps everything. */
test('the deploy backup does not copy out the places cache', () => {
  const backup = readFileSync(path.join(appRoot, 'deploy/backup.sh'), 'utf8')

  assert.match(
    backup,
    /--exclude-table-data='place\*'/,
    'the quick dump leaves out the places rows',
  )
  assert.match(backup, /--exclude-table-data='osm_landmarks'/, 'and the landmarks it matches on')

  /* Only the rows. A dump with the table definitions missing restores a
     database the code cannot start against. */
  assert.ok(
    !/--exclude-table='place/.test(backup),
    'the definitions still go in; it is the rows that do not',
  )

  /* And only on the quick path. The nightly backup is the disaster copy, and
     restoring sixteen gigabytes beats re-reading the planet for half a day. */
  const guarded = /if \(\( QUICK \)\); then\n\s*PLACES_DATA=\(/.test(backup)
  assert.ok(guarded, 'the exclusion is on the quick path only')
})

/* The API runs its migrations before it listens, and a migration can be
   waiting its turn for a table the sweep is writing to. Twelve probes over
   two minutes was the whole budget once, and deploy 357 — a release that was
   doing exactly the right thing, asking for a lock, backing off, asking
   again — was declared dead and rolled back, taking the label_zoom work with
   it. Failures inside the start period do not count against the retries. */
test('the api is given time to boot before a probe can roll a release back', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const result = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: appRoot,
    env: composeEnv(),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const health = JSON.parse(result.stdout).services.api.healthcheck

  /* Compose renders Go durations: `5m0s`, `1h30m0s`, `10s`. */
  const SCALE = { h: 3600, m: 60, s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9 }
  const seconds = value => {
    let total = 0
    for (const [, amount, unit] of String(value).matchAll(/(\d+(?:\.\d+)?)(ms|us|ns|h|m|s)/g)) {
      total += Number(amount) * SCALE[unit]
    }
    return total
  }
  assert.ok(health.start_period, 'the api healthcheck has a start period')
  assert.ok(
    seconds(health.start_period) >= 120,
    `a boot may take at least two minutes, not ${health.start_period}`,
  )

  /* And once the start period is over the probe is still strict: a release
     that is genuinely broken is caught within a couple of minutes, not left
     serving errors for the length of the start period a second time. */
  assert.ok(seconds(health.interval) <= 30, 'still probed often once it is up')
  assert.ok(Number(health.retries) <= 12, 'and still given a bounded number of chances')
})

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

/* ---- the planet sweep -------------------------------------------------- */

const deployScript = () => readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')

test('a planet sweep is behind a profile, so a deploy cannot kill one mid-run', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  /* The whole reason it is a service of its own. A sweep is about three hours
     and deploys go out several times an hour; `docker compose up -d` recreates
     every service it can see, so a sweep the deploy could see would be killed
     and restarted by every release and would never finish. A profiled service
     is invisible to `up` unless the profile is asked for. */
  const plain = renderCompose({})
  assert.equal(plain.status, 0, plain.stderr || plain.error?.message)
  assert.equal(JSON.parse(plain.stdout).services['places-sweep'], undefined)

  const asked = renderCompose({ COMPOSE_PROFILES: 'sweep' })
  assert.equal(asked.status, 0, asked.stderr || asked.error?.message)
  const sweep = JSON.parse(asked.stdout).services['places-sweep']
  assert.ok(sweep, 'the sweep service is there when its profile is')
  /* The same image the tests ran against and the API is running, by commit —
     a sweep built from anything else would be writing seventy-three million
     rows with code nobody reviewed against this schema. */
  assert.equal(sweep.image, JSON.parse(asked.stdout).services.api.image)
  /* The retry of last resort, and the only one a bug in the sweep itself
     cannot defeat. `on-failure` and not `always`: the script exits zero when
     the planet is loaded or when a run made no progress at all, so this
     restarts a crash, an out-of-memory kill, a reboot and a release deleted
     mid-run, and does not sweep the planet again the moment it succeeds or
     spin on a run that is getting nowhere. */
  assert.equal(sweep.restart, 'on-failure')
  assert.ok(
    sweep.command.includes('--resume'),
    'a restarted sweep must pick up rather than start the planet again',
  )
  assert.ok(
    sweep.command.some(word => String(word).startsWith('--max-old-space-size')),
    'the peak is about 1.5 million held records; the default heap dies two hours in',
  )
})

test('the deploy starts a sweep without being able to fail over it', () => {
  const script = deployScript()
  const block = script.slice(script.indexOf('places_ask()'), script.indexOf('# Media onto'))
  assert.ok(block.includes('places_ask()'), 'the deploy asks what is covered before it starts one')
  /* github-deploy.sh runs under `set -Eeuo pipefail` past the point where the
     rollback trap has come off, so an unguarded non-zero here is a release
     that is live and answering being reported as a failure. The reading is
     `|| true`; the start is the test of an `if`, which `set -e` does not
     treat as an error either way. */
  assert.match(block, /\|\| true\n\}/, 'the coverage reading cannot fail the deploy')
  /* By Compose's own labels rather than `compose ps`. The first live run
     proved why: `compose ps --profile sweep --status running -q` came back
     empty while the sweep was running, so the deploy said it had started one
     when it had not. `docker ps --filter label=` needs no profile to see it. */
  assert.match(block, /^if \[ -n "\$\(docker ps -q --filter status=running/m)
  assert.ok(block.includes('label=com.docker.compose.service=places-sweep'))
  assert.match(block, /^ {2}if docker compose --profile sweep up -d --no-build places-sweep/m)
  assert.ok(block.includes('could not be started'), 'a start that fails says so')
  /* --no-build: the box pulls what the pipeline pushed and builds nothing. */
  assert.ok(!/docker compose[^\n]*up[^\n]*--build/.test(block))
  /* And why the last one stopped, which is the whole diagnostic. The first
     live planet run exited somewhere in the Atlantic; the deploy key is
     restricted to `deploy <sha>` and there is no shell on that box, so a run
     that ends says so here or it has said so nowhere at all. */
  assert.ok(block.includes('docker ps -aq --filter label=com.docker.compose.service=places-sweep'))
  assert.ok(block.includes('{{.State.ExitCode}}'), 'the exit code of the last sweep')
  assert.match(block, /docker logs --tail \d+ "\$stopped_sweep"/, 'and its last words')
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
