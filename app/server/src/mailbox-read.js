/* Reading a connected mailbox on behalf of the person who connected it.

   This is the consumer of what the connector routes in app.js store: sealed
   Graph tokens, refreshed here when they age out, spent on read-only asks.
   Every entry point takes the asking user's id and resolves mailboxes
   through their own rows — there is no path to another person's mail.

   Errors thrown here are written for the assistant to relay: they say what
   the traveller can do (reconnect the mailbox, name which one), not what
   HTTP said. */

import { expiresAt as tokenLife, isExpired, tokenRequestBody, tokenUrl } from './mailbox-oauth.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const MESSAGE_FIELDS = 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments'
const BODY_LIMIT = 40_000 // characters of one email the model ever needs

const person = value =>
  value?.emailAddress
    ? { name: value.emailAddress.name || null, address: value.emailAddress.address || null }
    : null

const messageCard = message => ({
  id: message.id,
  subject: message.subject || '(no subject)',
  from: person(message.from),
  received: message.receivedDateTime || null,
  preview: message.bodyPreview || '',
  hasAttachments: !!message.hasAttachments,
})

export function createMailboxReader({
  repository,
  box,
  microsoft,
  fetchImpl = fetch,
  clock = () => new Date(),
}) {
  const refreshing = new Map() // connection id -> in-flight refresh

  /* Microsoft rotates consumer refresh tokens, so two racing refreshes would
     burn each other's token; the second rider joins the first flight. */
  const refresh = (connection, why) => {
    let flight = refreshing.get(connection.id)
    if (!flight) {
      flight = (async () => {
        const response = await fetchImpl(tokenUrl(connection.tenant || microsoft.tenant), {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: tokenRequestBody({
            clientId: microsoft.clientId,
            clientSecret: microsoft.clientSecret,
            refreshToken: box.open(connection.refreshToken),
          }).toString(),
        })
        const tokens = await response.json().catch(() => ({}))
        if (!response.ok || !tokens.access_token) {
          await repository.markMailboxNeedsReconnect(connection.id)
          throw new Error(
            `The ${connection.accountEmail || 'connected'} mailbox needs reconnecting` +
              ` (${why}). The traveller can reconnect it under Profile → Connections.`,
          )
        }
        await repository.updateMailboxTokens(connection.id, {
          accessToken: box.seal(tokens.access_token),
          refreshToken: tokens.refresh_token ? box.seal(tokens.refresh_token) : null,
          expiresAt: tokenLife(tokens, clock()),
        })
        return tokens.access_token
      })().finally(() => refreshing.delete(connection.id))
      refreshing.set(connection.id, flight)
    }
    return flight
  }

  async function graph(connection, path, headers = {}) {
    let token = isExpired(connection, clock())
      ? await refresh(connection, 'its sign-in expired')
      : box.open(connection.accessToken)
    let response = await fetchImpl(GRAPH + path, {
      headers: { ...headers, authorization: `Bearer ${token}` },
    })
    if (response.status === 401) {
      // The stored expiry lied — a revoked or early-dead token. One retry.
      token = await refresh(connection, 'Microsoft stopped accepting its token')
      response = await fetchImpl(GRAPH + path, {
        headers: { ...headers, authorization: `Bearer ${token}` },
      })
    }
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(body?.error?.message || `The mailbox did not answer (${response.status})`)
    }
    return body
  }

  /* Which mailbox a tool call means. One connected mailbox needs no naming;
     several need the caller to say, and the error teaches it how. */
  async function resolve(userId, mailboxId) {
    if (mailboxId) {
      const connection = await repository.findMailboxConnection(userId, mailboxId)
      if (!connection) throw new Error('That mailbox is not connected for this traveller.')
      return connection
    }
    const all = await repository.listMailboxConnections(userId)
    if (!all.length) {
      throw new Error(
        'No mailbox is connected. The traveller can connect one under Profile → Connections.',
      )
    }
    if (all.length > 1) {
      const names = all.map(c => `${c.accountEmail || c.accountName || c.id} (id ${c.id})`)
      throw new Error(`Several mailboxes are connected — pass mailboxId: ${names.join(', ')}.`)
    }
    return all[0]
  }

  return {
    async listMailboxes(userId) {
      const all = await repository.listMailboxConnections(userId)
      return all.map(connection => ({
        id: connection.id,
        provider: connection.provider,
        email: connection.accountEmail,
        name: connection.accountName,
        connectedAt: connection.connectedAt,
        needsReconnect: connection.needsReconnect,
      }))
    },

    async listMessages(userId, { mailboxId, search, top = 10 } = {}) {
      const connection = await resolve(userId, mailboxId)
      const query = new URLSearchParams({
        $top: String(Math.min(Math.max(1, top), 25)),
        $select: MESSAGE_FIELDS,
      })
      if (search) {
        // Graph refuses $orderby next to $search; search results come ranked.
        query.set('$search', `"${String(search).replace(/[\\"]/g, ' ').trim()}"`)
      } else {
        query.set('$orderby', 'receivedDateTime desc')
      }
      const found = await graph(connection, `/me/messages?${query}`)
      return {
        mailbox: connection.accountEmail,
        messages: (found.value || []).map(messageCard),
      }
    },

    async readMessage(userId, { mailboxId, messageId }) {
      const connection = await resolve(userId, mailboxId)
      const query = new URLSearchParams({
        $select: `${MESSAGE_FIELDS},toRecipients,ccRecipients,body,webLink`,
      })
      const message = await graph(
        connection,
        `/me/messages/${encodeURIComponent(messageId)}?${query}`,
        // Text, not HTML: the model reads prose, not markup.
        { prefer: 'outlook.body-content-type="text"' },
      )
      const text = message.body?.content || ''
      return {
        ...messageCard(message),
        to: (message.toRecipients || []).map(person).filter(Boolean),
        cc: (message.ccRecipients || []).map(person).filter(Boolean),
        body: text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}\n…(truncated)` : text,
        webLink: message.webLink || null,
      }
    },
  }
}
