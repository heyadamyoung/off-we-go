// biome-ignore lint/correctness/noUnresolvedImports: web-push is CommonJS with no `exports` field; Node resolves it by `main` and Biome's resolver does not.
import webpush from 'web-push'

/* The one thing that talks to the push services. The key pair that signs
   every push is made here at first boot and kept in the database, so a
   fresh deployment can push without anybody minting a secret; the public
   half is what browsers subscribe with, and a new pair would orphan every
   subscription made under the old one, which is why it is kept. */

export async function createWebPushSender({ repository, subject }) {
  let keys = await repository.pushKeys()
  if (!keys) {
    keys = webpush.generateVAPIDKeys()
    await repository.savePushKeys(keys)
  }
  const vapidDetails = {
    subject: /^(mailto:|https:)/.test(subject) ? subject : `https://${subject}`,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  }
  return {
    publicKey: keys.publicKey,
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          {
            vapidDetails,
            /* A boarding call two hours late is noise: the sound-making
               pushes expire soon, the quiet card updates keep an hour. */
            TTL: payload.silent === false ? 30 * 60 : 60 * 60,
            urgency: payload.silent === false ? 'high' : 'normal',
          },
        )
        return { ok: true }
      } catch (error) {
        const status = Number(error?.statusCode) || null
        return { ok: false, gone: status === 404 || status === 410, status }
      }
    },
  }
}
