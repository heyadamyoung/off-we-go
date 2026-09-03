import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../src/app.js'
import { createMemoryRepository } from './memory-repository.js'

test('the VPS publishes the Apple association for secure auth universal links', async () => {
  const app = await buildServer({
    repository: createMemoryRepository({ allowedEmails: [] }),
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    appleTeamId: 'A1B2C3D4E5',
    appleBundleId: 'ai.threadway.wayfare',
  })
  const response = await app.inject({
    method: 'GET',
    url: '/.well-known/apple-app-site-association',
  })
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'], /^application\/json/)
  assert.deepEqual(response.json(), {
    applinks: {
      apps: [],
      details: [
        {
          appID: 'A1B2C3D4E5.ai.threadway.wayfare',
          paths: ['/auth/callback*', '/auth/native*', '/pair*'],
        },
      ],
    },
  })
  await app.close()
})

test('the VPS publishes the Android association for secure auth app links', async () => {
  const app = await buildServer({
    repository: createMemoryRepository({ allowedEmails: [] }),
    mailer: { async send() {} },
    publicUrl: 'https://offwego.example.com',
    sessionSecret: 'test-secret-that-is-long-enough',
    androidPackageName: 'ai.threadway.wayfare',
    androidCertFingerprints: [
      '12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF',
    ],
  })
  const response = await app.inject({ method: 'GET', url: '/.well-known/assetlinks.json' })
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'], /^application\/json/)
  assert.deepEqual(response.json(), [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'ai.threadway.wayfare',
        sha256_cert_fingerprints: [
          '12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF',
        ],
      },
    },
  ])
  await app.close()
})
