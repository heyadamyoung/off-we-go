import { authClient } from './backend-base'
import { deviceStorage } from './mobile'
import { offlineAccountId } from './offline-trip-core'
import {
  drainEdits,
  type newEdit,
  queuedAhead,
  readEdits,
  runOrQueue,
  writeEdits,
  type DrainReport,
  type QueuedEdit,
} from './offline-edits-core'
import type { Id } from './shared/model/types'

/* The queue as the app uses it: who it belongs to, how a change joins it, and
   how it is emptied. The replaying itself belongs to whoever knows how to call
   the API — this module is handed that, rather than importing it, so the queue
   and the API do not have to know about each other. */

type Unstamped = Parameters<typeof newEdit>[0]
export type EditRunner = (edit: QueuedEdit) => Promise<{ id?: Id } | undefined>

const account = () => offlineAccountId(authClient.getSession())

let pending = 0
const listeners = new Set<(count: number) => void>()

const publish = (count: number) => {
  pending = count
  for (const listener of listeners) listener(count)
}

export const pendingEdits = () => pending

export function subscribeToPendingEdits(listener: (count: number) => void) {
  listeners.add(listener)
  listener(pending)
  return () => {
    listeners.delete(listener)
  }
}

/** Counts what is already waiting, for a screen that has just opened. */
export async function refreshPendingEdits() {
  const who = account()
  publish(who ? (await readEdits(deviceStorage, who)).length : 0)
  return pending
}

/* The screen has already moved on optimistically; this keeps that honest by
   making sure the change will actually reach the server, and hands back what
   the caller would have got so nothing has to unwind. */
/* Every read-modify-write of the queue goes through here in turn. Two changes
   made at the same moment — a reorder writes both stops at once — would
   otherwise each read the queue before the other wrote it, and the second
   write would drop the first change without telling anybody. */
let lock: Promise<unknown> = Promise.resolve()

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = lock.then(work, work)
  lock = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export async function withOfflineEdit<T>(
  edit: Unstamped,
  run: () => Promise<T>,
  local: () => T,
): Promise<T> {
  const who = account()
  // Nobody to keep it for: let the failure be a failure.
  if (!who) return run()
  const held = await readEdits(deviceStorage, who)
  const { value } = await runOrQueue({
    edit,
    run,
    local,
    queuedAhead: queuedAhead(held, edit),
    /* Reading the queue, adding to it and writing it back happen together, so
       nothing that arrives in between is lost. */
    enqueue: add =>
      inTurn(async () => {
        const queue = add(await readEdits(deviceStorage, who))
        await writeEdits(deviceStorage, who, queue)
        publish(queue.length)
      }),
  })
  return value
}

let running: Promise<DrainReport | null> | null = null

/* One drain at a time: two at once would replay the same change twice, and
   the second would be the one to hit the conflict. */
export function syncEdits(run: EditRunner): Promise<DrainReport | null> {
  if (running) return running
  running = crossTab(async () => {
    const who = account()
    if (!who) return null
    const queue = await readEdits(deviceStorage, who)
    if (!queue.length) return null
    const report = await drainEdits({ queue, run })
    /* Re-read rather than writing the snapshot back: a change made while this
       drain was in flight is already in the stored queue, and writing what we
       started with would erase it. */
    await inTurn(async () => {
      const now = await readEdits(deviceStorage, who)
      const sent = new Set(queue.map(edit => edit.id))
      const kept = [...report.remaining, ...now.filter(edit => !sent.has(edit.id))]
      await writeEdits(deviceStorage, who, kept)
      publish(kept.length)
    })
    return report
  }).finally(() => {
    running = null
  })
  return running
}

/* One drain per device, not per tab. The queue is shared storage, so two tabs
   coming back online together would otherwise replay every change twice — two
   of every stop the traveller added. */
function crossTab<T>(work: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks?.request) return work()
  return locks.request('wayfare.offline-edits', work) as Promise<T>
}
