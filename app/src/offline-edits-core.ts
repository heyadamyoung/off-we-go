import type { AsyncStorage, Coordinates, Id, Stop, Trip } from './shared/model/types'

/* Changes made with no signal, kept until there is one.

   The screen already updates before the server answers and rolls back if it
   refuses; all this adds is that a refusal caused by *the connection* is not a
   refusal at all — it is a change waiting its turn. What it deliberately does
   not do is invent merge rules: the server keeps one version of a stop, not a
   history, so a replayed change is last-writer-wins. What makes that honest is
   telling somebody afterwards which of their changes did not take, and why. */

const PREFIX = 'wayfare.offline-edits.v1'
/* Long enough for a fortnight of editing on a boat; past it the oldest go,
   because a queue that grows without limit eventually cannot be written at
   all, and losing the newest changes would be the wrong ones to lose. */
const MAX_EDITS = 500
export const LOCAL_PREFIX = 'local:'

export type QueuedEdit =
  | { id: string; at: number; tripId: Id; kind: 'stop.create'; target: Id; fields: Partial<Stop> }
  | { id: string; at: number; tripId: Id; kind: 'stop.update'; target: Id; fields: Partial<Stop> }
  | { id: string; at: number; tripId: Id; kind: 'stop.delete'; target: Id }
  | { id: string; at: number; tripId: Id; kind: 'route.replace'; points: Coordinates[] }
  | { id: string; at: number; tripId: Id; kind: 'trip.update'; fields: Partial<Trip> }
  | {
      id: string
      at: number
      tripId: Id
      kind: 'comment.add'
      target: Id
      photoId: Id
      body: string
    }
  | { id: string; at: number; tripId: Id; kind: 'comment.delete'; target: Id }
  | { id: string; at: number; tripId: Id; kind: 'like.set'; photoId: Id; on: boolean }

export type EditKind = QueuedEdit['kind']

let counter = 0
const noise = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)

/* The counter alone is not unique: it restarts at zero on every load, so two
   tabs opened together would mint the same id into the one shared queue and a
   remap would rewrite the other tab's stop. */
const nextId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${noise()}`

/** A stop that exists only on this device until its turn comes. */
export const localId = () => `${LOCAL_PREFIX}${nextId()}`
export const isLocalId = (id: Id) => String(id).startsWith(LOCAL_PREFIX)

const targetOf = (edit: QueuedEdit) => ('target' in edit ? edit.target : null)

/* Adding to the queue is not always appending. A stop created and then deleted
   before either reached the server never needs to exist at all, and a second
   change to the same stop in a row is the same change made twice. */
const CANCELS_LOCAL: ReadonlySet<EditKind> = new Set(['stop.delete', 'comment.delete'])

export function queueEdit(queue: QueuedEdit[], edit: QueuedEdit): QueuedEdit[] {
  if (CANCELS_LOCAL.has(edit.kind) && 'target' in edit && isLocalId(edit.target)) {
    const withoutIt = queue.filter(held => targetOf(held) !== edit.target)
    // It was only ever ours, so the server never has to hear about any of it.
    return withoutIt.length === queue.length ? trim([...queue, edit]) : withoutIt
  }
  const last = queue.at(-1)
  if (
    last?.kind === 'stop.update' &&
    edit.kind === 'stop.update' &&
    last.target === edit.target &&
    last.tripId === edit.tripId
  ) {
    const merged: QueuedEdit = { ...last, at: edit.at, fields: { ...last.fields, ...edit.fields } }
    return [...queue.slice(0, -1), merged]
  }
  return trim([...queue, edit])
}

/* Dropping the oldest can drop a create while its later edits survive; those
   would replay against a name the server never issued and be reported as
   changes that could not be applied. They go with it. */
function trim(queue: QueuedEdit[]): QueuedEdit[] {
  if (queue.length <= MAX_EDITS) return queue
  const kept = queue.slice(-MAX_EDITS)
  const created = new Set(
    kept
      .filter(edit => edit.kind === 'stop.create' || edit.kind === 'comment.add')
      .map(edit => ('target' in edit ? edit.target : '')),
  )
  return kept.filter(edit => {
    const target = 'target' in edit ? edit.target : null
    return !target || !isLocalId(target) || created.has(target)
  })
}

/* The server has just named a stop that until now only had a name we made up.
   Everything still queued that refers to it has to learn the real one. */
export function remapQueue(queue: QueuedEdit[], from: Id, to: Id): QueuedEdit[] {
  if (from === to) return queue
  return queue.map(edit => {
    const next = { ...edit }
    if ('target' in next && next.target === from) next.target = to
    return next
  })
}

export interface EditFailure {
  edit: QueuedEdit
  reason: 'gone' | 'refused' | 'conflict'
}

export interface DrainReport {
  applied: number
  failures: EditFailure[]
  remaining: QueuedEdit[]
}

/** A failure that means "try again later" rather than "this will never work". */
export function isOffline(caught: unknown): boolean {
  const error = caught as { status?: number; message?: string } | null
  const status = Number(error?.status || 0)
  if (status > 0) return status >= 500 && status !== 501
  if (caught instanceof TypeError) return true
  return /fetch|network|offline|connection/i.test(String(error?.message || ''))
}

const reasonFor = (caught: unknown): EditFailure['reason'] => {
  const status = Number((caught as { status?: number } | null)?.status || 0)
  if (status === 404 || status === 410) return 'gone'
  if (status === 409) return 'conflict'
  return 'refused'
}

interface DrainOptions {
  queue: QueuedEdit[]
  run: (edit: QueuedEdit) => Promise<{ id?: Id } | undefined>
}

/* Strictly in order, one at a time, stopping the moment the connection goes
   again — the changes behind this one were made after it and must not overtake
   it. Anything the server refuses outright is dropped and reported: keeping it
   would mean retrying it for ever. */
export async function drainEdits({ queue, run }: DrainOptions): Promise<DrainReport> {
  let remaining = [...queue]
  const failures: EditFailure[] = []
  let applied = 0

  while (remaining.length) {
    const [edit, ...rest] = remaining
    if (!edit) break
    try {
      const result = await run(edit)
      applied++
      remaining = rest
      /* Comments are created the same way and under the same made-up name; a
         remap that only knew about stops left a queued delete pointing at an
         id the server has never heard of, so the comment came back. */
      if (result?.id && 'target' in edit && isLocalId(edit.target)) {
        remaining = remapQueue(remaining, edit.target, result.id)
      }
    } catch (caught) {
      if (isOffline(caught)) return { applied, failures, remaining }
      failures.push({ edit, reason: reasonFor(caught) })
      remaining = rest
    }
  }
  return { applied, failures, remaining }
}

/* Said out loud afterwards, because a change that quietly did not happen is
   the thing people never forgive an app for. */
export function describeSync({ applied, failures }: DrainReport): string | null {
  if (!applied && !failures.length) return null
  const changes = `${applied} change${applied === 1 ? '' : 's'} synced`
  if (!failures.length) return changes
  const gone = failures.filter(failure => failure.reason === 'gone').length
  const lost = failures.length - gone
  const parts = [changes]
  if (gone) parts.push(`${gone} could not be applied — already removed`)
  if (lost) parts.push(`${lost} was refused`)
  return parts.join('; ')
}

interface RunOrQueueOptions<T> {
  edit: Unstamped<QueuedEdit>
  run: () => Promise<T>
  /** What the caller would have got, had there been a signal to get it with. */
  local: () => T
  /* Adds to the queue. The caller owns the read-modify-write so it can hold
     whatever lock keeps two of these from overwriting each other. */
  enqueue: (add: (queue: QueuedEdit[]) => QueuedEdit[]) => Promise<void>
  /** True when an older change to the same thing has not reached the server. */
  queuedAhead?: boolean
  now?: number
}

/** Is there already a change waiting for the thing this one touches? */
export function queuedAhead(queue: QueuedEdit[], edit: Unstamped<QueuedEdit>): boolean {
  const target = 'target' in edit ? edit.target : null
  const photoId = 'photoId' in edit ? edit.photoId : null
  return queue.some(held => {
    if (held.tripId !== edit.tripId) return false
    if (target && 'target' in held && held.target === target) return true
    return Boolean(photoId) && 'photoId' in held && held.photoId === photoId
  })
}

/* A change made with no signal is not a failed change. Anything else the
   server says still is one, and is thrown the way it always was — an offline
   queue that swallowed a "you may not do that" would be a lie. */
export async function runOrQueue<T>({
  edit,
  run,
  local,
  enqueue,
  queuedAhead: waiting = false,
  now = Date.now(),
}: RunOrQueueOptions<T>): Promise<{ value: T; queued: boolean }> {
  /* Something older is still waiting to reach the server for this same thing.
     Sending this one now would land first and then be overwritten when the
     older one finally replays — the traveller's newest wording losing to the
     one they had already changed their mind about. It queues behind it. */
  if (waiting) {
    await enqueue(queue => queueEdit(queue, newEdit(edit, now)))
    return { value: local(), queued: true }
  }
  try {
    return { value: await run(), queued: false }
  } catch (caught) {
    if (!isOffline(caught)) throw caught
    await enqueue(queue => queueEdit(queue, newEdit(edit, now)))
    return { value: local(), queued: true }
  }
}

const key = (account: string) => `${PREFIX}:${encodeURIComponent(account)}`

const isQueuedEdit = (value: unknown): value is QueuedEdit => {
  if (!value || typeof value !== 'object') return false
  const edit = value as Partial<QueuedEdit>
  return typeof edit.id === 'string' && typeof edit.kind === 'string' && typeof edit.at === 'number'
}

export async function readEdits(storage: AsyncStorage, account: string): Promise<QueuedEdit[]> {
  try {
    const raw = await storage.getItem(key(account))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isQueuedEdit) : []
  } catch {
    return []
  }
}

export async function writeEdits(
  storage: AsyncStorage,
  account: string,
  queue: QueuedEdit[],
): Promise<void> {
  try {
    if (queue.length) await storage.setItem(key(account), JSON.stringify(queue))
    else await storage.removeItem(key(account))
  } catch {
    /* A device that will not hold the queue cannot promise to sync it; the
       change still stands on screen until the next load says otherwise. */
  }
}

/* Omit across a union has to be distributed, or the discriminant is lost and
   every caller has to hand over every kind's fields at once. */
type Unstamped<T> = T extends unknown ? Omit<T, 'id' | 'at'> : never

export function newEdit(edit: Unstamped<QueuedEdit>, now = Date.now()): QueuedEdit {
  return { ...edit, id: nextId(), at: now } as QueuedEdit
}
