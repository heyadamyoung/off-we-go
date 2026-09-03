import assert from 'node:assert/strict'
import test from 'node:test'

const migration = await import('../scripts/legacyMigrationCore.mjs').catch(() => null)

test('legacy photo storage paths become authenticated Supabase download requests without a runtime dependency', () => {
  assert.ok(migration?.legacyPhotoRequest, 'legacy media migration has not been implemented')
  assert.deepEqual(
    migration.legacyPhotoRequest({
      storagePath: 'trip id/sample-photo.jpg',
      projectUrl: 'https://old-project.supabase.co/',
      serviceKey: 'service-secret',
    }),
    {
      url: 'https://old-project.supabase.co/storage/v1/object/authenticated/trip-photos/trip%20id/sample-photo.jpg',
      headers: { authorization: 'Bearer service-secret', apikey: 'service-secret' },
    },
  )
})

test('legacy owner invitations are downgraded to an allowed non-owner invitation role', () => {
  assert.ok(migration?.legacyInviteRole, 'legacy invitation role mapping has not been implemented')
  assert.equal(migration.legacyInviteRole('owner'), 'editor')
  assert.equal(migration.legacyInviteRole('editor'), 'editor')
  assert.equal(migration.legacyInviteRole('viewer'), 'viewer')
})

test('legacy photo coordinates are imported only as a valid complete pair', () => {
  assert.ok(
    migration?.legacyPhotoCoordinates,
    'legacy coordinate validation has not been implemented',
  )
  assert.deepEqual(migration.legacyPhotoCoordinates('-104.617', '50.4548'), {
    lng: -104.617,
    lat: 50.4548,
  })
  assert.deepEqual(migration.legacyPhotoCoordinates('-104.617', null), { lng: null, lat: null })
  assert.deepEqual(migration.legacyPhotoCoordinates('181', '50'), { lng: null, lat: null })
})
