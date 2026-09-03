import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleUnderTest = await import('../src/postgres.js').catch(() => null)
const databaseUrl =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/wayfare_test'
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const deployDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deploy')

test('PostgreSQL migrations create a repository that persists auth, trips and GPS', async t => {
  assert.ok(
    moduleUnderTest?.createPostgresRepository,
    'the PostgreSQL repository has not been implemented',
  )

  const admin = new pg.Client({ connectionString: databaseUrl })
  await admin.connect()
  await admin.query('drop schema public cascade; create schema public')
  await admin.end()

  const repository = await moduleUnderTest.createPostgresRepository({
    databaseUrl,
    adminEmail: 'owner@example.com',
  })
  t.after(() => repository.close())
  await repository.migrate()

  const schema = new pg.Client({ connectionString: databaseUrl })
  await schema.connect()
  const profileColumns = await schema.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name='profiles' order by column_name`)
  const membershipColumns = await schema.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name='trip_members' order by column_name`)
  const handleReservationTable = await schema.query(
    `select to_regclass('public.profile_handle_reservations') name`,
  )
  const tripAliasTable = await schema.query(`select to_regclass('public.trip_slug_aliases') name`)
  await schema.end()
  const profileColumnNames = new Set(profileColumns.rows.map(value => value.column_name))
  for (const name of ['id', 'handle', 'display_name', 'avatar_path'])
    assert.equal(profileColumnNames.has(name), true)
  assert.equal(profileColumnNames.has('slug'), false, 'a profile handle is not a trip slug')
  assert.deepEqual(
    membershipColumns.rows.map(value => value.column_name),
    ['joined_at', 'profile_id', 'role', 'trip_id'],
  )
  assert.equal(handleReservationTable.rows[0].name, 'profile_handle_reservations')
  assert.equal(tripAliasTable.rows[0].name, 'trip_slug_aliases')

  assert.equal(await repository.emailAllowed('owner@example.com'), true)
  const expiresAt = new Date('2027-01-01T00:15:00.000Z')
  await repository.createOidcLogin({
    stateHash: 'oidc-state-hash',
    codeVerifier: 'oidc-code-verifier',
    nonce: 'oidc-nonce',
    client: 'native',
    bindingHash: 'native-binding-hash',
    continuation: '/oauth/authorize?client_id=test',
    expiresAt,
  })
  assert.deepEqual(
    await repository.consumeOidcLogin('oidc-state-hash', new Date('2027-01-01T00:01:00.000Z')),
    {
      codeVerifier: 'oidc-code-verifier',
      nonce: 'oidc-nonce',
      client: 'native',
      bindingHash: 'native-binding-hash',
      continuation: '/oauth/authorize?client_id=test',
      expiresAt,
    },
  )
  assert.equal(
    await repository.consumeOidcLogin('oidc-state-hash', new Date('2027-01-01T00:02:00.000Z')),
    null,
  )

  assert.equal(
    await repository.reserveProfileHandle({
      reservationHash: 'owner-handle-reservation',
      handle: 'prairie-adam',
      expiresAt,
    }),
    true,
  )
  const user = await repository.resolveOidcUser({
    issuer: 'https://identity.example.com/oidc',
    subject: 'identity-user-1',
    email: 'owner@example.com',
    handleReservationHash: 'owner-handle-reservation',
  })
  assert.deepEqual(
    await repository.resolveOidcUser({
      issuer: 'https://identity.example.com/oidc',
      subject: 'identity-user-1',
      email: 'renamed@example.com',
    }),
    user,
  )
  assert.equal((await repository.updateProfile(user, {})).handle, 'prairie-adam')
  assert.equal(
    await repository.reserveProfileHandle({
      reservationHash: 'taken-handle-reservation',
      handle: 'prairie-adam',
      expiresAt,
    }),
    false,
  )
  assert.equal(
    await repository.reserveProfileHandle({
      reservationHash: 'new-handle-reservation',
      handle: 'new-traveller',
      expiresAt,
    }),
    true,
  )
  const uninvitedUser = await repository.resolveOidcUser({
    issuer: 'https://identity.example.com/oidc',
    subject: 'identity-uninvited',
    email: 'new@example.com',
    handleReservationHash: 'new-handle-reservation',
  })
  assert.equal(uninvitedUser.email, 'new@example.com')
  await repository.createLoginHandoff({
    hash: 'handoff-hash',
    userId: user.id,
    client: 'native',
    bindingHash: 'native-binding-hash',
    expiresAt,
  })
  assert.equal(
    await repository.consumeLoginHandoff({
      hash: 'handoff-hash',
      now: new Date('2027-01-01T00:01:00.000Z'),
      client: 'native',
      bindingHash: 'wrong-device',
    }),
    null,
  )
  assert.deepEqual(
    await repository.consumeLoginHandoff({
      hash: 'handoff-hash',
      now: new Date('2027-01-01T00:01:00.000Z'),
      client: 'native',
      bindingHash: 'native-binding-hash',
    }),
    user,
  )
  assert.equal(
    await repository.consumeLoginHandoff({
      hash: 'handoff-hash',
      now: new Date('2027-01-01T00:02:00.000Z'),
      client: 'native',
      bindingHash: 'native-binding-hash',
    }),
    null,
  )

  const oauthClient = await repository.registerMcpClient({
    id: 'client-postgres-test',
    clientName: 'Postgres MCP client',
    redirectUris: ['http://127.0.0.1:3210/callback'],
    clientUri: null,
    logoUri: null,
    scopes: ['trips:read', 'trips:write'],
  })
  assert.deepEqual(await repository.findMcpClient(oauthClient.id), oauthClient)
  await repository.createMcpAuthorizationCode({
    hash: 'oauth-code-hash',
    userId: user.id,
    clientId: oauthClient.id,
    redirectUri: oauthClient.redirectUris[0],
    scopes: ['trips:read'],
    resource: 'https://offwego.example.com/mcp',
    codeChallenge: 'challenge',
    expiresAt,
  })
  const oauthCode = await repository.redeemMcpAuthorizationCode({
    codeHash: 'oauth-code-hash',
    now: new Date('2027-01-01T00:01:00Z'),
    clientId: oauthClient.id,
    redirectUri: oauthClient.redirectUris[0],
    resource: 'https://offwego.example.com/mcp',
    codeChallenge: 'challenge',
    accessHash: 'oauth-access-hash',
    refreshHash: 'oauth-refresh-hash',
    accessExpiresAt: expiresAt,
    refreshExpiresAt: new Date('2027-01-31T00:00:00Z'),
  })
  assert.equal(oauthCode.clientId, oauthClient.id)
  assert.deepEqual(oauthCode.scopes, ['trips:read'])
  assert.equal(
    await repository.redeemMcpAuthorizationCode({
      codeHash: 'oauth-code-hash',
      now: new Date('2027-01-01T00:02:00Z'),
      clientId: oauthClient.id,
      redirectUri: oauthClient.redirectUris[0],
      resource: 'https://offwego.example.com/mcp',
      codeChallenge: 'challenge',
      accessHash: 'unused-access',
      refreshHash: 'unused-refresh',
      accessExpiresAt: expiresAt,
      refreshExpiresAt: new Date('2027-01-31T00:00:00Z'),
    }),
    null,
  )
  assert.equal(
    (await repository.findMcpAccessToken('oauth-access-hash', new Date('2027-01-01T00:01:00Z')))
      .user.email,
    user.email,
  )
  assert.equal(
    (
      await repository.rotateMcpRefreshToken({
        refreshHash: 'oauth-refresh-hash',
        now: new Date('2027-01-01T00:01:00Z'),
        clientId: oauthClient.id,
        resource: 'https://offwego.example.com/mcp',
        accessHash: 'oauth-access-rotated',
        replacementRefreshHash: 'oauth-refresh-rotated',
        accessExpiresAt: expiresAt,
        refreshExpiresAt: new Date('2027-01-31T00:00:00Z'),
      })
    ).clientId,
    oauthClient.id,
  )
  assert.equal(
    await repository.findMcpAccessToken('oauth-access-hash', new Date('2027-01-01T00:02:00Z')),
    null,
  )
  assert.equal(
    (await repository.findMcpAccessToken('oauth-access-rotated', new Date('2027-01-01T00:02:00Z')))
      .clientId,
    oauthClient.id,
  )
  assert.equal(
    await repository.rotateMcpRefreshToken({
      refreshHash: 'oauth-refresh-hash',
      now: new Date('2027-01-01T00:03:00Z'),
      clientId: oauthClient.id,
      resource: 'https://offwego.example.com/mcp',
      accessHash: 'unused-access-replay',
      replacementRefreshHash: 'unused-refresh-replay',
      accessExpiresAt: expiresAt,
      refreshExpiresAt: new Date('2027-01-31T00:00:00Z'),
    }),
    null,
  )
  assert.equal(
    await repository.findMcpAccessToken('oauth-access-rotated', new Date('2027-01-01T00:04:00Z')),
    null,
  )

  const issueGrant = async suffix => {
    await repository.createMcpAuthorizationCode({
      hash: `code-${suffix}`,
      userId: user.id,
      clientId: oauthClient.id,
      redirectUri: oauthClient.redirectUris[0],
      scopes: ['trips:read'],
      resource: 'https://offwego.example.com/mcp',
      codeChallenge: 'challenge',
      expiresAt,
    })
    return repository.redeemMcpAuthorizationCode({
      codeHash: `code-${suffix}`,
      now: new Date('2027-01-01T00:01:00Z'),
      clientId: oauthClient.id,
      redirectUri: oauthClient.redirectUris[0],
      resource: 'https://offwego.example.com/mcp',
      codeChallenge: 'challenge',
      accessHash: `access-${suffix}`,
      refreshHash: `refresh-${suffix}`,
      accessExpiresAt: expiresAt,
      refreshExpiresAt: new Date('2027-01-31T00:00:00Z'),
    })
  }
  await issueGrant('concurrent-replay')
  await repository.rotateMcpRefreshToken({
    refreshHash: 'refresh-concurrent-replay',
    now: new Date('2027-01-01T00:02:00Z'),
    clientId: oauthClient.id,
    resource: 'https://offwego.example.com/mcp',
    accessHash: 'access-descendant',
    replacementRefreshHash: 'refresh-descendant',
    accessExpiresAt: expiresAt,
    refreshExpiresAt: new Date('2027-01-31T00:00:00Z'),
  })
  await Promise.all([
    repository.rotateMcpRefreshToken({
      refreshHash: 'refresh-descendant',
      now: new Date('2027-01-01T00:03:00Z'),
      clientId: oauthClient.id,
      resource: 'https://offwego.example.com/mcp',
      accessHash: 'access-grandchild',
      replacementRefreshHash: 'refresh-grandchild',
      accessExpiresAt: expiresAt,
      refreshExpiresAt: new Date('2027-01-31T00:00:00Z'),
    }),
    repository.rotateMcpRefreshToken({
      refreshHash: 'refresh-concurrent-replay',
      now: new Date('2027-01-01T00:03:00Z'),
      clientId: oauthClient.id,
      resource: 'https://offwego.example.com/mcp',
      accessHash: 'unused-replay',
      replacementRefreshHash: 'unused-replay-refresh',
      accessExpiresAt: expiresAt,
      refreshExpiresAt: new Date('2027-01-31T00:00:00Z'),
    }),
  ])
  assert.equal(
    await repository.findMcpAccessToken('access-grandchild', new Date('2027-01-01T00:04:00Z')),
    null,
  )

  await issueGrant('concurrent-revoke')
  await Promise.all([
    repository.rotateMcpRefreshToken({
      refreshHash: 'refresh-concurrent-revoke',
      now: new Date('2027-01-01T00:03:00Z'),
      clientId: oauthClient.id,
      resource: 'https://offwego.example.com/mcp',
      accessHash: 'access-after-revoke-race',
      replacementRefreshHash: 'refresh-after-revoke-race',
      accessExpiresAt: expiresAt,
      refreshExpiresAt: new Date('2027-01-31T00:00:00Z'),
    }),
    repository.revokeMcpToken('refresh-concurrent-revoke'),
  ])
  assert.equal(
    await repository.findMcpAccessToken(
      'access-after-revoke-race',
      new Date('2027-01-01T00:04:00Z'),
    ),
    null,
  )

  const trip = await repository.createTrip(user, { title: 'Persistent trip', dayCount: 3 })
  assert.equal(trip.slug, 'persistent-trip')
  const duplicateTrip = await repository.createTrip(user, { title: 'Persistent trip', dayCount: 1 })
  assert.equal(duplicateTrip.slug, 'persistent-trip-2')
  const aliases = new pg.Client({ connectionString: databaseUrl })
  await aliases.connect()
  await aliases.query('insert into trip_slug_aliases(trip_id,slug) values($1,$2)', [
    trip.id,
    'persistent-trip-a1b2c3',
  ])
  await aliases.end()
  const loaded = await repository.loadCurrentTrip(user, trip.slug)
  assert.equal(loaded.title, 'Persistent trip')
  assert.equal((await repository.loadCurrentTrip(user, 'persistent-trip-a1b2c3')).id, trip.id)
  assert.equal(loaded.members[0].role, 'owner')
  const changedProfile = await repository.updateProfile(user, {
    name: 'Alex',
    handle: 'alex-travels',
  })
  assert.equal(changedProfile.profileId, user.id)
  assert.equal(changedProfile.handle, 'alex-travels')
  assert.equal((await repository.loadProfileByHandle(user, 'alex-travels')).displayName, 'Alex')
  assert.equal(await repository.loadProfileByHandle(uninvitedUser, 'alex-travels'), null)
  assert.deepEqual(await repository.updateProfile(uninvitedUser, { handle: 'alex-travels' }), {
    conflict: 'handle',
  })
  await repository.updateTrip(user, trip.id, { title: 'Renamed without breaking links' })
  assert.equal((await repository.loadCurrentTrip(user, trip.slug)).slug, 'persistent-trip')
  const profileTrip = await repository.createTrip(user, { title: 'Profile check', dayCount: 1 })
  assert.equal(
    (await repository.loadCurrentTrip(user, profileTrip.slug)).members[0].displayName,
    'Alex',
  )

  const device = await repository.registerDevice(user, trip.id, {
    name: 'Phone',
    slug: 'phone-ab12',
    timezone: 'America/Regina',
    tokenHash: 'phone-hash',
  })
  await repository.insertPosition(device, {
    lng: -104.618,
    lat: 50.445,
    at: new Date('2027-01-01T00:03:00.000Z'),
    accuracy: 5,
    altitude: null,
    speed: 1.2,
    heading: null,
    battery: 90,
  })
  const live = await repository.loadLive(user, trip.id, new Date('2027-01-01T00:00:00.000Z'))
  assert.equal(live.devices.length, 1)
  assert.equal(live.fixes.length, 1)
  assert.equal(live.fixes[0].lng, -104.618)

  const bulk = new pg.Client({ connectionString: databaseUrl })
  await bulk.connect()
  const secondDevice = await repository.registerDevice(user, trip.id, {
    name: 'Tablet',
    slug: 'tablet-ab12',
    timezone: 'America/Regina',
    tokenHash: 'tablet-hash',
  })
  const thirdDevice = await repository.registerDevice(user, trip.id, {
    name: 'Spare',
    slug: 'spare-ab12',
    timezone: 'America/Regina',
    tokenHash: 'spare-hash',
  })
  await bulk.query(
    `insert into positions(trip_id,device_id,lng,lat,recorded_at)
    select $1,$2,-104.6,50.4,'2027-01-02T00:00:00Z'::timestamptz + n * interval '1 second'
    from generate_series(1,20010) n`,
    [trip.id, device.id],
  )
  await bulk.query(
    `insert into positions(trip_id,device_id,lng,lat,recorded_at)
    select $1,device_id,-104.6,50.4,'2027-01-02T00:00:00Z'::timestamptz + n * interval '1 second'
    from unnest($2::uuid[]) device_id cross join generate_series(1,2500) n`,
    [trip.id, [secondDevice.id, thirdDevice.id]],
  )
  await bulk.end()
  const large = await repository.loadLive(user, trip.id, new Date('2027-01-01T00:00:00.000Z'))
  const perDevice = Object.groupBy(large.fixes, value => value.deviceId)
  assert.equal(
    perDevice[device.id].length,
    669,
    'a noisy phone keeps one accurate sample per 30-second progress interval across the full range',
  )
  assert.equal(perDevice[secondDevice.id].length, 84)
  assert.equal(perDevice[thirdDevice.id].length, 84)
  assert.equal(large.fixes.length, 837, 'downsampling remains independent for every phone')

  await repository.insertPosition(secondDevice, {
    lng: -104.5,
    lat: 50.5,
    at: new Date('2027-01-03T00:00:00.000Z'),
    accuracy: 4,
    altitude: null,
    speed: 0,
    heading: null,
    battery: 80,
  })
  const delta = await repository.loadLive(user, trip.id, new Date('2027-01-01T00:00:00.000Z'), {
    afterId: large.cursor,
  })
  assert.equal(delta.fixes.length, 1)
  assert.equal(delta.fixes[0].lat, 50.5)

  const invitation = await repository.upsertInvite(user, trip.id, {
    email: 'friend@example.com',
    name: 'Friend',
    role: 'editor',
  })
  assert.equal(
    await repository.reserveProfileHandle({
      reservationHash: 'friend-handle-reservation',
      handle: 'friendly-alex',
      expiresAt,
    }),
    true,
  )
  const friend = await repository.resolveOidcUser({
    issuer: 'https://identity.example.com/oidc',
    subject: 'identity-user-2',
    email: 'friend@example.com',
    handleReservationHash: 'friend-handle-reservation',
  })
  assert.equal(await repository.loadCurrentTrip(friend, trip.slug), null)
  assert.deepEqual(await repository.listPendingInvites(friend), [
    {
      id: invitation.id,
      email: 'friend@example.com',
      name: 'Friend',
      role: 'editor',
      tripId: trip.id,
      tripSlug: trip.slug,
      tripTitle: 'Renamed without breaking links',
    },
  ])
  assert.equal((await repository.acceptInvite(friend, invitation.id)).tripId, trip.id)
  assert.deepEqual(await repository.listPendingInvites(friend), [])
  assert.equal(
    (await repository.loadCurrentTrip(friend, trip.slug)).members.find(
      value => value.profileId === friend.id,
    ).role,
    'editor',
  )
  await repository.upsertInvite(user, trip.id, {
    email: 'friend@example.com',
    name: 'Friend',
    role: 'viewer',
  })
  assert.equal(
    (await repository.loadCurrentTrip(friend, trip.slug)).members.find(
      value => value.profileId === friend.id,
    ).role,
    'viewer',
  )
  assert.equal(await repository.revokeInvite(user, trip.id, invitation.id), true)
  assert.equal(await repository.loadCurrentTrip(friend, trip.slug), null)

  const otherTrip = await repository.createTrip(user, { title: 'Other trip', dayCount: 1 })
  const otherStop = await repository.createStop(user, otherTrip.id, {
    name: 'Wrong trip',
    lng: -104.7,
    lat: 50.4,
    icon: 'pin',
    status: 'planned',
    seq: 0,
  })
  await assert.rejects(
    repository.createPhoto(user, trip.id, {
      stopId: otherStop.id,
      lng: -104.6,
      lat: 50.4,
      caption: 'Cross trip',
      takenAt: new Date('2027-01-02T01:00:00Z'),
      locationSource: 'manual',
      storagePath: `${trip.id}/cross.jpg`,
      thumbPath: `${trip.id}/cross.thumb.jpg`,
    }),
    error => error.code === '23503',
  )

  const queuedPhoto = await repository.createPhoto(user, trip.id, {
    stopId: null,
    lng: -104.6,
    lat: 50.4,
    caption: 'Queued delete',
    takenAt: new Date('2027-01-02T01:00:00Z'),
    locationSource: 'trail',
    storagePath: `${trip.id}/queued.jpg`,
    thumbPath: `${trip.id}/queued.thumb.jpg`,
  })
  await repository.deletePhoto(user, trip.id, queuedPhoto.id)
  assert.deepEqual(
    (await repository.listPendingFileDeletions(new Date('2027-01-01T00:01:00Z'))).sort(),
    [`${trip.id}/queued.jpg`, `${trip.id}/queued.thumb.jpg`].sort(),
  )
  await repository.completeFileDeletion(`${trip.id}/queued.jpg`)
  await repository.failFileDeletion(
    `${trip.id}/queued.thumb.jpg`,
    'disk busy',
    new Date('2027-01-01T00:01:00Z'),
  )
  assert.deepEqual(await repository.listPendingFileDeletions(new Date('2027-01-01T00:01:30Z')), [])
  assert.deepEqual(await repository.listPendingFileDeletions(new Date('2027-01-01T00:02:01Z')), [
    `${trip.id}/queued.thumb.jpg`,
  ])

  const mine = await repository.createPhoto(user, trip.id, {
    stopId: null,
    lng: -104.6,
    lat: 50.4,
    caption: 'Mine',
    takenAt: new Date('2027-01-02T01:00:00Z'),
    locationSource: 'trail',
    storagePath: `${trip.id}/mine.jpg`,
    thumbPath: `${trip.id}/mine.thumb.jpg`,
  })
  assert.ok(mine.seq > queuedPhoto.seq, 'deleting a photo must not reuse its map ordering sequence')
  const reloadedMine = (await repository.loadCurrentTrip(user, trip.slug)).photos.find(
    value => value.id === mine.id,
  )
  assert.equal(reloadedMine.lng, -104.6)
  assert.equal(reloadedMine.lat, 50.4)
  assert.equal(reloadedMine.locationSource, 'trail')
  await assert.rejects(
    repository.createPhoto(user, trip.id, {
      stopId: null,
      lng: -181,
      lat: 50.4,
      caption: 'Invalid coordinate',
      storagePath: `${trip.id}/invalid.jpg`,
      thumbPath: `${trip.id}/invalid.thumb.jpg`,
    }),
    error => error.code === '23514',
  )
  await repository.createSession({ hash: 'delete-session', userId: user.id, expiresAt })
  assert.deepEqual(
    (await repository.deleteAccount(user)).sort(),
    [`${trip.id}/mine.jpg`, `${trip.id}/mine.thumb.jpg`].sort(),
  )
  assert.equal(
    await repository.findSession('delete-session', new Date('2027-01-01T00:01:00Z')),
    null,
  )
})

test('the human-slug migration upgrades existing profiles and preserves old trip links', async t => {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  await client.query('drop schema public cascade; create schema public')
  await client.query(`create table schema_migrations (
    name text primary key, checksum text not null, applied_at timestamptz not null default now()
  )`)
  const files = (await readdir(migrationsDirectory)).filter(name => name.endsWith('.sql')).sort()
  for (const name of files.filter(name => name < '008_global_profiles.sql')) {
    const sql = await readFile(join(migrationsDirectory, name), 'utf8')
    await client.query(sql)
    await client.query('insert into schema_migrations(name,checksum) values($1,$2)', [
      name,
      moduleUnderTest.migrationChecksumStatus(sql).canonicalChecksum,
    ])
  }
  const userId = '00000000-0000-4000-8000-000000000901'
  const tripId = '00000000-0000-4000-8000-000000000902'
  await client.query('insert into users(id,email) values($1,$2)', [userId, 'alex@example.com'])
  await client.query(`insert into trips(id,slug,title,day_count) values($1,$2,$3,1)`, [
    tripId,
    'scotland-2027-a1b2c3',
    'Scotland 2027',
  ])
  await client.query(
    `insert into trip_members(trip_id,user_id,role,display_name)
    values($1,$2,'owner','Alex Owner')`,
    [tripId, userId],
  )
  const profilesSql = await readFile(join(migrationsDirectory, '008_global_profiles.sql'), 'utf8')
  await client.query(profilesSql)
  await client.query('insert into schema_migrations(name,checksum) values($1,$2)', [
    '008_global_profiles.sql',
    moduleUnderTest.migrationChecksumStatus(profilesSql).canonicalChecksum,
  ])
  await client.end()

  const repository = await moduleUnderTest.createPostgresRepository({
    databaseUrl,
    adminEmail: 'alex@example.com',
  })
  t.after(() => repository.close())
  await repository.migrate()

  const profile = await repository.updateProfile({ id: userId, email: 'alex@example.com' }, {})
  assert.equal(profile.handle, 'alex-owner')
  assert.equal((await repository.loadCurrentTrip({ id: userId }, 'scotland-2027')).id, tripId)
  assert.equal(
    (await repository.loadCurrentTrip({ id: userId }, 'scotland-2027-a1b2c3')).id,
    tripId,
  )
})

test('the VPS configures Logto for the email and password flow exposed by the app', async () => {
  const sql = await readFile(join(deployDirectory, 'configure-logto.sql'), 'utf8').catch(() => null)
  assert.ok(sql, 'the deployment must include an idempotent Logto sign-in configuration')

  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`create temporary table sign_in_experiences (
      tenant_id text not null, id text not null, sign_in jsonb not null, sign_up jsonb not null
    ) on commit drop`)
    await client.query(`insert into sign_in_experiences(tenant_id,id,sign_in,sign_up) values(
      'default', 'default',
      '{"methods":[{"identifier":"username","password":true,"verificationCode":false,"isPasswordPrimary":true}],"legacyOption":"keep"}',
      '{"identifiers":["username"],"password":true,"verify":false,"secondaryIdentifiers":["phone"],"legacyOption":"keep"}'
    )`)

    await client.query(sql)
    const first = await client.query(`select sign_in,sign_up from sign_in_experiences
      where tenant_id='default' and id='default'`)
    await client.query(sql)
    const result = await client.query(`select sign_in,sign_up from sign_in_experiences
      where tenant_id='default' and id='default'`)
    assert.deepEqual(result.rows, first.rows, 'reapplying the configuration must be idempotent')
    assert.deepEqual(result.rows[0].sign_in.methods, [
      {
        // verificationCode: the passwordless follower path — sign in with the
        // code from the invite mailbox, no password invented for one trip.
        identifier: 'email',
        password: true,
        verificationCode: true,
        isPasswordPrimary: true,
      },
    ])
    assert.equal(result.rows[0].sign_in.legacyOption, 'keep')
    assert.deepEqual(result.rows[0].sign_up.identifiers, ['email'])
    assert.equal(result.rows[0].sign_up.password, true)
    assert.equal(result.rows[0].sign_up.verify, true)
    assert.deepEqual(result.rows[0].sign_up.secondaryIdentifiers, ['phone'])
    assert.equal(result.rows[0].sign_up.legacyOption, 'keep')
  } finally {
    await client.query('rollback').catch(() => {})
    await client.end()
  }
})

test('the VPS fails closed when Logto has no default sign-in experience to configure', async () => {
  const sql = await readFile(join(deployDirectory, 'configure-logto.sql'), 'utf8')
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`create temporary table sign_in_experiences (
      tenant_id text not null, id text not null, sign_in jsonb not null, sign_up jsonb not null
    ) on commit drop`)
    await assert.rejects(client.query(sql), /default Logto sign-in experience was not found/i)
  } finally {
    await client.query('rollback').catch(() => {})
    await client.end()
  }
})
