/* Deciding what to move when media changes homes, without moving anything.

   Copying a volume into a bucket is one of those jobs that is trivial when it
   works and very hard to reason about when it does not: it runs against real
   data, it will be interrupted, and it will be run again by somebody who is
   not sure how far the last go got. So the decisions are here, where they can
   be tested against every awkward case, and the script is left holding only
   the file handles.

   Two rules shape all of it. Nothing is deleted — a migration that removes the
   original has no way back if the destination turns out to be wrong. And every
   file is checked rather than assumed, because "it was copied" and "it is
   there, whole" are different claims and only the second one is worth
   anything. */

import { posix } from 'node:path'

/* Written by an interrupted upload and named so it could never be served.
   Copying them would move rubbish into a bucket that charges for it. */
const LEFTOVER = /\.[0-9a-f-]{36}\.tmp$/i

/**
 * The storage path a local file should keep, or null if it is not media.
 *
 * The path is the identity: it is what the database rows hold and what every
 * signed link names, so a file that arrives at a different path in the bucket
 * is a photograph nothing can find any more.
 */
export function storagePathFor(root, absolutePath) {
  const from = String(root).replace(/\/+$/, '')
  const file = String(absolutePath)
  if (!file.startsWith(`${from}/`)) return null
  const relative = file.slice(from.length + 1)
  if (!relative || relative.startsWith('.')) return null
  if (LEFTOVER.test(relative)) return null
  // Anything hidden inside the tree is somebody's editor, not a photograph.
  if (relative.split('/').some(part => part.startsWith('.'))) return null
  return posix.normalize(relative)
}

/**
 * What to do about one file, given what is already at the other end.
 *
 * `skip` is the common answer on a second run, and is what makes this safe to
 * re-run after an interruption: what arrived whole is left alone, and only
 * what did not is done again.
 *
 * @param {number} localBytes
 * @param {number|null} remoteBytes null when there is nothing there
 */
export function copyDecision(localBytes, remoteBytes) {
  if (!(localBytes > 0)) return 'empty'
  if (remoteBytes === null || remoteBytes === undefined) return 'copy'
  if (remoteBytes === localBytes) return 'skip'
  /* A different size at the same path is a half-written object from a run
     that died mid-upload. Overwriting is the only way it gets fixed, and the
     alternative — leaving it — is a photograph that downloads as a truncated
     file for ever. */
  return 'replace'
}

/** A tally of what happened, in the words a person running this wants. */
export function summarise(results) {
  const counts = { copied: 0, replaced: 0, skipped: 0, empty: 0, failed: 0, bytes: 0 }
  for (const result of results) {
    if (result.decision === 'skip') counts.skipped++
    else if (result.decision === 'empty') counts.empty++
    else if (result.error) counts.failed++
    else if (result.decision === 'replace') counts.replaced++
    else counts.copied++
    if (!result.error && result.decision !== 'skip') counts.bytes += result.bytes || 0
  }
  return counts
}

/** Bytes, for somebody watching a terminal rather than reading a number. */
export function humanBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, Number(bytes) || 0)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)}${units[unit]}`
}

/**
 * Run a job over many things, a few at a time.
 *
 * One at a time makes a migration of ten thousand photographs an afternoon of
 * round trips; all at once opens ten thousand sockets and is refused. A few
 * is the whole of the tuning this needs.
 */
export async function inParallel(items, width, job) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(width, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await job(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
