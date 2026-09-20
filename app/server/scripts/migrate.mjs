#!/usr/bin/env node
/**
 * The schema, brought up to date, as a step of the deploy rather than a step
 * of a boot.
 *
 * It used to be the first thing index.js did, and that is fine right up until
 * a migration does real work. Migration 051 builds one GiST index over ten
 * million places — minutes on the box — and during those minutes the api is
 * not listening, so its healthcheck does not pass, so `web` sits on
 * `depends_on: api: service_healthy` until Compose gives up at three minutes
 * and the deploy restores the previous release. Deploys 363 and 365 both died
 * exactly there, 180 seconds after the api container started, and neither had
 * anything wrong with it.
 *
 * Raising Compose's patience was the wrong lever twice. A container's boot is
 * measured against timeouts that belong to containers; a migration is not a
 * boot, it is a thing the release does once, and the deploy can wait on it
 * for as long as it takes because the deploy is a shell script with no
 * opinion about how long a step may be.
 *
 * So: the deploy runs this against the new image before it recreates
 * anything, the old release keeps serving while it runs, and the api that
 * comes up afterwards finds every migration applied and is listening in
 * seconds. index.js still migrates on boot — that is what makes a hand start
 * and a fresh box work — and finds nothing to do here.
 *
 * Every migration is applied in its own transaction with the lock politeness
 * postgres.js applyMigration describes, so running this while the previous
 * release is still serving is exactly as safe as running it at boot was.
 */

import { createPostgresRepository } from '../src/postgres.js'

const required = name => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const started = Date.now()
const repository = await createPostgresRepository({
  databaseUrl: required('DATABASE_URL'),
  adminEmail: required('WAYFARE_ADMIN_EMAIL'),
})
try {
  await repository.migrate()
  process.stderr.write(`migrations applied in ${Math.round((Date.now() - started) / 100) / 10}s\n`)
} finally {
  await repository.close()
}
