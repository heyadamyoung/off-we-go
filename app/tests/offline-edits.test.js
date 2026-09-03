import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeSync,
  drainEdits,
  isLocalId,
  isOffline,
  localId,
  newEdit,
  queueEdit,
  queuedAhead,
  readEdits,
  remapQueue,
  runOrQueue,
  writeEdits,
} from '../src/offline-edits-core.ts'

const TRIP = 'trip-1'
const update = (target, fields) => newEdit({ kind: 'stop.update', tripId: TRIP, target, fields })
const create = (target, fields = { name: 'New stop' }) =>
  newEdit({ kind: 'stop.create', tripId: TRIP, target, fields })
const remove = target => newEdit({ kind: 'stop.delete', tripId: TRIP, target })

const offline = () => {
  throw new TypeError('Failed to fetch')
}
const refuse = status => () => {
  throw Object.assign(new Error('no'), { status })
}

const storage = () => {
  const held = new Map()
  return {
    held,
    getItem: key => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value)
    },
    removeItem: key => {
      held.delete(key)
    },
  }
}

test('a stop made with no signal is given a name only this device knows', () => {
  const id = localId()

  assert.equal(isLocalId(id), true)
  assert.equal(isLocalId('7f3a-real'), false)
  assert.notEqual(localId(), id, 'and each one is its own')
})

test('changes queue in the order they were made', () => {
  let queue = []
  queue = queueEdit(queue, create('local:a'))
  queue = queueEdit(queue, update('real-1', { name: 'Rijksmuseum' }))
  queue = queueEdit(queue, remove('real-2'))

  assert.deepEqual(
    queue.map(edit => edit.kind),
    ['stop.create', 'stop.update', 'stop.delete'],
  )
})

test('typing into the same stop twice is one change, not two', () => {
  let queue = queueEdit([], update('s1', { name: 'Rijks' }))
  queue = queueEdit(queue, update('s1', { name: 'Rijksmuseum', note: 'book ahead' }))

  assert.equal(queue.length, 1)
  assert.deepEqual(queue[0].fields, { name: 'Rijksmuseum', note: 'book ahead' })
})

test('a change to a different stop is its own change', () => {
  let queue = queueEdit([], update('s1', { name: 'A' }))
  queue = queueEdit(queue, update('s2', { name: 'B' }))

  assert.equal(queue.length, 2)
})

test('a stop created and deleted before either was sent never troubles the server', () => {
  let queue = queueEdit([], create('local:a'))
  queue = queueEdit(queue, update('local:a', { name: 'Changed my mind' }))
  queue = queueEdit(queue, remove('local:a'))

  assert.deepEqual(queue, [], 'the whole chain goes, not just the delete')
})

test('deleting a stop the server already knows is still a change to send', () => {
  const queue = queueEdit([], remove('real-1'))

  assert.equal(queue.length, 1)
  assert.equal(queue[0].kind, 'stop.delete')
})

test('once the server names a new stop, everything waiting learns the real name', () => {
  const queue = [update('local:a', { name: 'A' }), remove('local:a'), update('s2', { name: 'B' })]

  const remapped = remapQueue(queue, 'local:a', 'real-9')

  assert.deepEqual(
    remapped.map(edit => edit.target),
    ['real-9', 'real-9', 's2'],
  )
})

test('a queue replays in order and reports what it did', async () => {
  const sent = []
  const report = await drainEdits({
    queue: [create('local:a'), update('s2', { name: 'B' })],
    run: async edit => {
      sent.push(edit.kind)
      return edit.kind === 'stop.create' ? { id: 'real-9' } : undefined
    },
  })

  assert.deepEqual(sent, ['stop.create', 'stop.update'])
  assert.deepEqual(report, { applied: 2, failures: [], remaining: [] })
})

test('a stop created during the replay hands its real name to the changes behind it', async () => {
  const sent = []
  const report = await drainEdits({
    queue: [create('local:a'), update('local:a', { name: 'Renamed' })],
    run: async edit => {
      sent.push({ kind: edit.kind, target: edit.target })
      return edit.kind === 'stop.create' ? { id: 'real-9' } : undefined
    },
  })

  assert.deepEqual(sent, [
    { kind: 'stop.create', target: 'local:a' },
    { kind: 'stop.update', target: 'real-9' },
  ])
  assert.equal(report.applied, 2)
})

test('losing the connection again stops the replay where it stands', async () => {
  let seen = 0
  const queue = [update('s1', { name: 'A' }), update('s2', { name: 'B' }), update('s3', {})]

  const report = await drainEdits({
    queue,
    run: async () => {
      if (++seen === 2) offline()
    },
  })

  assert.equal(report.applied, 1)
  assert.equal(report.failures.length, 0, 'a lost connection is not a refusal')
  assert.deepEqual(
    report.remaining.map(edit => edit.target),
    ['s2', 's3'],
    'the unsent changes keep their order',
  )
})

test('a change the server refuses is dropped and named, not retried for ever', async () => {
  const report = await drainEdits({
    queue: [update('gone-stop', { name: 'A' }), update('s2', { name: 'B' })],
    run: async edit => {
      if (edit.target === 'gone-stop') refuse(404)()
    },
  })

  assert.equal(report.applied, 1)
  assert.deepEqual(report.remaining, [])
  assert.equal(report.failures.length, 1)
  assert.equal(report.failures[0].reason, 'gone')
})

test('a server having a moment is waited out; a server saying no is not', async () => {
  const later = await drainEdits({ queue: [update('s1', {})], run: refuse(503) })
  assert.deepEqual(later.remaining.length, 1, 'a 503 keeps the change for later')

  const never = await drainEdits({ queue: [update('s1', {})], run: refuse(403) })
  assert.equal(never.failures[0].reason, 'refused')
  assert.deepEqual(never.remaining, [])
})

test('a clash with somebody else editing the same trip is reported as one', async () => {
  const report = await drainEdits({ queue: [update('s1', {})], run: refuse(409) })

  assert.equal(report.failures[0].reason, 'conflict')
})

test('what happened is said in plain words', () => {
  assert.equal(describeSync({ applied: 3, failures: [], remaining: [] }), '3 changes synced')
  assert.equal(describeSync({ applied: 1, failures: [], remaining: [] }), '1 change synced')
  assert.equal(describeSync({ applied: 0, failures: [], remaining: [] }), null)
  assert.equal(
    describeSync({ applied: 2, failures: [{ edit: update('s'), reason: 'gone' }], remaining: [] }),
    '2 changes synced; 1 could not be applied — already removed',
  )
  assert.equal(
    describeSync({
      applied: 0,
      failures: [{ edit: update('s'), reason: 'refused' }],
      remaining: [],
    }),
    '0 changes synced; 1 was refused',
  )
})

test('the queue survives the app being closed', async () => {
  const store = storage()
  await writeEdits(store, 'u1', [update('s1', { name: 'A' })])

  const back = await readEdits(store, 'u1')

  assert.equal(back.length, 1)
  assert.equal(back[0].fields.name, 'A')
})

test('one account never replays another account queue', async () => {
  const store = storage()
  await writeEdits(store, 'u1', [update('s1', { name: 'A' })])

  assert.deepEqual(await readEdits(store, 'u2'), [])
})

test('an emptied queue leaves nothing behind', async () => {
  const store = storage()
  await writeEdits(store, 'u1', [update('s1', {})])

  await writeEdits(store, 'u1', [])

  assert.equal(store.held.size, 0)
  assert.deepEqual(await readEdits(store, 'u1'), [])
})

test('a corrupted queue reads as no queue rather than crashing the app', async () => {
  const store = storage()
  store.held.set('wayfare.offline-edits.v1:u1', '{ not json')

  assert.deepEqual(await readEdits(store, 'u1'), [])
})

test('the connection, not the server, decides what is worth keeping', () => {
  assert.equal(isOffline(new TypeError('Failed to fetch')), true)
  assert.equal(isOffline(Object.assign(new Error('down'), { status: 503 })), true)
  assert.equal(isOffline(Object.assign(new Error('nope'), { status: 403 })), false)
  assert.equal(isOffline(Object.assign(new Error('gone'), { status: 404 })), false)
})

/* ---- the branch every mutation actually runs through -------------------- */

test('with a signal the change goes straight out and nothing is queued', async () => {
  let queue = []
  const result = await runOrQueue({
    edit: { kind: 'stop.update', tripId: TRIP, target: 's1', fields: { name: 'A' } },
    run: async () => ({ id: 's1', name: 'A' }),
    local: () => ({ id: 's1' }),
    enqueue: async add => {
      queue = add(queue)
    },
  })

  assert.deepEqual(result.value, { id: 's1', name: 'A' })
  assert.equal(result.queued, false)
  assert.deepEqual(queue, [])
})

test('with no signal the change is kept and the screen is told what it asked for', async () => {
  let queue = []
  const result = await runOrQueue({
    edit: { kind: 'stop.create', tripId: TRIP, target: 'local:a', fields: { name: 'New' } },
    run: offline,
    local: () => ({ id: 'local:a', name: 'New' }),
    enqueue: async add => {
      queue = add(queue)
    },
  })

  assert.deepEqual(result.value, { id: 'local:a', name: 'New' })
  assert.equal(result.queued, true)
  assert.equal(queue.length, 1)
  assert.equal(queue[0].kind, 'stop.create')
})

test('a refusal is still a refusal, not something to keep trying', async () => {
  await assert.rejects(
    () =>
      runOrQueue({
        edit: { kind: 'stop.delete', tripId: TRIP, target: 's1' },
        run: refuse(403),
        local: () => undefined,
        enqueue: async () => {},
      }),
    /no/,
  )
})

test('a change made offline reaches the server on the next drain, once', async () => {
  // The whole round trip: edit with no signal, then replay with one.
  let queue = []
  const enqueue = async add => {
    queue = add(queue)
  }
  await runOrQueue({
    edit: { kind: 'stop.create', tripId: TRIP, target: 'local:a', fields: { name: 'Foodhallen' } },
    run: offline,
    local: () => ({ id: 'local:a' }),
    enqueue,
  })
  await runOrQueue({
    edit: { kind: 'stop.update', tripId: TRIP, target: 'local:a', fields: { note: 'lunch' } },
    run: offline,
    local: () => ({ id: 'local:a' }),
    enqueue,
  })

  const sent = []
  const report = await drainEdits({
    queue,
    run: async edit => {
      sent.push([edit.kind, edit.target])
      return edit.kind === 'stop.create' ? { id: 'server-7' } : undefined
    },
  })

  assert.deepEqual(sent, [
    ['stop.create', 'local:a'],
    ['stop.update', 'server-7'],
  ])
  assert.deepEqual(report.remaining, [])
  assert.equal(report.applied, 2)
})

/* ---- what the bug sweep turned up -------------------------------------- */

test('a comment written and deleted with no signal never reaches the server', () => {
  const add = newEdit({
    kind: 'comment.add',
    tripId: TRIP,
    target: 'local:c',
    photoId: 'p1',
    body: 'hi',
  })
  const gone = newEdit({ kind: 'comment.delete', tripId: TRIP, target: 'local:c' })

  assert.deepEqual(queueEdit(queueEdit([], add), gone), [])
})

test('a comment created during the replay hands its real id to its own delete', async () => {
  const sent = []
  const report = await drainEdits({
    queue: [
      newEdit({ kind: 'comment.add', tripId: TRIP, target: 'local:c', photoId: 'p1', body: 'hi' }),
      newEdit({ kind: 'comment.delete', tripId: TRIP, target: 'local:c' }),
    ],
    run: async edit => {
      sent.push([edit.kind, edit.target])
      return edit.kind === 'comment.add' ? { id: 'server-c' } : undefined
    },
  })

  assert.deepEqual(sent, [
    ['comment.add', 'local:c'],
    // Without the remap this deleted nothing and the comment stayed up for everyone.
    ['comment.delete', 'server-c'],
  ])
  assert.equal(report.failures.length, 0)
})

test('two ids minted in the same millisecond are still two ids', () => {
  const many = new Set(Array.from({ length: 500 }, () => localId()))

  assert.equal(many.size, 500)
})

test('trimming an overfull queue does not strand edits whose create it dropped', () => {
  let queue = [newEdit({ kind: 'stop.create', tripId: TRIP, target: 'local:old', fields: {} })]
  queue.push(
    newEdit({ kind: 'stop.update', tripId: TRIP, target: 'local:old', fields: { name: 'x' } }),
  )
  // Push past the cap with unrelated changes so the create falls off the front.
  for (let index = 0; index < 600; index++) {
    queue = queueEdit(
      queue,
      newEdit({ kind: 'stop.update', tripId: TRIP, target: `s${index}`, fields: {} }),
    )
  }

  const orphans = queue.filter(edit => 'target' in edit && isLocalId(edit.target))
  assert.deepEqual(orphans, [], 'an edit whose create was dropped would only 404 on replay')
})

test('an edit made during a replay is not erased when the replay finishes', async () => {
  // The shape offline-edits.ts relies on: the queue is re-read, and anything
  // that arrived while the drain ran is kept.
  const started = [update('s1', { name: 'A' })]
  const arrivedDuring = update('s2', { name: 'B' })
  const report = await drainEdits({ queue: started, run: async () => {} })

  const sent = new Set(started.map(edit => edit.id))
  const stored = [...started, arrivedDuring]
  const kept = [...report.remaining, ...stored.filter(edit => !sent.has(edit.id))]

  assert.deepEqual(kept, [arrivedDuring])
})

test('a change made online waits behind an older one still queued for it', async () => {
  let queue = [update('s1', { name: 'Rijks' })]
  let sent = false

  const result = await runOrQueue({
    edit: { kind: 'stop.update', tripId: TRIP, target: 's1', fields: { name: 'Van Gogh' } },
    run: async () => {
      sent = true
      return { id: 's1' }
    },
    local: () => ({ id: 's1' }),
    enqueue: async add => {
      queue = add(queue)
    },
    queuedAhead: queuedAhead(queue, {
      kind: 'stop.update',
      tripId: TRIP,
      target: 's1',
      fields: {},
    }),
  })

  // Sending it now would land first and then be overwritten by the older one.
  assert.equal(sent, false)
  assert.equal(result.queued, true)
  assert.equal(queue.length, 1, 'and it merges with the change already waiting')
  assert.deepEqual(queue[0].fields, { name: 'Van Gogh' })
})

test('nothing waiting means the change goes straight out', async () => {
  let sent = false
  await runOrQueue({
    edit: { kind: 'stop.update', tripId: TRIP, target: 's9', fields: {} },
    run: async () => {
      sent = true
    },
    local: () => undefined,
    enqueue: async () => {},
    queuedAhead: queuedAhead([update('s1', {})], {
      kind: 'stop.update',
      tripId: TRIP,
      target: 's9',
      fields: {},
    }),
  })

  assert.equal(sent, true)
})
