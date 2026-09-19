import { sendTokenValid } from './tick.js'

/* Subscribing is a session's business; muting a leg and saying what became
   of a card are the card's own, spoken with the token it carried. */

const ENDPOINT = /^https:\/\/[^\s]{1,2000}$/
const KEY = /^[A-Za-z0-9_-]{16,400}$/

export function registerPushRoutes(app, { repository, authenticate, secret, publicKey = null }) {
  app.get('/api/push/key', async (_request, reply) => {
    if (!publicKey) return reply.code(404).send({ error: 'Push is not set up on this server' })
    return { key: publicKey }
  })

  app.put('/api/push/subscriptions', { bodyLimit: 8 * 1024 }, async (request, reply) => {
    const user = await authenticate(request, reply)
    if (!user) return
    const body = request.body || {}
    const endpoint = String(body.endpoint || '')
    const p256dh = String(body.keys?.p256dh || '')
    const auth = String(body.keys?.auth || '')
    if (!ENDPOINT.test(endpoint) || !KEY.test(p256dh) || !KEY.test(auth)) {
      return reply.code(400).send({ error: 'That is not a push subscription' })
    }
    await repository.savePushSubscription({
      profileId: user.id,
      endpoint,
      p256dh,
      auth,
      userAgent: String(body.userAgent || '').slice(0, 300) || null,
    })
    return reply.code(204).send()
  })

  app.delete('/api/push/subscriptions', { bodyLimit: 8 * 1024 }, async (request, reply) => {
    const user = await authenticate(request, reply)
    if (!user) return
    const endpoint = String(request.body?.endpoint || '')
    if (!ENDPOINT.test(endpoint)) return reply.code(400).send({ error: 'Which subscription?' })
    await repository.deletePushSubscriptionByEndpoint(user.id, endpoint)
    return reply.code(204).send()
  })

  const spoken = (request, reply) => {
    const id = String(request.params.id || '')
    const token = request.headers['x-push-token']
    if (!/^[0-9a-f-]{36}$/.test(id) || !sendTokenValid(secret, id, token)) {
      reply.code(403).send({ error: 'That card cannot be spoken for' })
      return null
    }
    return id
  }

  app.post('/api/push/sends/:id/mute', async (request, reply) => {
    const id = spoken(request, reply)
    if (!id) return
    const muted = await repository.mutePushSend(id)
    return reply.code(muted ? 204 : 404).send()
  })

  app.post('/api/push/sends/:id/outcome', { bodyLimit: 1024 }, async (request, reply) => {
    const id = spoken(request, reply)
    if (!id) return
    const outcome = request.body?.outcome
    if (!['opened', 'dismissed'].includes(outcome)) {
      return reply.code(400).send({ error: 'opened or dismissed' })
    }
    const noted = await repository.recordPushOutcome(id, outcome)
    return reply.code(noted ? 204 : 404).send()
  })
}
