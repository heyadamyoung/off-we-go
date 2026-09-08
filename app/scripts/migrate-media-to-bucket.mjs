#!/usr/bin/env node
/* Move what is already on the volume into the object store.
 *
 * The step between "there is a bucket" and "the app uses the bucket", and the
 * one that must not be skipped: pointing the app at an empty bucket leaves
 * every existing photograph on the volume with nothing pointing at it, and
 * every trip full of grey squares.
 *
 * It copies rather than moves. Nothing on the volume is deleted, so a
 * migration that turns out to be wrong is undone by unsetting one environment
 * variable, and the day somebody is confident enough to reclaim the disk is a
 * separate day with an `rm` on it.
 *
 * It is safe to run again. Every file is checked at the far end first, so a
 * second run copies only what did not arrive the first time — which is what
 * you want at the point you most need it, after the first one was interrupted.
 *
 *   pnpm media:migrate --check     say what would happen, touch nothing
 *   pnpm media:migrate             do it
 *
 * The bucket comes from the same S3_* variables the server reads, and the
 * volume from UPLOAD_DIR. Run it in the api container, where both are already
 * set: `docker compose exec api pnpm media:migrate --check`.
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createS3FileStore } from '../server/src/s3-store.js'
import {
  copyDecision,
  humanBytes,
  inParallel,
  storagePathFor,
  summarise,
} from './mediaMigrationCore.mjs'

const argv = new Set(process.argv.slice(2))
const dryRun = argv.has('--check') || argv.has('--dry-run')
const width = Number(process.env.MIGRATE_CONCURRENCY) || 4

const need = name => {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} is required. Run this where the api runs, or set the S3_* variables.`)
    process.exit(2)
  }
  return value
}

const root = (process.env.UPLOAD_DIR || '/data/uploads').replace(/\/+$/, '')
const store = createS3FileStore({
  bucket: need('S3_BUCKET'),
  endpoint: need('S3_ENDPOINT'),
  region: process.env.S3_REGION || 'auto',
  accessKeyId: need('S3_ACCESS_KEY_ID'),
  secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  prefix: process.env.S3_PREFIX || '',
})

async function everythingUnder(directory) {
  const found = []
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await everythingUnder(path)))
    else if (entry.isFile()) found.push(path)
  }
  return found
}

/** What is at this path in the bucket, or null. Never an error for absence. */
const remoteSize = async storagePath => {
  try {
    return await store.size(storagePath)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

console.log(`Reading ${root}`)
const files = await everythingUnder(root)
const media = files
  .map(path => ({ path, storagePath: storagePathFor(root, path) }))
  .filter(item => item.storagePath)
console.log(
  `${media.length} files to consider${files.length !== media.length ? ` (${files.length - media.length} skipped as not media)` : ''}`,
)

if (!dryRun) {
  // Fails loudly here rather than one file at a time if the bucket is wrong.
  await store.ready()
  console.log(`Bucket ${process.env.S3_BUCKET} answered; copying with ${width} at a time`)
}

let done = 0
const results = await inParallel(media, width, async item => {
  const local = await stat(item.path)
  const decision = copyDecision(local.size, await remoteSize(item.storagePath))
  done++
  if (done % 200 === 0) console.log(`  ${done}/${media.length}`)

  if (decision === 'skip' || decision === 'empty') {
    return { ...item, decision, bytes: local.size }
  }
  if (dryRun) return { ...item, decision, bytes: local.size }

  try {
    await store.putObject({ storagePath: item.storagePath, file: item.path })
    /* Asked rather than assumed. A PUT that answered 200 and stored nothing is
       exactly the failure this whole script exists to not have, and one HEAD
       per file is nothing beside finding out months later. */
    const landed = await remoteSize(item.storagePath)
    if (landed !== local.size) {
      throw new Error(`arrived as ${landed} bytes, not ${local.size}`)
    }
    return { ...item, decision, bytes: local.size }
  } catch (error) {
    return { ...item, decision, bytes: local.size, error }
  }
})

const counts = summarise(results)
console.log('')
console.log(dryRun ? 'Nothing was written. This is what would happen:' : 'Done:')
console.log(`  copied    ${counts.copied}`)
console.log(`  replaced  ${counts.replaced}   (a half-written object from an interrupted run)`)
console.log(`  skipped   ${counts.skipped}   (already there, same size)`)
if (counts.empty) console.log(`  empty     ${counts.empty}   (zero bytes; nothing to copy)`)
console.log(`  failed    ${counts.failed}`)
console.log(`  bytes     ${humanBytes(counts.bytes)}`)

for (const failure of results.filter(result => result.error)) {
  console.error(`  ! ${failure.storagePath}: ${failure.error.message}`)
}

if (counts.failed) {
  console.error('\nSome files did not arrive. Nothing on the volume was touched; run again.')
  process.exit(1)
}
if (dryRun) {
  console.log('\nRun again without --check to copy. Nothing on the volume is ever deleted.')
} else {
  console.log('\nNow set S3_BUCKET in .env and deploy. The volume stays as it is until you say.')
}
