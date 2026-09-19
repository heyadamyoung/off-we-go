import test from 'node:test'
import assert from 'node:assert/strict'

const moduleUnderTest = await import('../src/mailer.js').catch(() => null)

test('the SMTP mailer says you are on the trip, without an authentication token', async () => {
  assert.ok(moduleUnderTest?.createMailer, 'the VPS SMTP mailer has not been implemented')
  const sent = []
  const mailer = moduleUnderTest.createMailer({
    from: 'Off We Go <offwego@example.com>',
    transport: {
      async sendMail(message) {
        sent.push(message)
      },
    },
  })
  await mailer.send({
    kind: 'trip-access',
    to: 'traveller@example.com',
    tripTitle: 'Summer in Paris',
    appUrl: 'https://offwego.example.com/',
    tripUrl: 'https://offwego.example.com/trips/summer-in-paris',
    role: 'editor',
    joined: false,
  })

  assert.equal(sent[0].subject, "You're on Summer in Paris")
  assert.match(sent[0].text, /added to Summer in Paris in Off We Go/)
  assert.match(sent[0].text, /as a traveller/)
  assert.match(sent[0].text, /sign in or create an account/i)
  assert.match(sent[0].text, /nothing to accept/i)
  assert.match(sent[0].text, /https:\/\/offwego\.example\.com\/trips\/summer-in-paris/)
  assert.doesNotMatch(sent[0].text, /\?t=/)
  assert.doesNotMatch(sent[0].text, /token=/)
  assert.doesNotMatch(sent[0].text, /expires/i)

  await mailer.send({
    kind: 'trip-access',
    to: 'follower@example.com',
    tripTitle: 'Summer in Paris',
    appUrl: 'https://offwego.example.com/',
    tripUrl: 'https://offwego.example.com/trips/summer-in-paris',
    role: 'viewer',
    joined: true,
  })
  assert.match(sent[1].text, /as a follower/)
  assert.match(sent[1].text, /Sign in with this email address and it is there/)
  assert.doesNotMatch(sent[1].text, /create an account/i)
})
