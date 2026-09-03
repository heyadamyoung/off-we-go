import test from 'node:test'
import assert from 'node:assert/strict'
import { createMailboxReader } from '../src/mailbox-read.js'

/* The assistant's window into a connected inbox. What these pin: tokens
   refresh exactly when they must and never twice at once (Microsoft rotates
   consumer refresh tokens, so a doubled refresh burns the second caller),
   a dead grant tells the traveller how to fix it, and no path reads another
   person's mail. */

const box = {
  seal: value => `s:${value}`,
  open: value => (value ? String(value).slice(2) : null),
}
const microsoft = { clientId: 'client-abc', clientSecret: 'shhh', tenant: 'consumers' }
const NOW = new Date('2026-09-03T12:00:00Z')
const soon = new Date(NOW.getTime() + 30 * 60_000)
const ago = new Date(NOW.getTime() - 60_000)

const connection = over => ({
  id: 'mb-1',
  userId: 'u-1',
  provider: 'outlook',
  tenant: 'consumers',
  accountEmail: 'adam@outlook.com',
  accountName: 'Adam',
  accessToken: 's:old-access',
  refreshToken: 's:refresh-1',
  expiresAt: soon,
  needsReconnect: false,
  connectedAt: NOW,
  ...over,
})

const fakeRepo = connections => {
  const calls = { updated: [], reconnect: [] }
  return {
    calls,
    async listMailboxConnections(userId) {
      return connections.filter(c => c.userId === userId)
    },
    async findMailboxConnection(userId, id) {
      return connections.find(c => c.userId === userId && c.id === id) || null
    },
    async updateMailboxTokens(id, tokens) {
      calls.updated.push({ id, ...tokens })
      Object.assign(
        connections.find(c => c.id === id),
        tokens,
      )
    },
    async markMailboxNeedsReconnect(id) {
      calls.reconnect.push(id)
    },
  }
}

const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  async json() {
    return body
  },
})
const MESSAGE = {
  id: 'm1',
  subject: 'Your KLM booking',
  from: { emailAddress: { name: 'KLM', address: 'noreply@klm.com' } },
  receivedDateTime: '2026-09-01T10:00:00Z',
  bodyPreview: 'Flight AMS-YYC confirmed',
  hasAttachments: true,
}

const network = ({ refuseRefresh = false, graph } = {}) => {
  const requests = []
  return {
    requests,
    impl: async (url, options = {}) => {
      requests.push({ url: String(url), options })
      if (String(url).includes('login.microsoftonline.com')) {
        return refuseRefresh
          ? json({ error_description: 'the grant expired' }, 400)
          : json({ access_token: 'new-access', refresh_token: 'refresh-2', expires_in: 3600 })
      }
      return graph(String(url), options)
    },
  }
}

const reader = (repo, net) =>
  createMailboxReader({
    repository: repo,
    box,
    microsoft,
    fetchImpl: net.impl,
    clock: () => NOW,
  })

test('a fresh token reads the inbox with no refresh, newest first', async () => {
  const repo = fakeRepo([connection()])
  const net = network({ graph: () => json({ value: [MESSAGE] }) })
  const found = await reader(repo, net).listMessages('u-1', {})

  assert.equal(net.requests.length, 1)
  assert.match(net.requests[0].url, /graph\.microsoft\.com\/v1\.0\/me\/messages/)
  assert.match(net.requests[0].url, /%24orderby=receivedDateTime\+desc/)
  assert.equal(net.requests[0].options.headers.authorization, 'Bearer old-access')
  assert.equal(found.mailbox, 'adam@outlook.com')
  assert.deepEqual(found.messages[0], {
    id: 'm1',
    subject: 'Your KLM booking',
    from: { name: 'KLM', address: 'noreply@klm.com' },
    received: '2026-09-01T10:00:00Z',
    preview: 'Flight AMS-YYC confirmed',
    hasAttachments: true,
  })
})

test('an expired token refreshes first, and the rotation is sealed and kept', async () => {
  const repo = fakeRepo([connection({ expiresAt: ago })])
  const net = network({
    graph: (_url, options) => {
      assert.equal(options.headers.authorization, 'Bearer new-access')
      return json({ value: [] })
    },
  })
  await reader(repo, net).listMessages('u-1', {})

  assert.match(net.requests[0].url, /login\.microsoftonline\.com\/consumers\/oauth2\/v2\.0\/token/)
  const kept = repo.calls.updated[0]
  assert.equal(kept.id, 'mb-1')
  assert.equal(kept.accessToken, 's:new-access')
  assert.equal(kept.refreshToken, 's:refresh-2')
  assert.ok(kept.expiresAt instanceof Date && kept.expiresAt > NOW)
})

test('two parallel asks on a stale mailbox share one refresh', async () => {
  const repo = fakeRepo([connection({ expiresAt: ago })])
  const net = network({ graph: () => json({ value: [] }) })
  const mail = reader(repo, net)
  await Promise.all([mail.listMessages('u-1', {}), mail.listMessages('u-1', {})])

  const refreshes = net.requests.filter(r => r.url.includes('login.microsoftonline.com'))
  assert.equal(refreshes.length, 1)
})

test('a 401 mid-life refreshes once and retries the same read', async () => {
  let graphCalls = 0
  const repo = fakeRepo([connection()])
  const net = network({
    graph: () =>
      ++graphCalls === 1
        ? json({ error: { message: 'expired' } }, 401)
        : json({ value: [MESSAGE] }),
  })
  const found = await reader(repo, net).listMessages('u-1', {})
  assert.equal(found.messages.length, 1)
  assert.equal(graphCalls, 2)
  assert.equal(repo.calls.updated.length, 1)
})

test('a refused refresh marks the mailbox and tells the traveller the way back', async () => {
  const repo = fakeRepo([connection({ expiresAt: ago })])
  const net = network({ refuseRefresh: true, graph: () => json({ value: [] }) })
  await assert.rejects(
    () => reader(repo, net).listMessages('u-1', {}),
    /adam@outlook\.com mailbox needs reconnecting.*Profile → Connections/,
  )
  assert.deepEqual(repo.calls.reconnect, ['mb-1'])
})

test('search rides $search with quotes disarmed, and drops the order Graph refuses', async () => {
  const repo = fakeRepo([connection()])
  const net = network({ graph: () => json({ value: [] }) })
  await reader(repo, net).listMessages('u-1', { search: 'KLM "sept"' })

  const url = net.requests[0].url
  assert.match(url, /%24search=%22KLM\+\+sept%22/)
  assert.ok(!url.includes('%24orderby'))
})

test('one mailbox needs no naming; several demand it; nobody reads a stranger’s', async () => {
  const two = [connection(), connection({ id: 'mb-2', accountEmail: 'kid@outlook.com' })]
  const net = network({ graph: () => json({ value: [] }) })

  await assert.rejects(
    () => reader(fakeRepo(two), net).listMessages('u-1', {}),
    /Several mailboxes are connected.*mb-1.*mb-2/,
  )
  await assert.rejects(
    () => reader(fakeRepo([connection()]), net).listMessages('u-2', {}),
    /No mailbox is connected/,
  )
  await assert.rejects(
    () => reader(fakeRepo([connection()]), net).listMessages('u-2', { mailboxId: 'mb-1' }),
    /not connected for this traveller/,
  )
})

test('one full message arrives as text, with its people and a truncation guard', async () => {
  const repo = fakeRepo([connection()])
  const net = network({
    graph: (url, options) => {
      assert.match(url, /\/me\/messages\/m1\?/)
      assert.equal(options.headers.prefer, 'outlook.body-content-type="text"')
      return json({
        ...MESSAGE,
        toRecipients: [{ emailAddress: { name: 'Adam', address: 'adam@outlook.com' } }],
        ccRecipients: [],
        body: { contentType: 'text', content: 'x'.repeat(40_001) },
        webLink: 'https://outlook.live.com/mail/deeplink',
      })
    },
  })
  const message = await reader(repo, net).readMessage('u-1', { messageId: 'm1' })

  assert.equal(message.subject, 'Your KLM booking')
  assert.deepEqual(message.to, [{ name: 'Adam', address: 'adam@outlook.com' }])
  assert.ok(message.body.endsWith('…(truncated)'))
  assert.equal(message.webLink, 'https://outlook.live.com/mail/deeplink')
})
