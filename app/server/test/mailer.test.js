import test from 'node:test'
import assert from 'node:assert/strict'

const moduleUnderTest = await import('../src/mailer.js').catch(() => null)

test('the SMTP mailer sends both web and iPhone sign-in links', async () => {
  assert.ok(moduleUnderTest?.createMailer, 'the VPS SMTP mailer has not been implemented')
  const sent = []
  const mailer = moduleUnderTest.createMailer({
    from: 'Wayfare <wayfare@example.com>',
    transport: { async sendMail(message) { sent.push(message) } },
  })
  await mailer.send({
    to: 'traveller@example.com', webUrl: 'https://wayfare.example.com/?token=abc',
    nativeUrl: 'wayfare://auth?token=abc',
  })
  assert.equal(sent[0].to, 'traveller@example.com')
  assert.match(sent[0].text, /https:\/\/wayfare\.example\.com/)
  assert.match(sent[0].html, /wayfare:\/\/auth\?token=abc/)
})
