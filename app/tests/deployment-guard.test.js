import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
  /* No number asserted here on purpose — how long the deploy waits has to
     agree with the api's healthcheck, and that agreement is checked where
     the healthcheck can actually be read. Here only that it waits at all. */
  assert.match(script, /docker compose up -d --no-build --wait --wait-timeout \d+/)
  assert.match(script, /docker compose up -d --build --wait --wait-timeout \d+/)

  /* The schema is the api's boot, and the deploy creates nothing to do it.
   *
   * It was a step here for four releases. Creating the one-off container was
   * 1m56s of deploy 370 and 2m51s of 374 — either side of two seconds of SQL
   * — while deploy 373 created a container with four more mounts in 8.8
   * seconds. The container was never the variable; the planet sweep holding
   * the disk was, which is why it is paused for the swap instead.
   *
   * What makes the boot the right place again is guard 201: a migration
   * changes the schema and never does work whose size depends on how much
   * data there is. index.js has always migrated before it listens, so the
   * step here was applying a schema the next container would have applied
   * itself. */
  assert.ok(!/^[^#\n]*compose[^\n]*\brun\b/m.test(script), 'the deploy creates a one-off container')
  assert.match(
    readFileSync(path.join(appRoot, 'server', 'src', 'index.js'), 'utf8'),
    /await repository\.migrate\(\)/,
    'nothing applies the schema: the deploy does not and neither does the boot',
  )
  assert.ok(
    existsSync(path.join(appRoot, 'server', 'scripts', 'migrate.mjs')),
    'the by-hand schema entry point is gone',
  )
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
  /* The images are put together in the checks job, beside the unit tests,
     the typechecker and the guard rather than after them. The property is
     per process rather than an order: each is waited on, and any one of them
     failing fails the job. A `wait` that does not set `failed` is a check
     whose failure is a line in a log. */
  for (const job of ['unit', 'types', 'guard', 'built']) {
    assert.ok(
      workflow.includes(`wait "$${job}" || failed=1`),
      `${job} is started in the background and its result is not waited on`,
    )
  }
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

/* The enrichment pipeline reaches the box, or it is merged and dark.
 *
 * It was merged and dark: every module written and tested, the worker never
 * constructed on the box because PLACES_CONTACT appeared nowhere in compose
 * or the workflow. Nothing failed — it simply never ran, which is the worst
 * shape a thing can be in, and a suite that only tested the modules could
 * not tell.
 *
 * The contact address is the switch on purpose. Wikimedia require a
 * User-Agent naming the operator and enforce it, so the address being set is
 * the same fact as the pipeline being allowed to run; there is no separate
 * flag somebody could turn on while leaving it blank. */
test('the enrichment pipeline can actually be switched on', () => {
  const compose = readFileSync(path.join(appRoot, 'docker-compose.yml'), 'utf8')
  const workflow = readFileSync(
    path.join(appRoot, '..', '.github/workflows/deploy-vps.yml'),
    'utf8',
  )

  /* On the api, which is what runs the worker — not on the sweep, which
     runs the ingest script and has no use for it. */
  const api = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  places-sweep:'))
  assert.match(api, /PLACES_CONTACT:/, 'the api is given a contact address')

  /* And it reaches the box: named in the workflow's environment and written
     into the release file the box reads. */
  assert.match(workflow, /PLACES_CONTACT: \$\{\{ vars\.PLACES_CONTACT \}\}/)
  assert.match(workflow, /echo "PLACES_CONTACT=\$PLACES_CONTACT"/)

  /* Empty is allowed and means off. A compose file that refused to render
     without it would stop every deploy on a box that has not set one. */
  assert.match(api, /PLACES_CONTACT: \$\{PLACES_CONTACT:-\}/, 'unset is off, not a failure')
})

/* The database is told how big the machine is.
 *
 * It ran on stock PostgreSQL defaults for the whole of the places layer's
 * life — 128 MB of shared buffers and a gigabyte of WAL between checkpoints,
 * on a box with sixty-two gigabytes and sixteen cores. Those defaults exist
 * so PostgreSQL starts anywhere, not so it runs well, and they are not a
 * missed optimisation here: a gigabyte of WAL while ten million rows go in is
 * a checkpoint every few seconds, and the write storm that follows is what
 * made two container recreates take six minutes each in deploy 368 while
 * everything else on the machine queued for the same disk.
 *
 * Asserted as "not the default and not a laptop's" rather than as exact
 * numbers, because the right numbers are a share of whatever this box turns
 * out to be and the wrong one is any of them being absent. The one thing
 * pinned exactly is durability: nothing here may buy speed with somebody's
 * trip.
 */
test('the database is configured for the machine it runs on', {
  skip: dockerAvailable ? false : 'docker is not installed on this machine',
}, () => {
  const result = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: appRoot,
    env: composeEnv(),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const db = JSON.parse(result.stdout).services.db
  const command = (db.command || []).join(' ')
  assert.ok(command.startsWith('postgres '), 'the database is given settings on its command line')

  const sizeOf = name => {
    const found = command.match(new RegExp(`${name}=(\\d+)(MB|GB)`))
    assert.ok(found, `${name} is set`)
    return Number(found[1]) * (found[2] === 'GB' ? 1024 : 1)
  }
  /* Defaults are 128 MB and 1 GB. Anything near them means this was lost. */
  assert.ok(sizeOf('shared_buffers') >= 2048, "shared buffers are gigabytes, not a laptop's")
  assert.ok(sizeOf('max_wal_size') >= 4096, 'checkpoints are minutes apart, not seconds')
  assert.ok(sizeOf('maintenance_work_mem') >= 512, 'an index build has room to sort in memory')
  assert.match(command, /work_mem=\d+MB/, 'sorts have more than the default four megabytes')
  /* An SSD. The default of 4.0 is the ratio for a disk with a head to move,
     and it biases the planner into reading whole tables. */
  assert.match(
    command,
    /random_page_cost=[01]\.\d/,
    'the planner knows this is not a spinning disk',
  )

  /* And the line nothing may cross. */
  assert.doesNotMatch(command, /fsync=off/, 'fsync stays on')
  assert.doesNotMatch(command, /synchronous_commit=off/, 'commits stay durable')
  assert.doesNotMatch(command, /full_page_writes=off/, 'torn pages stay impossible')
})

/* The deploy's critical path is: make the schema right, swap the containers,
 * check the site answers. Nothing else.
 *
 * Everything before that health check can roll a release back, so everything
 * before it has to be a thing whose failure genuinely means the release is
 * bad. Configuring Logto's sign-in experience is not: it is idempotent, it
 * has been true for three hundred releases, and it waits on somebody else's
 * container seeding its own schema — three minutes of deploy 364, above the
 * gate, where a slow neighbour could undo a perfect release.
 *
 * So the order is asserted, not just the contents. Asking whether the site
 * answers comes first; the census, the sweep, the object-store cutover and
 * Logto's sign-in configuration all come after, each with `|| true`, each
 * loud in the log, none able to undo a release that is up and answering.
 */
test('nothing that cannot fail a release runs before the health check', () => {
  const script = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  const gate = script.indexOf('/api/health')
  assert.ok(gate > 0, 'the deploy asks whether the site answers')

  for (const [what, needle] of [
    ["Logto's sign-in configuration", 'bash ./deploy/configure-logto.sh'],
    ['the day census', 'api node server/scripts/day-census.mjs'],
    ['the object store cutover', 'object-storage.sh cutover'],
  ]) {
    const at = script.indexOf(needle)
    assert.ok(at > 0, `the deploy runs ${what}`)
    assert.ok(at > gate, `${what} runs after the health check, not before it`)
    /* And on a line that cannot fail the deploy. */
    const line = script.slice(at, script.indexOf('\n', at))
    assert.match(line, /\|\| true\s*$/, `${what} cannot undo a release that is answering`)
  }

  /* And none of it holds the deploy open.
   *
   * `|| true` stops housekeeping failing a release; it does nothing about
   * housekeeping taking twenty-five minutes of one, which deploy 368 did
   * with the release live for most of them. The deploy ends at the health
   * check and the rest runs in a session of its own — `setsid` so closing
   * the channel cannot signal it, and the redirections because ssh waits on
   * the pipe rather than on the process. */
  const detached = script.indexOf('setsid bash -c')
  assert.ok(detached > gate, 'the housekeeping is detached after the health check')
  const call = script.slice(detached, script.indexOf('disown', detached))
  assert.match(
    call,
    />>\s*"\$AFTER_LOG"\s*2>&1\s*<\s*\/dev\/null\s*9>&-\s*&/,
    'and lets go of the channel',
  )
  /* `9>&-` is not tidiness. Fd 9 is the release lock, a child inherits every
     descriptor its parent had open, and so the housekeeping — detached
     exactly because it is not the release and must hold nobody up — was
     keeping the lock for the whole of its run. Deploy 400 arrived, found a
     docker-compose on /run/lock/wayfare-deploy.lock, and exited 75 without
     touching the box: the merge it carried never went out and production sat
     on the release before it, with a red tick the only sign. 393 was the
     same and we read it as a release still swapping, because that lock held
     by that process is a convincing story.
     Whatever else moves here, the detached half must not hold the lock. */
  assert.match(call, /9>&-/, 'the housekeeping inherits the release lock and holds it')
  /* A detached shell gets the environment and nothing else. */
  assert.match(script, /export APP_ROOT deployment_domain image_repo release_sha/)
  for (const [what, needle] of [
    ["Logto's sign-in configuration", 'bash ./deploy/configure-logto.sh'],
    ['the day census', 'api node server/scripts/day-census.mjs'],
    ['the object store cutover', 'object-storage.sh cutover'],
  ]) {
    assert.ok(
      script.indexOf(needle) < detached,
      `${what} is inside the detached block, not left holding the deploy open`,
    )
  }
})

/* A migration changes the schema. It does not do work whose size depends on
 * how much data there is.
 *
 * Migrations run inside the api's boot, and a boot is waited on by
 * `compose up --wait` and by web's `depends_on: api: service_healthy`. Those
 * are timeouts that belong to containers: a few minutes, fixed, and one of
 * them cannot be raised from the deploy at all. So anything a migration does
 * has to be over in seconds on the largest database this will ever run
 * against — an ALTER, a small table, a constraint.
 *
 * Building an index is the thing that looks like schema and is not. Migration
 * 051 built a GiST index over ten million places, the api never became
 * healthy, the deploy restored the previous release, the half-built index
 * rolled back with it, and the next release did it all again — five in a row,
 * and the loop could not be broken from inside, because the deploy script
 * that would have fixed it is only installed once a deploy succeeds.
 *
 * An index on a table that grows with the world belongs to the worker, built
 * CONCURRENTLY while the api serves — see places/worker.js buildTheIndex.
 * Until it is there the queries are slower, which ships; a boot that never
 * finishes does not.
 *
 * Creating the table and its indexes together is fine and is not this: at
 * that moment the table is empty on every database in the world. What is
 * caught here is a later migration reaching for a table that is not.
 */
test('no migration builds an index on a table that has grown', () => {
  const directory = path.join(appRoot, 'server', 'migrations')
  const files = readdirSync(directory)
    .filter(name => name.endsWith('.sql'))
    .sort()

  /* The tables whose size is the world's, not a traveller's. */
  const unbounded = [
    'places',
    'place_sources',
    'place_tiles',
    'place_links',
    'place_images',
    'osm_landmarks',
    'photos',
  ]
  /* Four that shipped before the rule was known, and are applied on every
     database there is — rewriting history would re-run them on nothing and
     risk a great deal to tidy a list. Three are on `photos` and were written
     when a trip held a few hundred; the fourth, 048, is the one that taught
     the lesson on a table of ten million. Nothing may be added here without
     the same kind of sentence beside it. */
  const alreadyShipped = new Set([
    '002_account_deletion_and_trip_integrity.sql:photos',
    '004_photo_idempotency.sql:photos',
    '022_photo_order_per_trip.sql:photos',
    '048_a_place_earns_a_picture.sql:places',
  ])
  const born = new Map()
  const offences = []
  for (const name of files) {
    const sql = readFileSync(path.join(directory, name), 'utf8')
    /* Comments say what went wrong and quote the SQL that did it; only the
       statements count. */
    const statements = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
    for (const table of unbounded) {
      if (new RegExp(`create table (if not exists )?${table}\\b`).test(statements)) {
        if (!born.has(table)) born.set(table, name)
      }
      const builds = new RegExp(`create (unique )?index[^;]*\\bon ${table}\\b`, 'i')
      if (
        builds.test(statements) &&
        born.get(table) !== name &&
        !alreadyShipped.has(`${name}:${table}`)
      ) {
        offences.push(
          `${name} builds an index on ${table}, born in ${born.get(table) ?? 'nowhere'}`,
        )
      }
    }
  }
  assert.deepEqual(
    offences,
    [],
    `${offences.join('; ')}\n\nBuild it from the worker, concurrently, not from a boot.`,
  )
})

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

  /* The deploy is at least as patient as the healthcheck.
   *
   * Two numbers that have to agree and neither of which mentions the other.
   * `compose up --wait` stops waiting at --wait-timeout; the container is
   * only called unhealthy once start_period is over. While the timeout was
   * the shorter of the two, a boot still inside its own allowance was read
   * as a failure and restored away — deploy 363, where one migration built
   * a GiST index over ten million places, passed three minutes, and took a
   * release with it that would have come up fine. */
  const deployScript = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  const services = JSON.parse(result.stdout).services
  /* Each wait against the boot it is actually waiting for. A line that names
     services waits for those; a line that names none waits for the whole
     stack, and the api's is the longest start period in it. */
  const waits = [...deployScript.matchAll(/--wait-timeout (\d+)([^\n]*)/g)].map(found => ({
    seconds: Number(found[1]),
    named: found[2]
      .trim()
      .split(/\s+/)
      .filter(name => name && name in services),
  }))
  assert.ok(waits.length >= 2, 'the deploy waits for the stack to come up')
  for (const wait of waits) {
    const waitedOn = wait.named.length ? wait.named : Object.keys(services)
    for (const name of waitedOn) {
      const period = services[name].healthcheck?.start_period
      if (!period) continue
      assert.ok(
        wait.seconds >= seconds(period),
        `the deploy gives up after ${wait.seconds}s on ${name}, whose healthcheck ` +
          `allows ${period} to boot`,
      )
    }
  }
  /* And the one that waits for everything is still the api's, which is the
     number that took five releases to get right. */
  assert.ok(
    waits.some(wait => !wait.named.length && wait.seconds >= seconds(health.start_period)),
    'no unqualified wait covers the api start period',
  )
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
  /* Indented now: the whole block lives inside `after_release`, which runs
     detached once the release is live. */
  assert.match(block, /\|\| true\n\s*\}/, 'the coverage reading cannot fail the deploy')
  /* By Compose's own labels rather than `compose ps`. The first live run
     proved why: `compose ps --profile sweep --status running -q` came back
     empty while the sweep was running, so the deploy said it had started one
     when it had not. `docker ps --filter label=` needs no profile to see it. */
  /* The `up` is unconditional, and that is the point of this assertion: while
     it was skipped whenever a sweep was running, a configuration change — the
     four cores and the block-IO weight that stop it pinning the box during a
     deploy — could never reach the container already going. `up -d` on a
     service whose configuration has not changed is a no-op, so a run three
     hours in is still left alone; the profile is what keeps a plain
     `compose up` away from it. */
  /* The restart is not in the detached half any more, and that ordering is
     the assertion: the census above the detach reports whether a sweep is
     running, so a start that happens after it reports a sweep that is down
     when it is not. Deploy 380 said "no sweep running; the last one exited 1"
     ninety seconds after the deploy's own stop — true for the instant it was
     asked, and identical to what a sweep that had genuinely died would say. */
  const restartAt = script.search(/^if docker compose --profile sweep up -d --no-build/m)
  const censusAt = script.indexOf('places_held="$(places_now')
  const detachedAt = script.indexOf('Housekeeping detached')
  assert.ok(restartAt > 0, 'the deploy never starts the sweep again')
  assert.ok(restartAt > detachedAt, 'the restart is back inside the detached half')
  assert.ok(restartAt < censusAt, 'the census reports on a sweep the deploy has not started yet')
  const stopAt = script.search(/^docker compose --profile sweep stop/m)
  assert.ok(stopAt < restartAt, 'the sweep is started before it is stopped for the swap')
  assert.ok(script.includes('could not be started'), 'a start that fails says so')
  /* --no-build on the sweep: the box pulls what the pipeline pushed and
     builds nothing. Scoped to the sweep's own line, because the hand-deploy
     branch above legitimately builds when there is no registry token. */
  assert.ok(!/--profile sweep up[^\n]*--build\b(?!-)/.test(script.replace(/--no-build/g, '')))
})

test('the census can tell a crash-looping sweep from a finished one', () => {
  /* The line this replaces could not see the state that actually happened.
     It asked `docker ps --filter status=running`, and a container Docker is
     restarting is neither running nor exited — `inspect` even reports its
     exit code as 0 while it restarts. So a sweep dying at module load in 150
     milliseconds, put back every minute for eight hours, printed "no sweep
     running; the last one exited 0", which is what a sweep that finished the
     planet prints. Nothing else on this box can be asked: the key runs one
     command and there is no shell. */
  const script = deployScript()
  const census = script.slice(
    script.indexOf('sweep_box="$(docker ps -aq'),
    script.indexOf('--- capacity ---'),
  )
  assert.ok(census.includes('docker ps -aq'), 'the census finds the sweep by Compose label')
  assert.ok(census.includes('label=com.docker.compose.service=places-sweep'))
  assert.match(
    census,
    /docker inspect -f '\{\{\.State\.Status\}\}'/,
    'the state comes from the word Docker has for it, not from a ps filter',
  )
  for (const state of ['running)', 'restarting)']) {
    assert.ok(census.includes(state), `the census has a branch for ${state.slice(0, -1)}`)
  }
  assert.ok(census.includes('{{.State.ExitCode}}'), 'the exit code of a sweep that stopped')
  assert.ok(census.includes('{{.RestartCount}}'), 'how many times a crash-looping one has died')
  /* Its last lines in every one of the three cases, not only the stopped one:
     a running sweep has a progress line, a crash-looping one has the stack
     that kills it, and each answers a different question a person has. */
  const logsAt = census.search(/^\s*docker logs --tail \d+ "\$sweep_box"/m)
  assert.ok(logsAt > 0, 'the census prints the last lines of the sweep')
  assert.ok(
    logsAt > census.indexOf('esac'),
    'the last lines are printed after the case, so every state gets them',
  )
  /* And none of it may fail a release that is live and answering. */
  assert.match(census, /docker logs[^\n]*\| sed [^\n]*\|\| true/)
})

test('work nobody is waiting for does not hold the connections people are', () => {
  /* The places worker runs inside the api process, and it held connections
     from the same pool of ten that serves the map. A dense cell's zoom pass
     is seven and a half seconds inside one transaction, continuously, for
     thirteen thousand cells; a phone wants six connections for the six tiles
     on its screen. The query was never the problem — 1.3ms on an idle box,
     270 to 970ms in production — the queue in front of it was.

     Read from the source rather than from a running server, because the thing
     that must not drift is which pool the wiring hands over. */
  const wiring = readFileSync(path.join(appRoot, 'server', 'src', 'index.js'), 'utf8')
  /* Stated as the absence rather than by finding each worker and reading its
     arguments: whatever is wired up in here, none of it may be handed the
     pool the map is served from. */
  assert.ok(
    !/pool: repository\.pool\b/.test(wiring),
    'something inside the api runs on the pool that serves the map',
  )
  assert.ok(
    (wiring.match(/repository\.background/g) || []).length >= 2,
    'the workers are not on the background pool',
  )
  const postgres = readFileSync(path.join(appRoot, 'server', 'src', 'postgres.js'), 'utf8')
  assert.match(postgres, /const background = new pg\.Pool/, 'there is no background pool')
  /* Both bounded, so a starved pool is an error somebody can see rather than
     a request that hangs until the phone gives up. */
  assert.equal(
    (postgres.match(/connectionTimeoutMillis/g) || []).length,
    2,
    'a pool can wait for ever for a connection',
  )
})

test('no line of the census can outlast the release it reports on', () => {
  /* Deploy 387 was live, healthy and answering, and failed anyway. The step
     that streams a release is allowed four minutes; the swap was done in
     three and the census that follows it then sat on
     `select count(*) from places` — thirteen million rows on a box where the
     zoom pass was sorting six rows per place and the sweep was writing a cell
     a minute — until the step timed out.

     Every line down there ends in `|| true` so that a census cannot fail a
     release, and a query that never returns walks straight around that. So
     the bound is a clock, twice: ten seconds inside postgres and fifteen
     outside it, because a wedged `docker exec` never reaches the statement
     timeout at all. */
  const script = deployScript()
  const at = script.indexOf('places_now() {')
  const helper = script.slice(at, script.indexOf('}', at))
  assert.match(helper, /timeout \d+ docker compose exec/, 'the census can hang on the daemon')
  assert.match(
    helper,
    /PGOPTIONS="-c statement_timeout=\d+s"/,
    'the census can hang in the database',
  )
  /* As a connection option, not as a statement: psql prints a command tag for
     every statement it runs, and a `SET` in front of the query put the word
     SET where each number should have been. */
  assert.ok(!/set statement_timeout/i.test(helper.replace(/PGOPTIONS[^"]*"[^"]*"/, '')))
  /* And it still says something when the clock wins: the planner's estimate,
     marked as one. A blank where a number goes is a census that has failed
     quietly, which is the thing this whole block exists to stop. */
  assert.match(script, /reltuples::bigint from pg_class/, 'no fallback when the count is too slow')
  assert.match(script, /places_held="~\$\(/, 'an estimate that does not say it is one')
})

test('a deploy reading a number does not mangle it on the way out', () => {
  /* `psql -tA` is tuples-only and unaligned: it pads nothing. The helper
     stripped spaces anyway, for padding that does not exist, and the backlog
     sentence came out as `494neverzoomed,73underanolderrule,8mid-ingest`.
     A line whose only job is to be read by a person, made unreadable by a
     tidy-up for a problem the flags had already solved. */
  const script = deployScript()
  const at = script.indexOf('places_now() {')
  const helper = script.slice(at, script.indexOf('}', at))
  assert.match(helper, /psql -U wayfare -d wayfare\b/, 'the census asks the database directly')
  assert.match(helper, /-tAc/, 'unaligned, tuples only')
  assert.ok(!helper.includes("tr -d ' '"), 'and nothing strips the spaces back out of the answer')
})

/** JSON with comments, which is how Biome's own configuration is written. A
    scanner rather than a regex, because `"$schema": "https://biomejs.dev/..."`
    is a string that contains what looks like a comment. */
const readJsonc = file => {
  const text = readFileSync(file, 'utf8')
  let out = ''
  let at = 0
  while (at < text.length) {
    if (text[at] === '"') {
      let end = at + 1
      while (end < text.length) {
        if (text[end] === '\\') {
          end += 2
          continue
        }
        if (text[end] === '"') break
        end += 1
      }
      out += text.slice(at, end + 1)
      at = end + 1
      continue
    }
    if (text[at] === '/' && text[at + 1] === '/') {
      while (at < text.length && text[at] !== '\n') at += 1
      continue
    }
    if (text[at] === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2)
      at = end < 0 ? text.length : end + 2
      continue
    }
    out += text[at]
    at += 1
  }
  return JSON.parse(out)
}

test('the commands the containers run are checked before a container runs them', () => {
  /* The bug this exists for. #211 deleted LABEL_PER_TILE from rank.js;
     server/scripts/places-ingest.mjs still imported it; the planet sweep is
     `node server/scripts/places-ingest.mjs --planet --sweep --resume` and it
     died at module load in 150 milliseconds. Docker put it back every minute
     for eight hours, the deploy log said "no sweep running; the last one
     exited 0", and the world stopped loading at a quarter of it.

     Every test in the suite passed, because a script is an entrypoint:
     nothing imports it, so nothing loads it, and a deleted export is
     invisible until the container runs the command. `src/` cannot have this
     bug — tsc reads every file under full strict — and the server is plain
     JavaScript that no typechecker ever opened.

     So: the paths exist, and the lint step link-checks the tree they live
     in. Both halves matter. A path that exists proves nothing about whether
     the module graph behind it resolves, which is what actually broke. */
  const named = new Set()
  for (const file of ['docker-compose.yml', path.join('server', 'Dockerfile')]) {
    const text = readFileSync(path.join(appRoot, file), 'utf8')
    for (const [match] of text.matchAll(/server\/[\w/.-]+\.m?js\b/g)) named.add(match)
  }
  assert.ok(named.size >= 3, `expected the containers to name scripts, saw ${[...named]}`)
  for (const script of named) {
    assert.ok(
      existsSync(path.join(appRoot, script)),
      `docker runs ${script} and it is not in the repository`,
    )
  }

  const biome = readJsonc(path.join(appRoot, 'biome.jsonc'))
  /* Cross-file analysis is what reads an export in one file against an import
     in another; without the domain the rule below cannot see anything. */
  assert.ok(biome.linter?.domains?.project, 'the project domain is off, so nothing is link-checked')
  const covers = new Set()
  for (const override of biome.overrides || []) {
    const rule = override.linter?.rules?.correctness?.noUnresolvedImports
    if (rule !== 'error' && rule?.level !== 'error') continue
    for (const pattern of override.includes || []) covers.add(pattern)
  }
  const reaches = file => [...covers].some(pattern => file.startsWith(pattern.replace(/\*+$/, '')))
  for (const script of named) {
    assert.ok(reaches(script), `nothing link-checks ${script}; see biome.jsonc overrides`)
  }
  assert.ok(reaches('server/src/'), 'the modules those scripts import are link-checked too')
})

test('the pipeline compiles the code it ships', () => {
  /* It did not, for three releases. `tsc --noEmit` is a script in
     package.json that nothing ran: a call site was still handing a `limit` to
     a places API that had stopped taking one, and the bundle was built,
     pushed and served by a pipeline that had never asked whether it compiled.
     Vite builds with esbuild, and esbuild strips types rather than checking
     them, so "it built" says nothing at all about whether it typechecks.

     Two seconds, beside the unit tests, on the job the deploy waits for. */
  const workflow = readFileSync(
    path.join(appRoot, '..', '.github', 'workflows', 'deploy-vps.yml'),
    'utf8',
  )
  const checks = workflow.slice(workflow.indexOf('\n  checks:'), workflow.indexOf('\n  server:'))
  assert.match(checks, /pnpm typecheck/, 'nothing in the checks job typechecks')
  /* Waited on, not merely started: a background process nobody waits for is a
     check whose failure is a line in a log. */
  assert.match(checks, /wait "\$types" \|\| failed=1/, 'the typecheck cannot fail the run')
  const scripts = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')).scripts
  assert.match(scripts.typecheck, /tsc --noEmit/)
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

/** One top-level job of a workflow, from its name to the next job's.
    By structure rather than by a character count: two guards below used fixed
    windows of 900 and 1,200 characters, and both quietly stopped covering
    what they were named the moment a comment above the thing grew. A guard
    defeated by a comment is a guard nobody can trust the absence of. */
function blockOf(workflow, name) {
  const from = workflow.indexOf(`\n  ${name}:\n`)
  if (from < 0) return ''
  /* Past the job's own header line, which matches the same pattern the next
     job does. */
  const body = from + `\n  ${name}:\n`.length
  const next = workflow.slice(body).search(/^ {2}[a-z][a-z0-9_-]*:$/m)
  return next === -1 ? workflow.slice(from) : workflow.slice(from, body + next)
}

test('nothing in the pipeline may run without a limit', () => {
  /* Every job had six hours, which is GitHub's default and nobody's
     intention. Deploy 368 ran for eighteen minutes and 370 for eleven, and in
     both cases the extra minutes bought nothing: the release was either
     already live or was never going to be. A job that runs past its budget is
     not being slow, it is stuck, and a stuck job that fails is worth more than
     one that holds the box and a runner until somebody notices. */
  const workflow = readFileSync(
    path.join(appRoot, '..', '.github', 'workflows', 'deploy-vps.yml'),
    'utf8',
  )
  const jobs = [...workflow.matchAll(/^ {2}([a-z][a-z0-9_-]*):$/gm)].map(m => m[1])
  assert.ok(jobs.length >= 5, `expected the five jobs, saw ${jobs.join(', ')}`)
  for (const job of jobs) {
    const block = workflow.slice(
      workflow.indexOf(`\n  ${job}:\n`),
      workflow.indexOf(`\n  ${job}:\n`) + 2000,
    )
    assert.match(block, /^ {4}timeout-minutes: \d+$/m, `job "${job}" has no timeout-minutes`)
  }
  /* And the release itself, inside the job that runs it — bounded, and by
     less than the job that contains it.
   *
   * That second half is the one with teeth, and it is the one this missed. A
   * step allowed eight minutes inside a job allowed five is killed at five,
   * by the job, with a message about the job: the step's number is
   * decoration, and the ceiling anybody reads when the deploy goes red is
   * not the ceiling that stopped it. This test used to say `[1-5]` and would
   * have let that through as long as the digit was small enough.
   *
   * Measured by structure rather than by a character count. Both windows
   * here were fixed slices — 900 and 1200 — and both silently stopped
   * covering what they were named after the moment a comment above the thing
   * grew. A guard that is defeated by a comment is a guard nobody can trust
   * the absence of. */
  const deploy = blockOf(workflow, 'deploy')
  const jobCeiling = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(deploy)?.[1])
  assert.ok(Number.isFinite(jobCeiling), 'the deploy job is unbounded')

  const stepFrom = deploy.indexOf('name: Stream release to the VPS')
  assert.ok(stepFrom > 0, 'the release step is not in the deploy job')
  const after = deploy.slice(stepFrom)
  const stepEnd = after.slice(1).search(/^ {6}- name:/m)
  const step = stepEnd === -1 ? after : after.slice(0, stepEnd + 1)
  const stepCeiling = Number(/^ {8}timeout-minutes: (\d+)$/m.exec(step)?.[1])
  assert.ok(Number.isFinite(stepCeiling), 'the ssh release step is unbounded')
  assert.ok(
    stepCeiling < jobCeiling,
    `the release step is allowed ${stepCeiling} minutes inside a job allowed ${jobCeiling}; ` +
      'the job would kill it first and say nothing about the release',
  )
})

test('tests do not queue behind the previous deploy', () => {
  /* The production lock was over the whole workflow, so a push waited for the
     previous push's deploy before its own tests could start: run 372 sat in a
     queue from 02:19:52 until 370 released it at 02:24:42, then tested in
     eighty-one seconds. Tests share nothing and touch no box. The box is the
     only real conflict, so the lock belongs on the job that touches it. */
  const workflow = readFileSync(
    path.join(appRoot, '..', '.github', 'workflows', 'deploy-vps.yml'),
    'utf8',
  )
  const top = workflow.slice(0, workflow.indexOf('\njobs:'))
  assert.ok(
    !/^concurrency:$/m.test(top),
    'a workflow-level concurrency group makes every job queue, tests included',
  )
  /* The whole job, not the first 1,200 characters of it: that window stopped
     covering the concurrency block the first time a comment above it grew,
     and a guard defeated by a comment is one nobody can trust the absence
     of. */
  const deploy = blockOf(workflow, 'deploy')
  assert.match(
    deploy,
    /^ {4}concurrency:\n {6}group: off-we-go-production\n {6}cancel-in-progress: false$/m,
    'the deploy job does not hold the production lock',
  )
})

test('the schema step carries nothing but the schema', () => {
  /* `docker compose run --rm api node server/scripts/migrate.mjs` was 1m56s
     of deploy 370 spent creating a container, against 2.1 seconds of SQL
     inside it. `run api` instantiates the api's whole service: four mounts,
     one of them the twelve-gigabyte tile volume, and a NODE_OPTIONS that
     loads the OpenTelemetry SDK before any of our code. A migration needs a
     database URL and an admin address. */
  const compose = readFileSync(path.join(appRoot, 'docker-compose.yml'), 'utf8')
  const service = compose.slice(
    compose.indexOf('\n  migrate:\n'),
    compose.indexOf('\n  # The planet, once, in the background.'),
  )
  assert.ok(service.includes('profiles: ["migrate"]'), 'a plain `compose up` would start it')
  assert.ok(!/^\s+volumes:/m.test(service), 'the schema step mounts a volume')
  assert.ok(!service.includes('NODE_OPTIONS'), 'the schema step loads instrumentation')
  assert.ok(!/^\s+depends_on:/m.test(service), 'the schema step waits on a container')
  assert.ok(service.includes('server/scripts/migrate.mjs'))

  /* By hand, never by the deploy: for a schema that has to be moved without
     recreating anything. The deploy's own copy is the api's boot. */
  const deploy = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  const code = deploy
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')
  assert.ok(!/compose[^\n]*\brun\b/.test(code), 'the deploy creates a one-off container')
})

test('a backfill nobody is waiting for does not hold a deploy', () => {
  /* Deploy 373 created a container in 8.8 seconds and 374 took 2m51s, on the
     same box, six minutes apart, for the same command. The difference is the
     planet sweep: since deploy 370 it has been reading sixteen Parquet parts
     at 7,250 records a second across sixteen cores, and everything else on
     the machine queues behind it for the disk.

     Not a cap — there was one for a release and it was the wrong lever on a
     box this size. The two are not made to share, they take turns: the sweep
     stops for the swap and the housekeeping starts it again once the release
     is live, and `--resume` means that costs the cell in flight and nothing
     else. */
  const deploy = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  const stopAt = deploy.search(/^docker compose --profile sweep stop[^\n]*places-sweep/m)
  const swapAt = deploy.search(/^ {2}docker compose up -d --no-build --wait --wait-timeout 900$/m)
  const healthAt = deploy.indexOf('curl --fail --silent --show-error --retry')
  const startAt = deploy.search(/^\s*if docker compose --profile sweep up -d/m)
  assert.ok(stopAt > 0, 'the sweep is not stood down for the swap')
  assert.ok(swapAt > stopAt, 'the sweep is stopped after the containers are swapped')
  assert.ok(startAt > healthAt, 'the sweep is restarted before the release is proved live')
  /* Stopped, not killed and not removed: the coverage rows are the record of
     what is done and the run resumes from them. */
  assert.match(deploy, /--profile sweep stop -t \d+ places-sweep/)
  assert.ok(
    !/--profile sweep (kill|rm|down)/.test(deploy),
    'a sweep three hours in is thrown away rather than paused',
  )
  const sweep = readFileSync(path.join(appRoot, 'docker-compose.yml'), 'utf8')
  assert.match(sweep, /^ {6}- --resume$/m, 'a restarted sweep pays for the whole planet again')
})

test('a deploy queues behind the release in front, out loud, rather than dropping', () => {
  /* This guard said the opposite until deploy 400, and deploy 400 is what
     the opposite costs.

     It found 399's docker-compose still on the lock, waited the ninety
     seconds this test used to insist on, and exited 75. The merge it was
     carrying never reached the box at all: production stayed on the release
     before it, and the only thing anywhere that said so was a red tick.

     The old argument was that a superseded run and a healthy one look alike
     from here, so patience cannot tell them apart and failing fast at least
     says who is holding it. Half right. Silence was the real complaint —
     deploy 370 printed nothing for 2m06s and looked hung. Impatience was
     never the answer to it, because the two outcomes are not symmetric: a
     predecessor holding this lock is a compose swap that ends, so waiting
     costs minutes, while giving up costs the release entirely. The step
     timeout above cannot save it either — that kills an ssh client on a
     runner, and the box finishes whatever it was handed regardless.

     So the rule is now: wait, bounded, and narrate. Long enough to outlast a
     healthy predecessor, short enough that a genuinely stuck one still
     fails, and never a stretch with nothing on the screen. */
  const deploy = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  const bound = deploy.match(/^ *readonly LOCK_WAIT_SECONDS=(\d+)$/m)
  assert.ok(bound, 'the deploy has no bound on how long it waits for the lock')
  const seconds = Number(bound[1])
  assert.ok(
    seconds >= 240,
    `the deploy gives up on the lock after ${seconds}s; a healthy release holds it for minutes ` +
      'and deploy 400 was lost to exactly this',
  )
  assert.ok(
    seconds <= 600,
    `the deploy waits ${seconds}s for the lock; past ten minutes a holder is stuck, not busy`,
  )
  /* Waited for in short hops, so the gap between two lines is a gap somebody
     can sit through. A single long flock is the silence all over again. */
  const hop = deploy.match(/flock -w (\d+) 9/)
  assert.ok(hop, 'the deploy does not take the lock with a timeout')
  assert.ok(
    Number(hop[1]) <= 30,
    `the deploy waits ${hop[1]}s between saying anything; that is the silence deploy 370 was`,
  )
  assert.match(
    deploy,
    /echo "waiting for the release in front: \$\{lock_waited\}s"/,
    'a deploy queued behind another one says nothing while it waits',
  )
  assert.ok(deploy.includes('fuser -v "$LOCK_FILE"'), 'a blocked deploy does not say what holds it')
  assert.match(deploy, /^ *exit 75$/m, 'giving up on the lock is not reported as a failure')
})

/* A box, a release, and the bootstrap that stands between them.
   Runs the real deploy script with its three absolute paths pointed at a
   temporary directory, so every refusal below is the script's own and not a
   regular expression's opinion of it. */
const releaseWorld = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'offwego-handover-'))
  mkdirSync(path.join(dir, 'opt'), { recursive: true })
  mkdirSync(path.join(dir, 'lock'), { recursive: true })
  const installed = path.join(dir, 'installed.sh')
  writeFileSync(
    installed,
    readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
      .replace(/^readonly APP_ROOT=.*$/m, `readonly APP_ROOT=${dir}/opt/wayfare`)
      .replace(/^readonly ROLLBACK_ROOT=.*$/m, `readonly ROLLBACK_ROOT=${dir}/opt/rollback`)
      .replace(/^readonly LOCK_FILE=.*$/m, `readonly LOCK_FILE=${dir}/lock/deploy.lock`)
      .replaceAll('/opt/wayfare-release.XXXXXX', `${dir}/opt/wayfare-release.XXXXXX`)
      .replace(/^(\s*)find \/opt -maxdepth/m, `$1find ${dir}/opt -maxdepth`),
  )
  return {
    dir,
    /* `files` is a map of path-inside-the-archive to contents. */
    deploy(files, { command = `deploy ${'0'.repeat(39)}7` } = {}) {
      const tree = mkdtempSync(path.join(tmpdir(), 'offwego-release-'))
      for (const [where, what] of Object.entries(files)) {
        mkdirSync(path.join(tree, path.dirname(where)), { recursive: true })
        writeFileSync(path.join(tree, where), what)
      }
      const top = readdirSync(tree)
      const archive = path.join(tree, '..', `${path.basename(tree)}.tgz`)
      assert.equal(
        spawnSync('tar', ['-czf', archive, '-C', tree, ...top], { encoding: 'utf8' }).status,
        0,
      )
      const result = spawnSync('bash', [installed], {
        input: readFileSync(archive),
        env: { ...process.env, SSH_ORIGINAL_COMMAND: command },
        encoding: 'utf8',
      })
      rmSync(tree, { recursive: true, force: true })
      rmSync(archive, { force: true })
      return result
    },
    /* Whether the deploy got as far as writing anything to the box. */
    touchedTheBox: () => existsSync(path.join(dir, 'opt', 'wayfare')),
  }
}

test('every deploy runs the deploy script it shipped with', () => {
  /* The script used to run as the copy installed by the last deploy that
     succeeded, so a fix to the deploy could not take effect until a deploy
     had already worked — which is exactly the case where nobody needs one.
     Releases 363 through 367 failed on the same line five times and every fix
     for it sat unread, because none of those five reached the install.

     It bought nothing either: backup.sh, configure-logto.sh and
     object-storage.sh have always run from the pushed copy on the same
     deploy that pushes them. */
  const world = releaseWorld()
  const result = world.deploy({
    'app/deploy/github-deploy.sh': [
      '#!/usr/bin/env bash',
      'set -Eeuo pipefail',
      'echo "ran: $WAYFARE_RELEASE_SHA"',
      'echo "staged: $([[ -f "$WAYFARE_STAGED/app/marker" ]] && echo yes)"',
      /* The lock is an open file description and survives the handover, so
         the two passes are one process holding it once. */
      'echo "lock: $(: >&9 2>/dev/null && echo held)"',
      '',
    ].join('\n'),
    'app/marker': 'the release brought its own tree',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /ran: 0{39}7/, 'the pushed script did not run')
  assert.match(result.stdout, /staged: yes/, 'the pushed script cannot see its own tree')
  assert.match(result.stdout, /lock: held/, 'the deploy lock was dropped at the handover')
})

test('a release that cannot deploy itself changes nothing on the box', () => {
  /* The handover is above every write, so all four of these fail with
     /opt/wayfare untouched — which is a better failure than the old design
     could manage, where a bad script that happened to deploy successfully was
     installed and then broke every deploy after it. */
  for (const [what, files, command, code] of [
    ['no deploy script at all', { 'app/marker': 'x' }, undefined, 66],
    [
      'a deploy script that does not parse',
      { 'app/deploy/github-deploy.sh': 'if then fi done )\n' },
      undefined,
      2,
    ],
    ['a path outside app/', { 'etc/passwd': 'root::0:0\n' }, undefined, 65],
    ['a command that is not a deploy', { 'app/marker': 'x' }, 'bash -i', 64],
  ]) {
    const world = releaseWorld()
    const result = world.deploy(files, command ? { command } : {})
    assert.equal(result.status, code, `${what}: exited ${result.status}\n${result.stderr}`)
    assert.ok(!world.touchedTheBox(), `${what}: wrote to the box before refusing`)
  }
})

test('a deploy says where the planet has got to, where a person can read it', () => {
  /* The box has no shell and the deploy key runs one command, so a line in
     the deploy log is the only channel there is. #202 moved the places census
     into the detached housekeeping along with everything else, and the only
     remaining answer to "is the sweep alive, and how much of the world do we
     hold" became the size of a docker volume in the capacity block.

     The distinction the detach should have drawn: what a deploy *does* can go
     to a file on the box; what it *reports* cannot. */
  const deploy = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  const detachedAt = deploy.indexOf('Housekeeping detached')
  const censusAt = deploy.indexOf('places_held="$(places_now')
  const sweepAt = deploy.indexOf('places: the sweep is running')
  assert.ok(censusAt > 0, 'the deploy does not report how many places there are')
  assert.ok(sweepAt > 0, 'the deploy does not report whether the sweep is running')
  assert.ok(censusAt > detachedAt, 'the census is inside the detached half again')
  /* The whole backlog, in the three shapes it comes in. The first version
     reported `zoom_policy is null` alone and called it "awaiting a zoom",
     which is a third of the answer: a cell ranked under an older rule is
     equally owing — rank.js ZOOM_POLICY had just gone 2 to 3, so twelve
     thousand cells were backlog nobody could see and the log said 617 — and
     a cell wedged in `ingesting` is skipped by the pass on purpose and so
     looks like nothing at all. */
  for (const shape of ['never zoomed', 'under an older rule', 'mid-ingest']) {
    assert.ok(deploy.includes(shape), `the census does not report cells ${shape}`)
  }
  /* Against the table's own newest rule rather than a number copied into
     bash, which is a number that drifts from rank.js the first time it
     changes — which is exactly how this broke. */
  assert.ok(
    deploy.includes('(select max(zoom_policy) from place_coverage)'),
    'the census hard-codes the policy version',
  )
  /* Read-only, and unable to fail a release: it runs below the health check
     and below `trap - ERR`, and every command that could fail says so rather
     than exiting. */
  const census = deploy.slice(censusAt - 400, sweepAt + 600)
  assert.ok(!/\b(insert|update|delete|drop|alter|truncate)\b/i.test(census), 'the census writes')
  assert.ok(
    deploy.indexOf('trap - ERR') < censusAt,
    'the census runs while a failure can still restore the previous release',
  )
})

test('measuring the places queries cannot cost a release', () => {
  /* The tiles were the half reported as slow, so the tiles got a
     Server-Timing header and a probe on a runner to read it. Search and
     nearby sit behind a login, so nothing outside the box could time them —
     and "searching for places takes seconds" stayed a deduction for as long
     as that was true. So the box times them itself.

     Deploy 391 did that in the deploy step, and the step — which has four
     minutes for the whole release — timed out at exactly that: live,
     healthy, answering, and red. Deploy 387 failed the same way on a `select
     count(*)`. The step is near its limit before the census begins, so any
     budget is one that holds until the box is busy.

     The shape that cannot fail: the measuring goes in the detached
     housekeeping, which has no clock over it, and the reporting is a read of
     what the last release wrote. Each assertion below is one way back to a
     red deploy. */
  const deploy = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  const at = deploy.indexOf('places-timings.mjs')
  assert.ok(at > 0, 'the deploy does not measure the places queries')
  /* Run once, and inside the detached half — between the function opening
     and the `setsid` that launches it. */
  assert.equal(
    deploy.split('places-timings.mjs').length - 1,
    1,
    'the timings script is run from more than one place',
  )
  const detachedFrom = deploy.indexOf('after_release() {')
  const detachedTo = deploy.indexOf('setsid bash -c')
  assert.ok(detachedFrom > 0 && detachedTo > detachedFrom, 'the housekeeping is no longer detached')
  assert.ok(
    at > detachedFrom && at < detachedTo,
    'the timings run inside the four-minute step again',
  )
  /* Below `trap - ERR`: nothing after the release is live may roll it back. */
  assert.ok(deploy.indexOf('trap - ERR') < at, 'the timings can fail a release')
  /* Bounded, because `|| true` does not save anything from a command that
     simply never returns — which is the failure both times. */
  const line = deploy.slice(deploy.lastIndexOf('\n', at), deploy.indexOf('\n', at) + 40)
  assert.match(line, /timeout \d+ docker compose exec/, `not bounded: ${line}`)
  assert.ok(deploy.slice(at, at + 200).includes('|| true'), 'the timings can fail the step')

  /* And the census reports them by reading that file, which is the half that
     has to be cheap. A census that runs the measurement is deploy 391 again
     whatever else is true of it. */
  const censusAt = deploy.indexOf('places_held="$(places_now')
  const reads = deploy.indexOf('/^timings: /')
  assert.ok(reads > 0, 'the census does not report the timings at all')
  assert.ok(reads > censusAt, 'the timings are reported before the census that frames them')
  assert.ok(reads > detachedTo, 'the census reads them from inside the detached half')
})

test('the box and the runner watch the same ground', async () => {
  /* Two things ask whether the places layer is alright: a probe on a runner,
     which can only reach what is public over HTTPS, and a script inside the
     box, which can reach the database but not the internet. They held a
     viewport list each for one release, and two lists drift — the runner
     watching Amsterdam while the box measured Toronto, and the first time
     the two disagreed nobody would know whether the layer or the lists had. */
  const shared = path.join(appRoot, 'server', 'src', 'places', 'viewpoints.js')
  const { STANDING, tileFor, centreOf } = await import(pathToFileURL(shared).href)
  assert.ok(STANDING.length >= 5, 'the standing viewports were thinned out')
  for (const name of ['Amsterdam', 'Edinburgh', 'Regina', 'Toronto', 'Dublin']) {
    assert.ok(
      STANDING.some(view => view.name === name),
      `${name} is no longer watched`,
    )
  }
  for (const view of STANDING) {
    assert.ok(view.west < view.east, `${view.name}: west is not west of east`)
    assert.ok(view.south < view.north, `${view.name}: south is not south of north`)
    const middle = centreOf(view)
    assert.ok(middle.lng > view.west && middle.lng < view.east, `${view.name}: centre is outside`)
    assert.ok(middle.lat > view.south && middle.lat < view.north, `${view.name}: centre is outside`)
    /* The slippy arithmetic the map itself does, so a probe built on it asks
       for the squares a phone asks for. A z11 tile of Amsterdam is 1051/673,
       which is the request the live probe has been making all along. */
    const at = tileFor(middle.lng, middle.lat, 11)
    assert.ok(at.x >= 0 && at.x < 2 ** 11, `${view.name}: x off the grid`)
    assert.ok(at.y >= 0 && at.y < 2 ** 11, `${view.name}: y off the grid`)
  }
  assert.deepEqual(tileFor(4.89, 52.37, 11), { z: 11, x: 1051, y: 673 })

  /* And both readers read it from here rather than from a copy. */
  for (const script of ['probe-live-places.mjs', 'places-timings.mjs']) {
    const source = readFileSync(path.join(appRoot, 'server', 'scripts', script), 'utf8')
    assert.match(source, /from '\.\.\/src\/places\/viewpoints\.js'/, `${script} holds its own list`)
  }
})

test('the timings script cannot change a row', () => {
  /* It runs against production on every deploy. That is only defensible
     because every statement it reaches is a select — so it goes through the
     same store.js functions the read routes use, and touches nothing else. */
  const source = readFileSync(path.join(appRoot, 'server', 'scripts', 'places-timings.mjs'), 'utf8')
  assert.ok(!/\b(insert|update|delete|drop|alter|truncate|writePlaceTile)\b/i.test(source))
  /* Two connections. A measurement that takes connections away from the
     people it is measuring is measuring itself. */
  assert.match(source, /max: 2\b/)
  /* And a deadline it stops at, because the census step has four minutes for
     everything it does and an in-view query over a city was 3.7 seconds. */
  assert.match(source, /BUDGET_MS/)
})

test('a release that is live is never reported as a failure', () => {
  /* Deploys 391 and 392 were both red with the site live, healthy and
     answering. The step that streams a release had `timeout-minutes: 4` and a
     note saying that past it "the ERR trap on the box has already restored
     the previous release" — which is not what happens. The timeout kills an
     ssh client on a runner. It runs nothing on the box, and the box's own
     compose swap is allowed `--wait-timeout 900`: the watcher gave up at four
     minutes on work the box was allowed fifteen to do.

     A red deploy that means nothing is worse than none, because the next real
     failure looks exactly like the last two. */
  const workflow = readFileSync(
    path.join(appRoot, '..', '.github', 'workflows', 'deploy-vps.yml'),
    'utf8',
  )
  const at = workflow.indexOf('Stream release to the VPS')
  assert.ok(at > 0, 'the release step was renamed')
  const ceiling = /timeout-minutes:\s*(\d+)/.exec(workflow.slice(at))
  assert.ok(ceiling, 'the release step has no ceiling at all')
  assert.ok(
    Number(ceiling[1]) >= 8,
    `the release step is bounded at ${ceiling[1]} minutes; a saturated box took 3m39s ` +
      'to swap its containers alone',
  )

  /* And the swap says where its time goes. Deploy 392 printed the backup line
     and then nothing for three minutes and sixteen seconds — covering a sweep
     stop, a login, an image pull and two container swaps — and no one could
     say afterwards which of them had it. There is no shell on that box: a
     stretch of a release with no output is a stretch nobody can ever
     diagnose. */
  const deploy = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  assert.match(deploy, /^step\(\) \{/m, 'the swap no longer marks its steps')
  for (const marked of ['sweep stand aside', 'pulling the images', 'swapping the containers']) {
    const words = marked.split(' ')
    assert.ok(
      words.every(word => deploy.includes(word)),
      `the swap does not say when it is ${marked}`,
    )
  }
  /* Timed from the start of the swap, so the report is which piece spent the
     minutes rather than what o'clock it was. */
  assert.match(deploy, /swap_began="\$\(date \+%s\)"/)
})

test('the deploy says whether the places have anything to show', () => {
  /* "How many places do we hold" and "how many are worth looking at" are
     different questions, and for several releases only the first was asked.
     A layer whose whole enrichment half could be silently dark — and was,
     because a variable nobody set switched it off — needs the second one in
     the log where a person reads it. */
  const deploy = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  for (const table of ['place_descriptions', 'place_images', 'place_enrichment']) {
    assert.ok(deploy.includes(table), `the census never looks at ${table}`)
  }
  /* Counted apart from work outstanding. `barren` is a real answer — there is
     genuinely nothing openly licensed to say about most shopfronts — and
     folding it into a backlog would make a finished layer look stuck for
     ever. */
  assert.match(deploy, /nothing to show/)
  assert.match(deploy, /status in \('pending','working'\)/)
  /* Through the bounded helper, like every other line of the census: an
     unbounded count over a growing table is how deploy 387 died. */
  const at = deploy.indexOf('place_descriptions')
  assert.ok(
    deploy.lastIndexOf('places_now', at) > deploy.lastIndexOf('\n\n', at),
    'the enrichment census does not go through places_now',
  )
})

test('the deploy says who is locked out of sign-in, and whether anybody still can be', () => {
  /* Logto's sentinel blocks a target that fails too many times in an hour, and
     the block is a row of `sentinel_activities` nothing outside this box could
     see: no shell, a deploy key restricted to one command, and a Management
     API that is not a runner's to call. "Am I locked out?" was a question only
     the person locked out could answer, and only by trying again.

     `deploy/configure-logto.sql` turns the locking off and lets the live
     blocks go. This asserts the other half — the reading — because a change
     whose effect nobody can see from outside is a change nobody can trust. */
  const deploy = readFileSync(path.join(appRoot, 'deploy', 'github-deploy.sh'), 'utf8')
  assert.match(deploy, /blocked right now/, 'the deploy never says who is blocked')
  assert.match(deploy, /blocked in the last day/, 'the deploy forgets a block the moment it ends')
  assert.match(deploy, /sentinel_policy/, 'the deploy never says whether locking is off')
  assert.match(deploy, /is_suspended/, 'the deploy never counts a suspended account')

  /* Read-only, and unable to fail a release: it runs below the health check on
     a box that is already live and answering, and a count is not worth rolling
     a release back over. The same property the day census has, asserted the
     same way — every statement the helper is handed is a select. */
  const helper = deploy.indexOf('logto_ask() {')
  assert.ok(helper > 0, 'the deploy has no helper for asking Logto anything')
  assert.ok(
    helper > deploy.indexOf('/api/health'),
    'the sign-in census runs before the health check, where a count could undo a release',
  )
  assert.match(
    deploy.slice(helper, deploy.indexOf('\n}', helper)),
    /\|\| true$/m,
    'a Logto that will not answer must not fail a release that is answering',
  )
  for (const [, statement] of deploy.matchAll(/logto_ask "([^"]*)"/g)) {
    assert.match(
      statement.replace(/\\\n\s*/g, ' ').trim(),
      /^select /i,
      `the sign-in census does more than read: ${statement}`,
    )
  }
})
