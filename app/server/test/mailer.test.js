import test from 'node:test'
import assert from 'node:assert/strict'

const moduleUnderTest = await import('../src/mailer.js').catch(() => null)

test('the SMTP mailer sends a trip invitation without an authentication token', async () => {
  assert.ok(moduleUnderTest?.createMailer, 'the VPS SMTP mailer has not been implemented')
  const sent = []
  const mailer = moduleUnderTest.createMailer({
    from: 'Wayfare <wayfare@example.com>',
    transport: { async sendMail(message) { sent.push(message) } },
  })
  await mailer.send({
    kind: 'trip-invitation',
    to: 'traveller@example.com',
    tripTitle: 'Summer in Paris',
    appUrl: 'https://wayfare.example.com/',
  })

  assert.equal(sent[0].subject, "You're invited to Summer in Paris")
  assert.match(sent[0].text, /sign in or create an account/i)
  assert.match(sent[0].text, /https:\/\/wayfare\.example\.com\//)
  assert.doesNotMatch(sent[0].text, /\?t=/)
  assert.doesNotMatch(sent[0].text, /token=/)
  assert.doesNotMatch(sent[0].text, /expires/i)
})
