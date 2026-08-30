import assert from 'node:assert/strict'
import test from 'node:test'

const migration = await import('../scripts/legacyMigrationCore.mjs').catch(() => null)

test('legacy photo storage paths become authenticated Supabase download requests without a runtime dependency', () => {
  assert.ok(migration?.legacyPhotoRequest, 'legacy media migration has not been implemented')
  assert.deepEqual(migration.legacyPhotoRequest({
    storagePath: 'trip id/sample-photo.jpg',
    projectUrl: 'https://old-project.supabase.co/',
    serviceKey: 'service-secret',
  }), {
    url: 'https://old-project.supabase.co/storage/v1/object/authenticated/trip-photos/trip%20id/sample-photo.jpg',
    headers: { authorization: 'Bearer service-secret', apikey: 'service-secret' },
  })
})

test('legacy owner invitations are downgraded to an allowed non-owner invitation role', () => {
  assert.ok(migration?.legacyInviteRole, 'legacy invitation role mapping has not been implemented')
  assert.equal(migration.legacyInviteRole('owner'), 'editor')
  assert.equal(migration.legacyInviteRole('editor'), 'editor')
  assert.equal(migration.legacyInviteRole('viewer'), 'viewer')
})
