import pg from 'pg'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { availableSlug, normalizeProfileHandle, slugBase } from './slugs.js'
import { maskHomeZones } from './home-zone.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDirectory = join(here, '..', 'migrations')

const rows = result => result.rows || []
const sha256 = value => createHash('sha256').update(value).digest('hex')
const HANDLE_LOCK = 9152028
const TRIP_SLUG_LOCK = 9152029

export function migrationChecksumStatus(sql, storedChecksum) {
  const normalizedSql = sql.replaceAll('\r\n', '\n')
  const canonicalChecksum = sha256(normalizedSql)
  const windowsChecksum = sha256(normalizedSql.replaceAll('\n', '\r\n'))
  return {
    matches: storedChecksum === canonicalChecksum || storedChecksum === windowsChecksum,
    canonicalChecksum,
  }
}

const profileShape = value => ({
  profileId: value.id,
  email: value.email,
  handle: value.handle,
  displayName: value.display_name,
  avatarUrl: value.avatar_path,
  homePlace: value.home_place || null,
  homeLat: value.home_lat === null || value.home_lat === undefined ? null : Number(value.home_lat),
  homeLng: value.home_lng === null || value.home_lng === undefined ? null : Number(value.home_lng),
  timeZone: value.time_zone || null,
  preferences: value.preferences || {},
  joinedAt: value.joined_at ? new Date(value.joined_at).toISOString() : null,
  tripCount: Number(value.trip_count || 0),
  photoCount: Number(value.photo_count || 0),
})

const camelTrip = value => ({
  id: value.id,
  slug: value.slug,
  title: value.title,
  crew: value.crew,
  dates: value.dates,
  dayCount: value.day_count,
  startsOn: value.starts_on ? String(value.starts_on).slice(0, 10) : null,
  endsOn: value.ends_on ? String(value.ends_on).slice(0, 10) : null,
})

/* One shape for a travel segment, whatever the column names underneath. */
const segmentRow = row =>
  row
    ? {
        id: row.id,
        tripId: row.trip_id,
        mode: row.mode,
        carrier: row.carrier,
        number: row.number,
        ref: row.ref,
        fromName: row.from_name,
        fromCode: row.from_code,
        fromLng: row.from_lng,
        fromLat: row.from_lat,
        toName: row.to_name,
        toCode: row.to_code,
        toLng: row.to_lng,
        toLat: row.to_lat,
        departsAt: row.departs_at,
        arrivesAt: row.arrives_at,
        departTz: row.depart_tz,
        arriveTz: row.arrive_tz,
        terminal: row.terminal,
        gate: row.gate,
        gateWas: row.gate_was,
        platform: row.platform,
        passengers: row.passengers || [],
        bags: row.bags || null,
        deadlines: row.deadlines || null,
        costAmount: row.cost_amount == null ? null : Number(row.cost_amount),
        costCurrency: row.cost_currency,
        status: row.status,
        statusNote: row.status_note,
        notes: row.notes,
        documents: row.documents ?? undefined,
        updatedAt: row.updated_at,
      }
    : null

/* One shape for a segment's document. The storage path stays server-side. */
const documentRow = row =>
  row
    ? {
        id: row.id,
        segmentId: row.segment_id,
        personId: row.person_id,
        name: row.name,
        kind: row.kind,
        mime: row.mime,
        bytes: row.bytes,
        note: row.note ?? null,
        storagePath: row.storage_path,
      }
    : null

/* One shape for a hand-laid airport walkway. */
const walkwayRow = row =>
  row
    ? {
        id: row.id,
        lng: row.lng,
        lat: row.lat,
        level: row.level,
        name: row.name,
        points: row.points,
        createdBy: row.created_by,
        createdAt: row.created_at,
      }
    : null

/* One shape for a connected mailbox, whatever the column names underneath. */
const mailboxRow = row =>
  row
    ? {
        id: row.id,
        provider: row.provider,
        accountId: row.account_id,
        accountEmail: row.account_email,
        accountName: row.account_name,
        tenant: row.tenant,
        scopes: row.scopes || [],
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        expiresAt: row.expires_at,
        connectedAt: row.connected_at,
        lastUsedAt: row.last_used_at,
        needsReconnect: row.needs_reconnect,
      }
    : null

export async function createPostgresRepository({ databaseUrl, adminEmail }) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 })
  /* An idle client losing its connection is Tuesday: Postgres restarted, a
     deploy recreated it, the network blinked. The pool discards the client
     and dials fresh on the next query — but only if somebody is listening.
     Without this handler the event is FATAL: node kills the process, the
     fresh api dies inside its deploy health window, and the release rolls
     back "unhealthy" with nothing wrong. Loki caught it doing exactly that. */
  pool.on('error', error => {
    // Structured for Loki's `| json`; console because the pool outlives and
    // predates any request logger.
    console.warn(
      JSON.stringify({
        level: 40,
        evt: 'postgres.idle_error',
        msg: 'postgres idle client error (survived)',
        err: String(error.message || error),
      }),
    )
  })
  const admin = String(adminEmail || '')
    .trim()
    .toLowerCase()

  const ensureUser = async (client, email, chosenHandle = null) => {
    const result = await client.query(
      `insert into users(email) values($1)
      on conflict(email) do update set email=excluded.email returning id,email`,
      [email],
    )
    const user = result.rows[0]
    const rawBase = slugBase(email.split('@')[0], 'traveller', 30)
    const base = normalizeProfileHandle(rawBase) || `${rawBase.slice(0, 25) || 'traveller'}-user`
    for (let attempt = 1; attempt <= 100; attempt++) {
      const ending = attempt === 1 ? '' : `-${attempt}`
      const handle =
        chosenHandle || `${base.slice(0, 30 - ending.length).replace(/-$/g, '')}${ending}`
      const inserted = await client.query(
        `insert into profiles(id,handle,display_name)
        values($1,$2,$3) on conflict do nothing returning id`,
        [user.id, handle, email.split('@')[0]],
      )
      if (
        inserted.rowCount ||
        (await client.query('select 1 from profiles where id=$1', [user.id])).rowCount
      )
        break
      if (chosenHandle || attempt === 100)
        throw new Error('Could not allocate a unique profile handle')
    }
    return user
  }

  const memberRole = async (client, userId, tripId) => {
    const result = await client.query(
      'select role from trip_members where trip_id=$1 and profile_id=$2',
      [tripId, userId],
    )
    return result.rows[0]?.role || null
  }

  const repository = {
    async ready() {
      await pool.query('select 1')
    },
    async migrate() {
      const client = await pool.connect()
      try {
        await client.query('select pg_advisory_lock(9152027)')
        await client.query(`create table if not exists schema_migrations (
          name text primary key, checksum text not null, applied_at timestamptz not null default now()
        )`)
        const files = (await readdir(migrationsDirectory))
          .filter(name => name.endsWith('.sql'))
          .sort()
        for (const name of files) {
          const sql = await readFile(join(migrationsDirectory, name), 'utf8')
          const { canonicalChecksum: checksum } = migrationChecksumStatus(sql)
          const existing = await client.query(
            'select checksum from schema_migrations where name=$1',
            [name],
          )
          if (existing.rows[0]) {
            const status = migrationChecksumStatus(sql, existing.rows[0].checksum)
            if (!status.matches) throw new Error(`Migration ${name} changed after it was applied`)
            if (existing.rows[0].checksum !== status.canonicalChecksum) {
              await client.query('update schema_migrations set checksum=$2 where name=$1', [
                name,
                status.canonicalChecksum,
              ])
            }
            continue
          }
          await client.query('begin')
          try {
            await client.query(sql)
            await client.query('insert into schema_migrations(name,checksum) values($1,$2)', [
              name,
              checksum,
            ])
            await client.query('commit')
          } catch (error) {
            await client.query('rollback')
            throw error
          }
        }
      } finally {
        await client.query('select pg_advisory_unlock(9152027)').catch(() => {})
        client.release()
      }
    },

    /* ---- hand-laid airport walkways -----------------------------------
       Segments the assistant adds where OSM has no corridor; served merged
       into the indoor payload for any query within ~3km of their anchor. */
    async addAirportWalkway({ userId, level, name, points }) {
      const [lng, lat] = points[0]
      const result = await pool.query(
        `insert into airport_walkways(lng,lat,level,name,points,created_by)
        values($1,$2,$3,$4,$5,$6) returning *`,
        [lng, lat, level || '0', name || null, JSON.stringify(points), userId || null],
      )
      return walkwayRow(result.rows[0])
    },
    async listAirportWalkways(lng, lat) {
      const result = await pool.query(
        `select * from airport_walkways
        where abs(lng-$1) < 0.03 and abs(lat-$2) < 0.03 order by created_at`,
        [lng, lat],
      )
      return result.rows.map(walkwayRow)
    },
    async deleteAirportWalkway(id) {
      const result = await pool.query('delete from airport_walkways where id=$1', [id])
      return result.rowCount > 0
    },

    /* The durable half of the airport-indoor cache: raw Overpass JSON by
       rounded-coordinate key, so a restart forgets a Map, not the month. */
    async readAirportIndoor(key) {
      const result = await pool.query(
        `select body, (extract(epoch from fetched_at)*1000)::float8 as at
        from airport_indoor where key=$1`,
        [key],
      )
      return result.rows[0] || null
    },
    async writeAirportIndoor(key, body, at) {
      await pool.query(
        `insert into airport_indoor(key,body,fetched_at)
        values($1,$2,to_timestamp($3/1000.0))
        on conflict(key) do update set body=excluded.body, fetched_at=excluded.fetched_at`,
        [key, body, at],
      )
    },

    async emailAllowed(email) {
      if (email === admin) return true
      const result = await pool.query(
        `select 1 from users where email=$1
        union all select 1 from trip_invites where email=$1 limit 1`,
        [email],
      )
      return result.rowCount > 0
    },
    async createOidcLogin({
      stateHash,
      codeVerifier,
      nonce,
      client,
      bindingHash,
      continuation,
      expiresAt,
    }) {
      await pool.query('delete from oidc_login_attempts where expires_at <= now()')
      await pool.query(
        `insert into oidc_login_attempts
        (state_hash,code_verifier,nonce,client_kind,binding_hash,continuation,expires_at)
        values($1,$2,$3,$4,$5,$6,$7)`,
        [stateHash, codeVerifier, nonce, client, bindingHash, continuation, expiresAt],
      )
    },
    async reserveProfileHandle({ reservationHash, handle, expiresAt }) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query('select pg_advisory_xact_lock($1)', [HANDLE_LOCK])
        await client.query('delete from profile_handle_reservations where expires_at<=now()')
        const unavailable = await client.query(
          `select 1 from profiles where handle=$1
          union all select 1 from profile_handle_reservations
          where handle=$1 and reservation_hash<>$2 limit 1`,
          [handle, reservationHash],
        )
        if (unavailable.rowCount) {
          await client.query('rollback')
          return false
        }
        await client.query(
          `insert into profile_handle_reservations(reservation_hash,handle,expires_at)
          values($1,$2,$3) on conflict(reservation_hash) do update
          set handle=excluded.handle,expires_at=excluded.expires_at`,
          [reservationHash, handle, expiresAt],
        )
        await client.query('commit')
        return true
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async consumeOidcLogin(stateHash, now) {
      const result = await pool.query(
        `delete from oidc_login_attempts
        where state_hash=$1 and expires_at>$2
        returning code_verifier,nonce,client_kind,binding_hash,continuation,expires_at`,
        [stateHash, now],
      )
      const value = result.rows[0]
      return value
        ? {
            codeVerifier: value.code_verifier,
            nonce: value.nonce,
            client: value.client_kind,
            bindingHash: value.binding_hash,
            continuation: value.continuation,
            expiresAt: value.expires_at,
          }
        : null
    },
    async ensureUser(email) {
      return ensureUser(pool, email)
    },
    async resolveOidcUser({ issuer, subject, email, handleReservationHash = null }) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query('select pg_advisory_xact_lock($1)', [HANDLE_LOCK])
        const linked = await client.query(
          `select u.id,u.email from oidc_identities i
          join users u on u.id=i.user_id where i.issuer=$1 and i.subject=$2`,
          [issuer, subject],
        )
        if (linked.rows[0]) {
          if (handleReservationHash)
            await client.query(
              'delete from profile_handle_reservations where reservation_hash=$1',
              [handleReservationHash],
            )
          await client.query('commit')
          return linked.rows[0]
        }
        const known = await client.query('select id,email from users where email=$1', [email])
        let user = known.rows[0]
        if (!user) {
          const reservation = handleReservationHash
            ? await client.query(
                `select handle from profile_handle_reservations
            where reservation_hash=$1 and expires_at>now() for update`,
                [handleReservationHash],
              )
            : { rows: [] }
          if (!reservation.rows[0]) {
            await client.query('rollback')
            return null
          }
          user = await ensureUser(client, email, reservation.rows[0].handle)
        }
        const inserted = await client.query(
          `insert into oidc_identities(issuer,subject,user_id)
          values($1,$2,$3) on conflict(issuer,subject) do nothing returning user_id`,
          [issuer, subject, user.id],
        )
        if (!inserted.rowCount) {
          const raced = await client.query(
            `select u.id,u.email from oidc_identities i
            join users u on u.id=i.user_id where i.issuer=$1 and i.subject=$2`,
            [issuer, subject],
          )
          await client.query('commit')
          return raced.rows[0] || null
        }
        if (handleReservationHash)
          await client.query('delete from profile_handle_reservations where reservation_hash=$1', [
            handleReservationHash,
          ])
        await client.query('commit')
        return user
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async createLoginHandoff({ hash, userId, client, bindingHash, expiresAt }) {
      await pool.query('delete from login_handoffs where expires_at <= now()')
      await pool.query(
        `insert into login_handoffs
        (token_hash,user_id,client_kind,binding_hash,expires_at) values($1,$2,$3,$4,$5)`,
        [hash, userId, client, bindingHash, expiresAt],
      )
    },
    async consumeLoginHandoff({ hash, now, client, bindingHash }) {
      const result = await pool.query(
        `with consumed as (
          delete from login_handoffs where token_hash=$1 and expires_at>$2
            and client_kind=$3 and binding_hash=$4 returning user_id
        ) select u.id,u.email from consumed c join users u on u.id=c.user_id`,
        [hash, now, client, bindingHash],
      )
      return result.rows[0] || null
    },
    async createSession({ hash, userId, expiresAt }) {
      await pool.query('delete from sessions where expires_at <= now()')
      await pool.query('insert into sessions(token_hash,user_id,expires_at) values($1,$2,$3)', [
        hash,
        userId,
        expiresAt,
      ])
    },
    async findSession(hash, now) {
      const result = await pool.query(
        `select u.id,u.email from sessions s join users u on u.id=s.user_id
        where s.token_hash=$1 and s.expires_at>$2`,
        [hash, now],
      )
      return result.rows[0] || null
    },
    async deleteSession(hash) {
      await pool.query('delete from sessions where token_hash=$1', [hash])
    },
    async registerMcpClient(client) {
      await pool.query('delete from mcp_oauth_tokens where refresh_expires_at <= now()')
      await pool.query('delete from mcp_oauth_used_refresh_tokens where expires_at <= now()')
      await pool.query(`delete from mcp_oauth_grants g where
        (g.revoked_at is not null or g.created_at < now() - interval '90 days')
        and not exists (select 1 from mcp_oauth_tokens where grant_id=g.grant_id)`)
      await pool.query(`delete from mcp_oauth_clients c where c.created_at < now() - interval '90 days'
        and not exists (select 1 from mcp_oauth_codes where client_id=c.client_id)
        and not exists (select 1 from mcp_oauth_grants where client_id=c.client_id)`)
      const result = await pool.query(
        `insert into mcp_oauth_clients
        (client_id,client_name,redirect_uris,client_uri,logo_uri,scopes)
        values($1,$2,$3,$4,$5,$6) returning *`,
        [
          client.id,
          client.clientName,
          client.redirectUris,
          client.clientUri,
          client.logoUri,
          client.scopes,
        ],
      )
      const value = result.rows[0]
      return {
        id: value.client_id,
        clientName: value.client_name,
        redirectUris: value.redirect_uris,
        clientUri: value.client_uri,
        logoUri: value.logo_uri,
        scopes: value.scopes,
      }
    },
    async findMcpClient(id) {
      const result = await pool.query('select * from mcp_oauth_clients where client_id=$1', [id])
      const value = result.rows[0]
      return value
        ? {
            id: value.client_id,
            clientName: value.client_name,
            redirectUris: value.redirect_uris,
            clientUri: value.client_uri,
            logoUri: value.logo_uri,
            scopes: value.scopes,
          }
        : null
    },
    async createMcpAuthorizationCode(code) {
      await pool.query('delete from mcp_oauth_codes where expires_at <= now()')
      await pool.query(
        `insert into mcp_oauth_codes
        (code_hash,user_id,client_id,redirect_uri,scopes,resource,code_challenge,expires_at)
        values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          code.hash,
          code.userId,
          code.clientId,
          code.redirectUri,
          code.scopes,
          code.resource,
          code.codeChallenge,
          code.expiresAt,
        ],
      )
    },
    async redeemMcpAuthorizationCode(grant) {
      await pool.query('delete from mcp_oauth_tokens where refresh_expires_at <= $1', [grant.now])
      await pool.query('delete from mcp_oauth_used_refresh_tokens where expires_at <= $1', [
        grant.now,
      ])
      const result = await pool.query(
        `with consumed as (
          delete from mcp_oauth_codes where code_hash=$1 and expires_at>$2
            and client_id=$3 and redirect_uri=$4 and resource=$5 and code_challenge=$6
          returning user_id,client_id,scopes,resource
        ), created_grant as (
          insert into mcp_oauth_grants(user_id,client_id,scopes,resource)
          select user_id,client_id,scopes,resource from consumed
          returning grant_id,user_id,client_id,scopes,resource
        )
        insert into mcp_oauth_tokens
          (access_hash,refresh_hash,user_id,client_id,scopes,resource,access_expires_at,refresh_expires_at,grant_id)
        select $7,$8,user_id,client_id,scopes,resource,$9,$10,grant_id from created_grant
        returning user_id,client_id,scopes,resource`,
        [
          grant.codeHash,
          grant.now,
          grant.clientId,
          grant.redirectUri,
          grant.resource,
          grant.codeChallenge,
          grant.accessHash,
          grant.refreshHash,
          grant.accessExpiresAt,
          grant.refreshExpiresAt,
        ],
      )
      const value = result.rows[0]
      return value
        ? {
            userId: value.user_id,
            clientId: value.client_id,
            scopes: value.scopes,
            resource: value.resource,
          }
        : null
    },
    async findMcpAccessToken(hash, now) {
      const result = await pool.query(
        `select t.*,u.email from mcp_oauth_tokens t
        join users u on u.id=t.user_id join mcp_oauth_grants g on g.grant_id=t.grant_id
        where t.access_hash=$1 and t.access_expires_at>$2 and g.revoked_at is null`,
        [hash, now],
      )
      const value = result.rows[0]
      return value
        ? {
            accessHash: value.access_hash,
            refreshHash: value.refresh_hash,
            userId: value.user_id,
            clientId: value.client_id,
            scopes: value.scopes,
            resource: value.resource,
            accessExpiresAt: value.access_expires_at,
            refreshExpiresAt: value.refresh_expires_at,
            user: { id: value.user_id, email: value.email },
          }
        : null
    },
    async rotateMcpRefreshToken(grant) {
      await pool.query('delete from mcp_oauth_tokens where refresh_expires_at <= $1', [grant.now])
      await pool.query('delete from mcp_oauth_used_refresh_tokens where expires_at <= $1', [
        grant.now,
      ])
      const client = await pool.connect()
      try {
        await client.query('begin')
        const family = await client.query(
          `select grant_id from mcp_oauth_tokens
            where refresh_hash=$1 and client_id=$2 and resource=$3
          union select grant_id from mcp_oauth_used_refresh_tokens
            where refresh_hash=$1 and client_id=$2 and resource=$3`,
          [grant.refreshHash, grant.clientId, grant.resource],
        )
        if (!family.rows[0]) {
          await client.query('rollback')
          return null
        }
        const locked = await client.query(
          `select grant_id,revoked_at from mcp_oauth_grants
          where grant_id=$1 for update`,
          [family.rows[0].grant_id],
        )
        if (!locked.rows[0] || locked.rows[0].revoked_at) {
          await client.query('rollback')
          return null
        }
        const replay = await client.query(
          `select 1 from mcp_oauth_used_refresh_tokens
          where refresh_hash=$1 and grant_id=$2 and expires_at>$3`,
          [grant.refreshHash, family.rows[0].grant_id, grant.now],
        )
        if (replay.rows[0]) {
          await client.query('update mcp_oauth_grants set revoked_at=$2 where grant_id=$1', [
            family.rows[0].grant_id,
            grant.now,
          ])
          await client.query('delete from mcp_oauth_tokens where grant_id=$1', [
            family.rows[0].grant_id,
          ])
          await client.query('commit')
          return null
        }
        const consumed = await client.query(
          `delete from mcp_oauth_tokens
          where refresh_hash=$1 and refresh_expires_at>$2 and client_id=$3 and resource=$4
          returning user_id,client_id,scopes,resource,grant_id,refresh_hash,refresh_expires_at`,
          [grant.refreshHash, grant.now, grant.clientId, grant.resource],
        )
        const value = consumed.rows[0]
        if (!value) {
          await client.query('rollback')
          return null
        }
        await client.query(
          'update mcp_oauth_used_refresh_tokens set expires_at=$2 where grant_id=$1',
          [value.grant_id, grant.refreshExpiresAt],
        )
        await client.query(
          `insert into mcp_oauth_used_refresh_tokens
          (refresh_hash,grant_id,client_id,resource,expires_at) values($1,$2,$3,$4,$5)`,
          [
            value.refresh_hash,
            value.grant_id,
            value.client_id,
            value.resource,
            value.refresh_expires_at,
          ],
        )
        await client.query(
          `insert into mcp_oauth_tokens
          (access_hash,refresh_hash,user_id,client_id,scopes,resource,access_expires_at,refresh_expires_at,grant_id)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            grant.accessHash,
            grant.replacementRefreshHash,
            value.user_id,
            value.client_id,
            value.scopes,
            value.resource,
            grant.accessExpiresAt,
            grant.refreshExpiresAt,
            value.grant_id,
          ],
        )
        await client.query('commit')
        return {
          userId: value.user_id,
          clientId: value.client_id,
          scopes: value.scopes,
          resource: value.resource,
        }
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async revokeMcpToken(hash) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const family = await client.query(
          `select grant_id from mcp_oauth_tokens
            where access_hash=$1 or refresh_hash=$1
          union select grant_id from mcp_oauth_used_refresh_tokens where refresh_hash=$1`,
          [hash],
        )
        if (family.rows[0]) {
          await client.query('select grant_id from mcp_oauth_grants where grant_id=$1 for update', [
            family.rows[0].grant_id,
          ])
          await client.query('update mcp_oauth_grants set revoked_at=now() where grant_id=$1', [
            family.rows[0].grant_id,
          ])
          await client.query('delete from mcp_oauth_tokens where grant_id=$1', [
            family.rows[0].grant_id,
          ])
        }
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },

    async createTrip(user, input) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query('select pg_advisory_xact_lock($1)', [TRIP_SLUG_LOCK])
        const slug = await availableSlug(
          input.title,
          async candidate =>
            (
              await client.query(
                `select 1 from trips where slug=$1
          union all select 1 from trip_slug_aliases where slug=$1 limit 1`,
                [candidate],
              )
            ).rowCount > 0,
        )
        const result = await client.query(
          `insert into trips(slug,title,crew,dates,day_count,starts_on,ends_on)
          values($1,$2,$3,$4,$5,$6,$7) returning *`,
          [
            slug,
            input.title,
            input.crew || null,
            input.dates || null,
            input.dayCount || 1,
            input.startsOn || null,
            input.endsOn || null,
          ],
        )
        await client.query(
          `insert into trip_members(trip_id,profile_id,role)
          values($1,$2,'owner')`,
          [result.rows[0].id, user.id],
        )
        await client.query('commit')
        return { ...camelTrip(result.rows[0]), ownerId: user.id }
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },

    async listTrips(user) {
      /* The home globe draws every trip as an arc, and the trip cards carry
         their own tallies, so the list answers with both rather than making the
         client open each trip to find out. Places are capped: a long trip has
         hundreds of stops and the globe cannot show the difference. */
      const result = await pool.query(
        `select t.*,m.role,
        coalesce(s.places,'[]'::json) places,
        coalesce(sc.stop_count,0) stop_count,
        coalesce(p.photo_count,0) photo_count,
        coalesce(mem.member_count,0) member_count
        from trips t
        join trip_members m on m.trip_id=t.id
        left join lateral (
          select json_agg(json_build_object('name',name,'lng',lng,'lat',lat,'status',status)
                          order by seq,created_at) places
          from (select name,lng,lat,status,seq,created_at from stops
                where trip_id=t.id order by seq,created_at limit 60) capped
        ) s on true
        left join lateral (select count(*) stop_count from stops where trip_id=t.id) sc on true
        left join lateral (select count(*) photo_count from photos where trip_id=t.id) p on true
        left join lateral (select count(*) member_count from trip_members where trip_id=t.id) mem on true
        where m.profile_id=$1 order by t.created_at`,
        [user.id],
      )
      return result.rows.map(value => ({
        ...camelTrip(value),
        role: value.role,
        places: (value.places || []).map(place => ({
          name: place.name,
          lng: Number(place.lng),
          lat: Number(place.lat),
          status: place.status,
        })),
        stopCount: Number(value.stop_count),
        photoCount: Number(value.photo_count),
        memberCount: Number(value.member_count),
      }))
    },

    async loadCurrentTrip(user, slug) {
      const values = [user.id]
      let where = 'm.profile_id=$1'
      if (slug) {
        values.push(slug)
        where += ` and (t.slug=$2 or exists(
          select 1 from trip_slug_aliases a where a.trip_id=t.id and a.slug=$2))`
      }
      const tripResult = await pool.query(
        `select t.* from trips t join trip_members m on m.trip_id=t.id
        where ${where} order by t.created_at limit 1`,
        values,
      )
      if (!tripResult.rows[0]) return null
      const trip = tripResult.rows[0]
      const [members, stops, photos, route, comments, likes] = await Promise.all([
        pool.query(
          `select m.profile_id,m.role,p.handle,p.display_name,p.avatar_path,u.email from trip_members m
          join profiles p on p.id=m.profile_id join users u on u.id=p.id
          where m.trip_id=$1 order by m.joined_at`,
          [trip.id],
        ),
        pool.query(
          `select s.*, coalesce(d.documents, '[]'::json) as documents
          from stops s
          left join lateral (
            select json_agg(json_build_object(
              'id', sd.id, 'personId', sd.person_id, 'name', sd.name, 'kind', sd.kind,
              'mime', sd.mime, 'note', sd.note, 'storagePath', sd.storage_path
            ) order by sd.created_at) as documents
            from stop_documents sd where sd.stop_id = s.id
          ) d on true
          where s.trip_id=$1 order by s.seq, s.created_at`,
          [trip.id],
        ),
        pool.query('select * from photos where trip_id=$1 order by seq,created_at', [trip.id]),
        pool.query('select lng,lat from route_points where trip_id=$1 order by seq', [trip.id]),
        pool.query(
          `select c.*,p.display_name as author from comments c
          join profiles p on p.id=c.user_id
          where c.trip_id=$1 order by c.created_at`,
          [trip.id],
        ),
        pool.query('select photo_id from photo_likes where trip_id=$1 and user_id=$2', [
          trip.id,
          user.id,
        ]),
      ])
      const groupedComments = {}
      for (const comment of rows(comments)) {
        groupedComments[comment.photo_id] ||= []
        groupedComments[comment.photo_id].push({
          id: comment.id,
          by: comment.author,
          text: comment.body,
          userId: comment.user_id,
          when: new Date(comment.created_at).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        })
      }
      return {
        ...camelTrip(trip),
        members: rows(members).map(value => ({
          profileId: value.profile_id,
          email: value.email,
          handle: value.handle,
          role: value.role,
          displayName: value.display_name,
          avatarUrl: value.avatar_path,
        })),
        stops: rows(stops).map(value => ({
          id: value.id,
          name: value.name,
          kind: value.kind,
          icon: value.icon,
          day: value.day,
          time: value.time,
          lng: value.lng,
          lat: value.lat,
          status: value.status,
          note: value.note,
          seq: value.seq,
          src: value.image_url,
          sourceUrl: value.source_url,
          documents: value.documents || [],
        })),
        photos: rows(photos).map(value => ({
          id: value.id,
          stopId: value.stop_id,
          lng: value.lng,
          lat: value.lat,
          caption: value.caption,
          by: value.taken_by,
          when: value.taken_at?.toISOString?.() || value.taken_at,
          locationSource: value.location_source,
          storagePath: value.storage_path,
          thumbPath: value.thumb_path,
          seq: value.seq,
        })),
        route: rows(route).map(value => [value.lng, value.lat]),
        comments: groupedComments,
        likes: rows(likes).map(value => String(value.photo_id)),
      }
    },
    async updateTrip(user, tripId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const allowed = {
        title: 'title',
        crew: 'crew',
        dates: 'dates',
        dayCount: 'day_count',
        startsOn: 'starts_on',
        endsOn: 'ends_on',
      }
      const entries = Object.entries(changes).filter(([key]) => allowed[key])
      if (entries.length) {
        const set = entries.map(([key], index) => `${allowed[key]}=$${index + 2}`).join(',')
        await pool.query(`update trips set ${set} where id=$1`, [
          tripId,
          ...entries.map(([, value]) => value),
        ])
      }
      const result = await pool.query('select * from trips where id=$1', [tripId])
      return result.rows[0] ? camelTrip(result.rows[0]) : null
    },
    async loadProfileByHandle(user, handle) {
      const result = await pool.query(
        `select p.id,p.handle,p.display_name,p.avatar_path
        from profiles p where p.handle=$2 and (p.id=$1 or exists(
          select 1 from trip_members mine join trip_members theirs on theirs.trip_id=mine.trip_id
          where mine.profile_id=$1 and theirs.profile_id=p.id
        ))`,
        [user.id, handle],
      )
      const value = result.rows[0]
      return value
        ? {
            profileId: value.id,
            handle: value.handle,
            displayName: value.display_name,
            avatarUrl: value.avatar_path,
          }
        : null
    },
    async loadProfile(user) {
      const result = await pool.query(
        `select p.*,u.email,u.created_at joined_at,
        (select count(*) from trip_members where profile_id=p.id) trip_count,
        (select count(*) from photos where user_id=p.id) photo_count
        from profiles p join users u on u.id=p.id where p.id=$1`,
        [user.id],
      )
      return result.rows[0] ? profileShape(result.rows[0]) : null
    },
    async updateProfile(user, changes) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        if (changes.handle !== undefined) {
          await client.query('select pg_advisory_xact_lock($1)', [HANDLE_LOCK])
          await client.query('delete from profile_handle_reservations where expires_at<=now()')
          const conflict = await client.query(
            `select 1 from profiles where handle=$1 and id<>$2
            union all select 1 from profile_handle_reservations where handle=$1 limit 1`,
            [changes.handle, user.id],
          )
          if (conflict.rowCount) {
            await client.query('rollback')
            return { conflict: 'handle' }
          }
        }
        const previous =
          changes.avatarPath !== undefined
            ? await client.query('select avatar_path from profiles where id=$1', [user.id])
            : null
        const entries = []
        if (changes.name !== undefined) entries.push(['display_name', changes.name])
        if (changes.handle !== undefined) entries.push(['handle', changes.handle])
        if (changes.avatarPath !== undefined) entries.push(['avatar_path', changes.avatarPath])
        if (changes.homePlace !== undefined) entries.push(['home_place', changes.homePlace])
        if (changes.homeLat !== undefined) entries.push(['home_lat', changes.homeLat])
        if (changes.homeLng !== undefined) entries.push(['home_lng', changes.homeLng])
        if (changes.timeZone !== undefined) entries.push(['time_zone', changes.timeZone])
        // Merged rather than replaced: the settings page saves one card at a
        // time and must not blank the choices made on another.
        if (changes.preferences !== undefined) {
          entries.push(['preferences', JSON.stringify(changes.preferences)])
        }
        if (entries.length) {
          const set = entries
            .map(([column], index) =>
              column === 'preferences'
                ? `preferences=preferences||$${index + 2}::jsonb`
                : `${column}=$${index + 2}`,
            )
            .join(',')
          await client.query(`update profiles set ${set},updated_at=now() where id=$1`, [
            user.id,
            ...entries.map(([, value]) => value),
          ])
        }
        const result = await client.query(
          `select p.*,u.email,u.created_at joined_at,
          (select count(*) from trip_members where profile_id=p.id) trip_count,
          (select count(*) from photos where user_id=p.id) photo_count
          from profiles p join users u on u.id=p.id where p.id=$1`,
          [user.id],
        )
        await client.query('commit')
        const value = result.rows[0]
        return value
          ? { ...profileShape(value), oldAvatarUrl: previous?.rows[0]?.avatar_path || null }
          : null
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    /* ---- segments: the getting-there layer -----------------------------
       One shape for every mode of travel; documents are the leg's paperwork
       and ride the same deletion queue as photos when they go. */
    async listSegments(user, tripId) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const result = await pool.query(
        `select s.*, coalesce(d.documents, '[]'::json) as documents
        from segments s
        left join lateral (
          select json_agg(json_build_object(
            'id', sd.id, 'personId', sd.person_id, 'name', sd.name,
            'kind', sd.kind, 'mime', sd.mime, 'bytes', sd.bytes,
            'note', sd.note, 'storagePath', sd.storage_path
          ) order by sd.created_at) as documents
          from segment_documents sd where sd.segment_id = s.id
        ) d on true
        where s.trip_id = $1 order by s.departs_at`,
        [tripId],
      )
      return result.rows.map(segmentRow)
    },
    async createSegment(user, tripId, input) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      /* A leg's identity is trip + mode + carrier + number + departure. The
         same leg asked for twice — an agent retried, a user double-tapped —
         must land as one: the second ask becomes an update of the first,
         which is what the asker meant by it. */
      const existing = await pool.query(
        `select id from segments
        where trip_id = $1 and mode = $2
          and coalesce(carrier, '') = coalesce($3, '')
          and coalesce(number, '') = coalesce($4, '')
          and departs_at = $5
        limit 1`,
        [tripId, input.mode, input.carrier ?? null, input.number ?? null, input.departsAt],
      )
      if (existing.rows.length) {
        return this.updateSegment(user, tripId, existing.rows[0].id, input)
      }
      const result = await pool.query(
        `insert into segments
        (trip_id,mode,carrier,number,ref,from_name,from_code,from_lng,from_lat,
         to_name,to_code,to_lng,to_lat,departs_at,arrives_at,depart_tz,arrive_tz,
         terminal,gate,platform,passengers,bags,deadlines,cost_amount,cost_currency,
         status,status_note,notes)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               $20,$21,$22,$23,$24,$25,'scheduled',null,$26) returning *`,
        [
          tripId,
          input.mode,
          input.carrier ?? null,
          input.number ?? null,
          input.ref ?? null,
          input.fromName,
          input.fromCode ?? null,
          input.fromLng ?? null,
          input.fromLat ?? null,
          input.toName,
          input.toCode ?? null,
          input.toLng ?? null,
          input.toLat ?? null,
          input.departsAt,
          input.arrivesAt ?? null,
          input.departTz ?? null,
          input.arriveTz ?? null,
          input.terminal ?? null,
          input.gate ?? null,
          input.platform ?? null,
          JSON.stringify(input.passengers ?? []),
          input.bags ? JSON.stringify(input.bags) : null,
          input.deadlines ? JSON.stringify(input.deadlines) : null,
          input.costAmount ?? null,
          input.costCurrency ?? null,
          input.notes ?? null,
        ],
      )
      return segmentRow({ ...result.rows[0], documents: [] })
    },
    async updateSegment(user, tripId, segmentId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const current = await pool.query('select * from segments where id=$1 and trip_id=$2', [
        segmentId,
        tripId,
      ])
      const row = current.rows[0]
      if (!row) return null
      // A gate change keeps its history: the old gate slides into gate_was.
      const gateWas =
        changes.gate !== undefined && changes.gate !== row.gate ? row.gate : row.gate_was
      const merged = {
        mode: changes.mode ?? row.mode,
        carrier: changes.carrier === undefined ? row.carrier : changes.carrier,
        number: changes.number === undefined ? row.number : changes.number,
        ref: changes.ref === undefined ? row.ref : changes.ref,
        from_name: changes.fromName ?? row.from_name,
        from_code: changes.fromCode === undefined ? row.from_code : changes.fromCode,
        from_lng: changes.fromLng === undefined ? row.from_lng : changes.fromLng,
        from_lat: changes.fromLat === undefined ? row.from_lat : changes.fromLat,
        to_name: changes.toName ?? row.to_name,
        to_code: changes.toCode === undefined ? row.to_code : changes.toCode,
        to_lng: changes.toLng === undefined ? row.to_lng : changes.toLng,
        to_lat: changes.toLat === undefined ? row.to_lat : changes.toLat,
        departs_at: changes.departsAt ?? row.departs_at,
        arrives_at: changes.arrivesAt === undefined ? row.arrives_at : changes.arrivesAt,
        depart_tz: changes.departTz === undefined ? row.depart_tz : changes.departTz,
        arrive_tz: changes.arriveTz === undefined ? row.arrive_tz : changes.arriveTz,
        terminal: changes.terminal === undefined ? row.terminal : changes.terminal,
        gate: changes.gate === undefined ? row.gate : changes.gate,
        platform: changes.platform === undefined ? row.platform : changes.platform,
        passengers:
          changes.passengers === undefined
            ? JSON.stringify(row.passengers)
            : JSON.stringify(changes.passengers),
        bags:
          changes.bags === undefined
            ? row.bags
              ? JSON.stringify(row.bags)
              : null
            : changes.bags
              ? JSON.stringify(changes.bags)
              : null,
        deadlines:
          changes.deadlines === undefined
            ? row.deadlines
              ? JSON.stringify(row.deadlines)
              : null
            : changes.deadlines
              ? JSON.stringify(changes.deadlines)
              : null,
        cost_amount: changes.costAmount === undefined ? row.cost_amount : changes.costAmount,
        cost_currency:
          changes.costCurrency === undefined ? row.cost_currency : changes.costCurrency,
        status: changes.status ?? row.status,
        status_note: changes.statusNote === undefined ? row.status_note : changes.statusNote,
        notes: changes.notes === undefined ? row.notes : changes.notes,
      }
      const result = await pool.query(
        `update segments set
          mode=$3,carrier=$4,number=$5,ref=$6,from_name=$7,from_code=$8,from_lng=$9,
          from_lat=$10,to_name=$11,to_code=$12,to_lng=$13,to_lat=$14,departs_at=$15,
          arrives_at=$16,depart_tz=$17,arrive_tz=$18,terminal=$19,gate=$20,gate_was=$21,
          platform=$22,passengers=$23,bags=$24,deadlines=$25,cost_amount=$26,
          cost_currency=$27,status=$28,status_note=$29,notes=$30,updated_at=now()
        where id=$1 and trip_id=$2 returning *`,
        [
          segmentId,
          tripId,
          merged.mode,
          merged.carrier,
          merged.number,
          merged.ref,
          merged.from_name,
          merged.from_code,
          merged.from_lng,
          merged.from_lat,
          merged.to_name,
          merged.to_code,
          merged.to_lng,
          merged.to_lat,
          merged.departs_at,
          merged.arrives_at,
          merged.depart_tz,
          merged.arrive_tz,
          merged.terminal,
          merged.gate,
          gateWas,
          merged.platform,
          merged.passengers,
          merged.bags,
          merged.deadlines,
          merged.cost_amount,
          merged.cost_currency,
          merged.status,
          merged.status_note,
          merged.notes,
        ],
      )
      return result.rows[0] ? segmentRow({ ...result.rows[0], documents: undefined }) : null
    },
    async deleteSegment(user, tripId, segmentId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const docs = await pool.query(
        'select storage_path from segment_documents where segment_id=$1',
        [segmentId],
      )
      const result = await pool.query('delete from segments where id=$1 and trip_id=$2', [
        segmentId,
        tripId,
      ])
      if (!result.rowCount) return null
      return { deleted: true, paths: docs.rows.map(d => d.storage_path) }
    },
    async addStopDocument(user, tripId, stopId, doc) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const owner = await pool.query('select 1 from stops where id=$1 and trip_id=$2', [
        stopId,
        tripId,
      ])
      if (!owner.rowCount) return null
      const result = await pool.query(
        `insert into stop_documents(stop_id,person_id,name,kind,mime,storage_path,bytes)
        values($1,$2,$3,$4,$5,$6,$7) returning *`,
        [stopId, doc.personId ?? null, doc.name, doc.kind, doc.mime, doc.storagePath, doc.bytes],
      )
      return documentRow(result.rows[0])
    },
    async updateStopDocument(user, tripId, documentId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const result = await pool.query(
        `update stop_documents sd
        set name = coalesce($3, sd.name),
            note = case when $4::text is null then sd.note else nullif($4, '') end,
            kind = coalesce($5, sd.kind),
            person_id = case when $6::text is null then sd.person_id else nullif($6, '')::uuid end
        from stops s
        where sd.id=$1 and sd.stop_id=s.id and s.trip_id=$2
        returning sd.*`,
        [
          documentId,
          tripId,
          changes.name ?? null,
          changes.note === undefined ? null : String(changes.note),
          changes.kind ?? null,
          changes.personId === undefined ? null : String(changes.personId ?? ''),
        ],
      )
      return result.rows[0] ? documentRow(result.rows[0]) : null
    },
    async deleteStopDocument(user, tripId, documentId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const result = await pool.query(
        `delete from stop_documents sd using stops s
        where sd.id=$1 and sd.stop_id=s.id and s.trip_id=$2
        returning sd.storage_path`,
        [documentId, tripId],
      )
      return result.rows[0] ? { storagePath: result.rows[0].storage_path } : null
    },
    async addSegmentDocument(user, tripId, segmentId, doc) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const owner = await pool.query('select 1 from segments where id=$1 and trip_id=$2', [
        segmentId,
        tripId,
      ])
      if (!owner.rowCount) return null
      const result = await pool.query(
        `insert into segment_documents(segment_id,person_id,name,kind,mime,storage_path,bytes)
        values($1,$2,$3,$4,$5,$6,$7) returning *`,
        [segmentId, doc.personId ?? null, doc.name, doc.kind, doc.mime, doc.storagePath, doc.bytes],
      )
      return documentRow(result.rows[0])
    },
    async updateSegmentDocument(user, tripId, documentId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const result = await pool.query(
        `update segment_documents sd
        set name = coalesce($3, sd.name),
            note = case when $4::text is null then sd.note else nullif($4, '') end,
            kind = coalesce($5, sd.kind),
            person_id = case when $6::text is null then sd.person_id else nullif($6, '')::uuid end
        from segments s
        where sd.id=$1 and sd.segment_id=s.id and s.trip_id=$2
        returning sd.*`,
        [
          documentId,
          tripId,
          changes.name ?? null,
          changes.note === undefined ? null : String(changes.note),
          changes.kind ?? null,
          changes.personId === undefined ? null : String(changes.personId ?? ''),
        ],
      )
      return result.rows[0] ? documentRow(result.rows[0]) : null
    },
    async findSegmentDocument(user, tripId, documentId) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const result = await pool.query(
        `select sd.* from segment_documents sd
        join segments s on s.id = sd.segment_id
        where sd.id=$1 and s.trip_id=$2`,
        [documentId, tripId],
      )
      return result.rows[0] ? documentRow(result.rows[0]) : null
    },
    async deleteSegmentDocument(user, tripId, documentId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const result = await pool.query(
        `delete from segment_documents sd using segments s
        where sd.id=$1 and sd.segment_id=s.id and s.trip_id=$2
        returning sd.storage_path`,
        [documentId, tripId],
      )
      return result.rows[0] ? { storagePath: result.rows[0].storage_path } : null
    },

    async canEditTrip(userId, tripId) {
      return ['owner', 'editor'].includes(await memberRole(pool, userId, tripId))
    },
    async canManageTrip(userId, tripId) {
      return (await memberRole(pool, userId, tripId)) === 'owner'
    },
    async canReadTrip(userId, tripId) {
      return !!(await memberRole(pool, userId, tripId))
    },
    /* Every stop's coordinate across every trip, for the routing engine's
       self-derived coverage — a maintenance view, deliberately unscoped. */
    async listStopCoordinates() {
      const result = await pool.query(
        `select distinct round(lng::numeric, 2) lng, round(lat::numeric, 2) lat
         from stops where lng is not null and lat is not null`,
      )
      return result.rows.map(value => [Number(value.lng), Number(value.lat)])
    },
    async listStops(user, tripId) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const result = await pool.query(
        'select * from stops where trip_id=$1 order by seq,created_at',
        [tripId],
      )
      return result.rows.map(value => ({
        id: value.id,
        name: value.name,
        kind: value.kind,
        icon: value.icon,
        day: value.day,
        time: value.time,
        lng: value.lng,
        lat: value.lat,
        status: value.status,
        note: value.note,
        src: value.image_url,
        sourceUrl: value.source_url,
        seq: value.seq,
      }))
    },
    async createStop(user, tripId, input) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const result = await pool.query(
        `insert into stops
        (trip_id,name,kind,icon,day,time,lng,lat,status,note,image_url,source_url,seq)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
        [
          tripId,
          input.name,
          input.kind,
          input.icon,
          input.day,
          input.time,
          input.lng,
          input.lat,
          input.status,
          input.note,
          input.src,
          input.sourceUrl,
          input.seq,
        ],
      )
      const value = result.rows[0]
      return {
        id: value.id,
        name: value.name,
        kind: value.kind,
        icon: value.icon,
        day: value.day,
        time: value.time,
        lng: value.lng,
        lat: value.lat,
        status: value.status,
        note: value.note,
        src: value.image_url,
        sourceUrl: value.source_url,
        seq: value.seq,
      }
    },
    async updateStop(user, tripId, stopId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const allowed = {
        name: 'name',
        kind: 'kind',
        icon: 'icon',
        day: 'day',
        time: 'time',
        lng: 'lng',
        lat: 'lat',
        status: 'status',
        note: 'note',
        src: 'image_url',
        sourceUrl: 'source_url',
        seq: 'seq',
      }
      const entries = Object.entries(changes).filter(([key]) => allowed[key])
      if (!entries.length) {
        const current = await pool.query('select * from stops where id=$1 and trip_id=$2', [
          stopId,
          tripId,
        ])
        return current.rows[0] || null
      }
      const values = [stopId, tripId, ...entries.map(([, value]) => value)]
      const set = entries.map(([key], index) => `${allowed[key]}=$${index + 3}`).join(',')
      const result = await pool.query(
        `update stops set ${set} where id=$1 and trip_id=$2 returning *`,
        values,
      )
      const value = result.rows[0]
      return value
        ? {
            id: value.id,
            name: value.name,
            kind: value.kind,
            icon: value.icon,
            day: value.day,
            time: value.time,
            lng: value.lng,
            lat: value.lat,
            status: value.status,
            note: value.note,
            src: value.image_url,
            sourceUrl: value.source_url,
            seq: value.seq,
          }
        : null
    },
    async deleteStop(user, tripId, stopId) {
      if (!(await this.canEditTrip(user.id, tripId))) return false
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query('update photos set stop_id=null where trip_id=$1 and stop_id=$2', [
          tripId,
          stopId,
        ])
        const result = await client.query('delete from stops where id=$1 and trip_id=$2', [
          stopId,
          tripId,
        ])
        await client.query('commit')
        return result.rowCount > 0
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async replaceRoute(user, tripId, points) {
      if (!(await this.canEditTrip(user.id, tripId))) return false
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query('delete from route_points where trip_id=$1', [tripId])
        for (let index = 0; index < points.length; index++) {
          await client.query('insert into route_points(trip_id,lng,lat,seq) values($1,$2,$3,$4)', [
            tripId,
            points[index][0],
            points[index][1],
            index,
          ])
        }
        await client.query('commit')
        return true
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async upsertInvite(user, tripId, input) {
      if (!(await this.canManageTrip(user.id, tripId))) return null
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await client.query(
          `with invitation as (
          insert into trip_invites(trip_id,email,name,role)
          values($1,$2,$3,$4) on conflict(trip_id,email) do update
          set name=excluded.name,role=excluded.role returning *
        ) select invitation.*,t.slug trip_slug,t.title trip_title
          from invitation join trips t on t.id=invitation.trip_id`,
          [tripId, input.email, input.name, input.role],
        )
        await client.query(
          `update trip_members m set role=$3 from users u
          where m.trip_id=$1 and m.profile_id=u.id and u.email=$2 and m.role<>'owner'`,
          [tripId, input.email, input.role],
        )
        await client.query('commit')
        const value = result.rows[0]
        return {
          id: value.id,
          email: value.email,
          name: value.name,
          role: value.role,
          claimedAt: value.claimed_at,
          tripId: value.trip_id,
          tripSlug: value.trip_slug,
          tripTitle: value.trip_title,
        }
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async listPendingInvites(user) {
      const result = await pool.query(
        `select i.*,t.slug trip_slug,t.title trip_title
        from trip_invites i join trips t on t.id=i.trip_id
        where i.email=$1 and i.claimed_at is null order by i.created_at`,
        [user.email],
      )
      return result.rows.map(value => ({
        id: value.id,
        email: value.email,
        name: value.name,
        role: value.role,
        tripId: value.trip_id,
        tripSlug: value.trip_slug,
        tripTitle: value.trip_title,
      }))
    },
    async acceptInvite(user, inviteId) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await client.query(
          `select i.*,t.slug trip_slug,t.title trip_title
          from trip_invites i join trips t on t.id=i.trip_id
          where i.id=$1 and i.email=$2 and i.claimed_at is null for update of i`,
          [inviteId, user.email],
        )
        const invite = result.rows[0]
        if (!invite) {
          await client.query('rollback')
          return null
        }
        await client.query(
          `insert into trip_members(trip_id,profile_id,role)
          values($1,$2,$3) on conflict(trip_id,profile_id) do nothing`,
          [invite.trip_id, user.id, invite.role],
        )
        await client.query('update trip_invites set claimed_at=now() where id=$1', [invite.id])
        await client.query('commit')
        return {
          tripId: invite.trip_id,
          tripSlug: invite.trip_slug,
          tripTitle: invite.trip_title,
          role: invite.role,
        }
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async listInvites(user, tripId) {
      if (!(await this.canManageTrip(user.id, tripId))) return null
      const result = await pool.query(
        'select * from trip_invites where trip_id=$1 order by created_at',
        [tripId],
      )
      return result.rows.map(value => ({
        id: value.id,
        email: value.email,
        name: value.name,
        role: value.role,
        claimedAt: value.claimed_at,
      }))
    },
    async revokeInvite(user, tripId, inviteId) {
      if (!(await this.canManageTrip(user.id, tripId))) return false
      const client = await pool.connect()
      try {
        await client.query('begin')
        const invite = await client.query(
          `select email from trip_invites
          where id=$1 and trip_id=$2 for update`,
          [inviteId, tripId],
        )
        if (!invite.rows[0]) {
          await client.query('rollback')
          return false
        }
        await client.query(
          `delete from trip_members m using users u
          where m.trip_id=$1 and m.profile_id=u.id and u.email=$2 and m.role<>'owner'`,
          [tripId, invite.rows[0].email],
        )
        await client.query('delete from trip_invites where id=$1 and trip_id=$2', [
          inviteId,
          tripId,
        ])
        await client.query('commit')
        return true
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async removeMember(user, tripId, profileId) {
      if (!(await this.canManageTrip(user.id, tripId))) return null
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await client.query(
          `select m.role,u.email from trip_members m join users u on u.id=m.profile_id
          where m.trip_id=$1 and m.profile_id=$2 for update`,
          [tripId, profileId],
        )
        const member = result.rows[0]
        if (!member) {
          await client.query('rollback')
          return null
        }
        if (member.role === 'owner') {
          await client.query('rollback')
          return 'owner'
        }
        await client.query('delete from devices where trip_id=$1 and user_id=$2', [
          tripId,
          profileId,
        ])
        await client.query('delete from trip_invites where trip_id=$1 and email=$2', [
          tripId,
          member.email,
        ])
        await client.query('delete from trip_members where trip_id=$1 and profile_id=$2', [
          tripId,
          profileId,
        ])
        await client.query('commit')
        return 'removed'
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    /* The trip's chat. Reactions ride along aggregated — {emoji, count, mine}
       — because every reader wants exactly that shape and nobody wants the
       raw rows crossing the wire. */
    async listMessages(user, tripId, { limit = 100, before = null } = {}) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const values = [tripId]
      let where = 'm.trip_id=$1'
      if (before) {
        values.push(before)
        where += ` and m.created_at < (select created_at from trip_messages where id=$${values.length})`
      }
      values.push(Math.min(Math.max(limit, 1), 200))
      const result = await pool.query(
        `select m.*, p.display_name author, p.handle from trip_messages m
         join profiles p on p.id=m.user_id
         where ${where} order by m.created_at desc limit $${values.length}`,
        values,
      )
      const rows = result.rows.reverse()
      const reactions = rows.length
        ? await pool.query(
            `select message_id, emoji, count(*)::int count,
               bool_or(user_id=$2) mine
             from trip_message_reactions where message_id = any($1)
             group by message_id, emoji order by min(created_at)`,
            [rows.map(row => row.id), user.id],
          )
        : { rows: [] }
      const byMessage = new Map()
      for (const row of reactions.rows) {
        if (!byMessage.has(row.message_id)) byMessage.set(row.message_id, [])
        byMessage.get(row.message_id).push({ emoji: row.emoji, count: row.count, mine: row.mine })
      }
      return rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        by: row.author,
        handle: row.handle,
        body: row.body,
        at: new Date(row.created_at).toISOString(),
        reactions: byMessage.get(row.id) || [],
      }))
    },
    async createMessage(user, tripId, body) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const result = await pool.query(
        'insert into trip_messages(trip_id,user_id,body) values($1,$2,$3) returning *',
        [tripId, user.id, body],
      )
      const value = result.rows[0]
      const member = await pool.query('select display_name, handle from profiles where id=$1', [
        user.id,
      ])
      return {
        id: value.id,
        userId: value.user_id,
        by: member.rows[0]?.display_name,
        handle: member.rows[0]?.handle,
        body: value.body,
        at: new Date(value.created_at).toISOString(),
        reactions: [],
      }
    },
    async deleteMessage(user, tripId, messageId) {
      const result = await pool.query(
        `delete from trip_messages m where m.id=$1 and m.trip_id=$2
         and (m.user_id=$3 or exists(select 1 from trip_members tm
           where tm.trip_id=$2 and tm.profile_id=$3 and tm.role='owner'))`,
        [messageId, tripId, user.id],
      )
      return result.rowCount > 0
    },
    async setMessageReaction(user, tripId, messageId, emoji, on) {
      if (!(await this.canReadTrip(user.id, tripId))) return false
      if (on) {
        const result = await pool.query(
          `insert into trip_message_reactions(message_id,user_id,emoji)
           select m.id,$2,$3 from trip_messages m where m.id=$1 and m.trip_id=$4
           on conflict do nothing`,
          [messageId, user.id, emoji, tripId],
        )
        return result.rowCount > 0
      }
      const result = await pool.query(
        `delete from trip_message_reactions r using trip_messages m
         where r.message_id=m.id and m.id=$1 and m.trip_id=$4 and r.user_id=$2 and r.emoji=$3`,
        [messageId, user.id, emoji, tripId],
      )
      return result.rowCount > 0
    },
    async addComment(user, tripId, photoId, body) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const result = await pool.query(
        `insert into comments(trip_id,photo_id,user_id,body)
        select $1,p.id,$2,$3 from photos p where p.id=$4 and p.trip_id=$1 returning *`,
        [tripId, user.id, body, photoId],
      )
      const value = result.rows[0]
      if (!value) return null
      const member = await pool.query('select display_name name from profiles where id=$1', [
        user.id,
      ])
      return {
        id: value.id,
        by: member.rows[0]?.name,
        text: value.body,
        userId: value.user_id,
        when: new Date(value.created_at).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      }
    },
    async deleteComment(user, tripId, commentId) {
      const result = await pool.query(
        `delete from comments c where c.id=$1 and c.trip_id=$2
        and (c.user_id=$3 or exists(select 1 from trip_members m where m.trip_id=$2 and m.profile_id=$3 and m.role in ('owner','editor')))`,
        [commentId, tripId, user.id],
      )
      return result.rowCount > 0
    },
    async setLike(user, tripId, photoId, on) {
      if (!(await this.canReadTrip(user.id, tripId))) return false
      if (on) {
        const result = await pool.query(
          `insert into photo_likes(trip_id,photo_id,user_id)
          select $1,p.id,$2 from photos p where p.id=$3 and p.trip_id=$1
          on conflict(photo_id,user_id) do nothing returning photo_id`,
          [tripId, user.id, photoId],
        )
        if (result.rowCount) return true
        const exists = await pool.query(
          'select 1 from photo_likes where photo_id=$1 and user_id=$2',
          [photoId, user.id],
        )
        return exists.rowCount > 0
      }
      await pool.query('delete from photo_likes where trip_id=$1 and photo_id=$2 and user_id=$3', [
        tripId,
        photoId,
        user.id,
      ])
      return true
    },
    async createPhoto(user, tripId, input) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const member = await pool.query('select display_name name from profiles where id=$1', [
        user.id,
      ])
      const result = await pool.query(
        `insert into photos
        (trip_id,stop_id,user_id,lng,lat,caption,taken_by,taken_at,location_source,storage_path,thumb_path,client_key,seq)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,nextval('photo_order_seq')) returning *`,
        [
          tripId,
          input.stopId,
          user.id,
          input.lng,
          input.lat,
          input.caption,
          member.rows[0]?.name,
          input.takenAt,
          input.locationSource,
          input.storagePath,
          input.thumbPath,
          input.clientKey || null,
        ],
      )
      const value = result.rows[0]
      return {
        id: value.id,
        stopId: value.stop_id,
        lng: value.lng,
        lat: value.lat,
        caption: value.caption,
        by: value.taken_by,
        when: value.taken_at?.toISOString?.() || value.taken_at,
        locationSource: value.location_source,
        storagePath: value.storage_path,
        thumbPath: value.thumb_path,
        seq: value.seq,
      }
    },
    async findPhotoByClientKey(user, tripId, clientKey) {
      if (!clientKey || !(await this.canEditTrip(user.id, tripId))) return null
      const result = await pool.query(
        `select * from photos where trip_id=$1 and user_id=$2 and client_key=$3`,
        [tripId, user.id, clientKey],
      )
      const value = result.rows[0]
      return value
        ? {
            id: value.id,
            stopId: value.stop_id,
            lng: value.lng,
            lat: value.lat,
            caption: value.caption,
            by: value.taken_by,
            when: value.taken_at?.toISOString?.() || value.taken_at,
            locationSource: value.location_source,
            storagePath: value.storage_path,
            thumbPath: value.thumb_path,
            seq: value.seq,
          }
        : null
    },
    async updatePhoto(user, tripId, photoId, changes) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      if (changes.stopId != null) {
        const stop = await pool.query('select 1 from stops where id=$1 and trip_id=$2', [
          changes.stopId,
          tripId,
        ])
        if (!stop.rows[0]) return null
      }
      const entries = []
      if (changes.caption !== undefined) entries.push(['caption', changes.caption])
      if (changes.stopId !== undefined) entries.push(['stop_id', changes.stopId])
      if (entries.length) {
        const set = entries.map(([column], index) => `${column}=$${index + 3}`).join(',')
        await pool.query(`update photos set ${set} where id=$1 and trip_id=$2`, [
          photoId,
          tripId,
          ...entries.map(([, value]) => value),
        ])
      }
      const result = await pool.query('select * from photos where id=$1 and trip_id=$2', [
        photoId,
        tripId,
      ])
      const value = result.rows[0]
      return value
        ? {
            id: value.id,
            stopId: value.stop_id,
            caption: value.caption,
            storagePath: value.storage_path,
            thumbPath: value.thumb_path,
          }
        : null
    },
    async deletePhoto(user, tripId, photoId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await client.query(
          `delete from photos where id=$1 and trip_id=$2
          returning storage_path,thumb_path`,
          [photoId, tripId],
        )
        const value = result.rows[0]
        if (!value) {
          await client.query('rollback')
          return null
        }
        for (const path of [value.storage_path, value.thumb_path].filter(Boolean)) {
          await client.query(
            `insert into file_deletion_queue(path) values($1)
            on conflict(path) do update set next_attempt_at=now()`,
            [path],
          )
        }
        await client.query('commit')
        return { storagePath: value.storage_path, thumbPath: value.thumb_path }
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async listPendingFileDeletions(now, limit = 50) {
      const result = await pool.query(
        `select path from file_deletion_queue
        where next_attempt_at <= $1 order by next_attempt_at limit $2`,
        [now, limit],
      )
      return result.rows.map(value => value.path)
    },
    async completeFileDeletion(path) {
      await pool.query('delete from file_deletion_queue where path=$1', [path])
    },
    async failFileDeletion(path, error, now) {
      await pool.query(
        `update file_deletion_queue set attempts=attempts+1,last_error=$2,
        next_attempt_at=$3::timestamptz + make_interval(secs => least(3600, (power(2,least(attempts,6))*60)::int))
        where path=$1`,
        [path, String(error || 'File deletion failed').slice(0, 2000), now],
      )
    },
    async registerDevice(user, tripId, input) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const result = await pool.query(
        `insert into devices(trip_id,user_id,name,slug,timezone,token_hash)
        values($1,$2,$3,$4,$5,$6) returning *`,
        [tripId, user.id, input.name, input.slug, input.timezone, input.tokenHash],
      )
      const value = result.rows[0]
      return {
        ...value,
        tripId: value.trip_id,
        userId: value.user_id,
        lastSeen: value.last_seen,
        createdAt: value.created_at,
      }
    },
    /* Phones registered on the user's OTHER editable trips: the ones that
       post faithfully to the wrong map because a token IS a registration.
       Surfaced so a mis-homed phone is one tap from the right trip. */
    async listAdoptableDevices(user, tripId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const result = await pool.query(
        `select d.*, t.title as trip_title from devices d
        join trips t on t.id = d.trip_id
        join trip_members m on m.trip_id = d.trip_id and m.profile_id = $1
          and m.role in ('owner','editor')
        where d.trip_id <> $2 order by d.created_at desc`,
        [user.id, tripId],
      )
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        tripId: row.trip_id,
        tripTitle: row.trip_title,
        lastSeen: row.last_seen,
      }))
    },
    /* Move a phone — and its last day of positions — to another trip the
       user edits. The token keeps working; only its home changes. */
    async adoptDevice(user, tripId, deviceId) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const found = await pool.query('select * from devices where id=$1', [deviceId])
      const device = found.rows[0]
      if (!device) return null
      if (!(await this.canEditTrip(user.id, device.trip_id))) return null
      await pool.query('update devices set trip_id=$2 where id=$1', [deviceId, tripId])
      const moved = await pool.query(
        `update positions set trip_id=$2
        where device_id=$1 and recorded_at > now() - interval '24 hours'`,
        [deviceId, tripId],
      )
      return { id: device.id, name: device.name, movedPositions: moved.rowCount }
    },
    async listDevices(user, tripId) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const result = await pool.query(
        'select * from devices where trip_id=$1 order by created_at',
        [tripId],
      )
      return result.rows.map(value => ({
        id: value.id,
        tripId: value.trip_id,
        userId: value.user_id,
        name: value.name,
        slug: value.slug,
        lastSeen: value.last_seen,
        pausedAt: value.paused_at,
        createdAt: value.created_at,
      }))
    },
    async markDevicePaused(device, at) {
      await pool.query('update devices set paused_at=$2 where id=$1', [device.id, at])
      return true
    },
    async resetDeviceToken(user, tripId, deviceId, newTokenHash) {
      if (!(await this.canEditTrip(user.id, tripId))) return null
      const result = await pool.query(
        `update devices set token_hash=$3
        where id=$1 and trip_id=$2 returning *`,
        [deviceId, tripId, newTokenHash],
      )
      const value = result.rows[0]
      return value
        ? {
            id: value.id,
            tripId: value.trip_id,
            userId: value.user_id,
            name: value.name,
            slug: value.slug,
            lastSeen: value.last_seen,
            pausedAt: value.paused_at,
          }
        : null
    },
    /* The privacy policy's number, enforced: GPS fixes die at 30 days. The
       function has lived in the schema since day one; this is what finally
       calls it. */
    async prunePositions() {
      const result = await pool.query('select wayfare_prune_positions() as removed')
      return Number(result.rows[0]?.removed || 0)
    },
    async removeDevice(user, tripId, deviceId) {
      if (!(await this.canEditTrip(user.id, tripId))) return false
      return (
        (await pool.query('delete from devices where id=$1 and trip_id=$2', [deviceId, tripId]))
          .rowCount > 0
      )
    },
    async findDeviceByTokenHash(hash) {
      const result = await pool.query('select * from devices where token_hash=$1', [hash])
      const value = result.rows[0]
      return value
        ? { ...value, tripId: value.trip_id, userId: value.user_id, lastSeen: value.last_seen }
        : null
    },
    /* ---- connected mailboxes ------------------------------------------
       A row per mailbox, so a second one is a second row. Tokens arrive
       already sealed; this never sees them in the clear. */
    async startMailboxConnection({ userId, provider, stateHash, verifier, redirectTo, expiresAt }) {
      await pool.query(
        `insert into mailbox_connection_requests
        (state_hash,user_id,provider,verifier,redirect_to,expires_at) values($1,$2,$3,$4,$5,$6)`,
        [stateHash, userId, provider, verifier, redirectTo || null, expiresAt],
      )
      await pool.query('delete from mailbox_connection_requests where expires_at < now()')
    },

    async takeMailboxConnectionRequest(stateHash) {
      const result = await pool.query(
        `delete from mailbox_connection_requests
        where state_hash=$1 and expires_at > now() returning *`,
        [stateHash],
      )
      const row = result.rows[0]
      return row
        ? {
            userId: row.user_id,
            provider: row.provider,
            verifier: row.verifier,
            redirectTo: row.redirect_to,
          }
        : null
    },

    async saveMailboxConnection(connection) {
      const result = await pool.query(
        `insert into mailbox_connections
        (user_id,provider,account_id,account_email,account_name,tenant,scopes,
         access_token,refresh_token,expires_at,needs_reconnect)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)
        on conflict (user_id,provider,account_id) do update set
          account_email=excluded.account_email, account_name=excluded.account_name,
          tenant=excluded.tenant, scopes=excluded.scopes, access_token=excluded.access_token,
          refresh_token=coalesce(excluded.refresh_token, mailbox_connections.refresh_token),
          expires_at=excluded.expires_at, needs_reconnect=false, connected_at=now()
        returning *`,
        [
          connection.userId,
          connection.provider,
          connection.accountId,
          connection.accountEmail,
          connection.accountName,
          connection.tenant,
          connection.scopes || [],
          connection.accessToken,
          connection.refreshToken,
          connection.expiresAt,
        ],
      )
      return mailboxRow(result.rows[0])
    },

    async listMailboxConnections(userId) {
      const result = await pool.query(
        `select * from mailbox_connections
        where user_id=$1 order by connected_at`,
        [userId],
      )
      return result.rows.map(mailboxRow)
    },

    async findMailboxConnection(userId, id) {
      const result = await pool.query(
        'select * from mailbox_connections where user_id=$1 and id=$2',
        [userId, id],
      )
      return result.rows[0] ? mailboxRow(result.rows[0]) : null
    },

    async updateMailboxTokens(id, { accessToken, refreshToken, expiresAt }) {
      const result = await pool.query(
        `update mailbox_connections set access_token=$2,
        refresh_token=coalesce($3, refresh_token), expires_at=$4, last_used_at=now(),
        needs_reconnect=false where id=$1 returning *`,
        [id, accessToken, refreshToken, expiresAt],
      )
      return result.rows[0] ? mailboxRow(result.rows[0]) : null
    },

    async markMailboxNeedsReconnect(id) {
      await pool.query('update mailbox_connections set needs_reconnect=true where id=$1', [id])
    },

    async deleteMailboxConnection(userId, id) {
      const result = await pool.query(
        'delete from mailbox_connections where user_id=$1 and id=$2',
        [userId, id],
      )
      return result.rowCount > 0
    },

    async insertPosition(device, fix) {
      const result = await pool.query(
        `insert into positions
        (trip_id,device_id,lng,lat,accuracy,altitude,speed,heading,battery,recorded_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(device_id,recorded_at) do nothing returning id`,
        [
          device.tripId,
          device.id,
          fix.lng,
          fix.lat,
          fix.accuracy,
          fix.altitude,
          fix.speed,
          fix.heading,
          fix.battery,
          fix.at,
        ],
      )
      /* A fix newer than a reported pause means sharing is back on; an old
         queued fix flushed after the pause does not un-pause anything. */
      if (result.rowCount)
        await pool.query(
          `update devices set last_seen=$2,
        paused_at = case when paused_at is not null and paused_at <= $2 then null else paused_at end
        where id=$1 and (last_seen is null or last_seen<$2)`,
          [device.id, fix.at],
        )
      return result.rowCount > 0
    },
    async findPositionNearCapture(user, tripId, capturedAt, toleranceMs) {
      const result = await pool.query(
        `select p.lng,p.lat,p.recorded_at
        from positions p join devices d on d.id=p.device_id
        where p.trip_id=$1 and d.user_id=$2
          and (p.accuracy is null or p.accuracy <= 80)
          and p.recorded_at between $3::timestamptz - ($4::bigint * interval '1 millisecond')
                                and $3::timestamptz + ($4::bigint * interval '1 millisecond')
        order by abs(extract(epoch from (p.recorded_at-$3::timestamptz))), p.accuracy nulls last
        limit 1`,
        [tripId, user.id, capturedAt, toleranceMs],
      )
      const value = result.rows[0]
      return value ? { lng: value.lng, lat: value.lat, at: value.recorded_at } : null
    },
    async loadLive(user, tripId, since, { afterId = 0, maxPerDevice = 100000 } = {}) {
      if (!(await this.canReadTrip(user.id, tripId))) return null
      const [devices, fixes, cursor, homes] = await Promise.all([
        pool.query('select * from devices where trip_id=$1 order by created_at', [tripId]),
        pool.query(
          `with sampled as (
          select distinct on (device_id, floor(extract(epoch from recorded_at) / 30))
            id,device_id,lng,lat,accuracy,speed,heading,recorded_at
          from positions where trip_id=$1 and recorded_at >= $2 and id>$3
          order by device_id, floor(extract(epoch from recorded_at) / 30),
            accuracy nulls last, recorded_at desc, id desc
        ), ranked as (
          select id,device_id,lng,lat,accuracy,speed,heading,recorded_at,
            row_number() over(partition by device_id order by id desc) as device_rank
          from sampled
        ) select id,device_id,lng,lat,accuracy,speed,heading,recorded_at from ranked
          where device_rank <= $4 order by id`,
          [tripId, since, afterId, maxPerDevice],
        ),
        pool.query('select coalesce(max(id),$2::bigint) cursor from positions where trip_id=$1', [
          tripId,
          afterId,
        ]),
        pool.query(
          `select d.id, p.home_lat, p.home_lng from devices d
          left join profiles p on p.id = d.user_id where d.trip_id=$1`,
          [tripId],
        ),
      ])
      /* The home privacy zone is enforced here, where the coordinates would
         otherwise leave the building — never by a client hiding what it was
         already sent. */
      const homeByDevice = new Map(
        rows(homes).map(value => [
          value.id,
          value.home_lat == null || value.home_lng == null
            ? null
            : { lat: Number(value.home_lat), lng: Number(value.home_lng) },
        ]),
      )
      const sampledFixes = rows(fixes).map(value => ({
        id: Number(value.id),
        deviceId: value.device_id,
        lng: value.lng,
        lat: value.lat,
        accuracy: value.accuracy,
        speed: value.speed,
        heading: value.heading,
        at: value.recorded_at,
      }))
      return {
        devices: rows(devices).map(value => ({
          id: value.id,
          name: value.name,
          slug: value.slug,
          userId: value.user_id,
          lastSeen: value.last_seen,
          pausedAt: value.paused_at,
          createdAt: value.created_at,
        })),
        fixes: maskHomeZones(sampledFixes, homeByDevice),
        cursor: Number(cursor.rows[0].cursor),
      }
    },
    async loadAttractions(bounds, { headlineOnly = false, limit = 1000 } = {}) {
      const result = await pool.query(
        `select id,name,descr,extract,category,image_file,lng,lat,headline
        from attractions where lat between $1 and $2 and lng between $3 and $4
        and ($5::boolean=false or headline=true) order by id limit $6`,
        [bounds.south, bounds.north, bounds.west, bounds.east, headlineOnly, limit],
      )
      return result.rows.map(value => ({
        id: value.id,
        name: value.name,
        descr: value.descr,
        extract: value.extract,
        category: value.category,
        imageFile: value.image_file,
        lng: value.lng,
        lat: value.lat,
        headline: value.headline,
      }))
    },
    /* Everything this person can see, in one pass, for the archive on the
       settings page. Photo bytes stay where they are and are referenced by
       path — the caller turns those into URLs. */
    async exportAccount(user) {
      const profile = await this.loadProfile(user)
      const trips = await pool.query(
        `select t.*,m.role from trips t
        join trip_members m on m.trip_id=t.id where m.profile_id=$1 order by t.created_at`,
        [user.id],
      )
      const exported = []
      for (const trip of trips.rows) {
        const [stops, photos, route, comments, fixes] = await Promise.all([
          pool.query('select * from stops where trip_id=$1 order by seq,created_at', [trip.id]),
          pool.query('select * from photos where trip_id=$1 order by seq,created_at', [trip.id]),
          pool.query('select lng,lat from route_points where trip_id=$1 order by seq', [trip.id]),
          pool.query(
            `select c.*,p.display_name author from comments c
            join profiles p on p.id=c.user_id where c.trip_id=$1 order by c.created_at`,
            [trip.id],
          ),
          /* Only the caller's own phones. An export is "my data", and the
             trail of everybody else on the trip is not that — it would also
             hand over the fixes inside their home zone, which loadLive masks
             precisely so they never leave the building. */
          pool.query(
            `select p.lng,p.lat,p.recorded_at from positions p
            join devices d on d.id=p.device_id
            where p.trip_id=$1 and d.user_id=$2 order by p.recorded_at`,
            [trip.id, user.id],
          ),
        ])
        exported.push({
          ...camelTrip(trip),
          role: trip.role,
          stops: stops.rows.map(value => ({
            id: value.id,
            name: value.name,
            kind: value.kind,
            day: value.day,
            time: value.time,
            lng: Number(value.lng),
            lat: Number(value.lat),
            status: value.status,
            note: value.note,
          })),
          photos: photos.rows.map(value => ({
            id: value.id,
            stopId: value.stop_id,
            caption: value.caption,
            by: value.taken_by,
            takenAt: value.taken_at,
            lng: value.lng === null ? null : Number(value.lng),
            lat: value.lat === null ? null : Number(value.lat),
            path: value.storage_path,
          })),
          route: route.rows.map(value => [Number(value.lng), Number(value.lat)]),
          comments: comments.rows.map(value => ({
            id: value.id,
            photoId: value.photo_id,
            by: value.author,
            body: value.body,
            at: value.created_at,
          })),
          trail: fixes.rows.map(value => ({
            lng: Number(value.lng),
            lat: Number(value.lat),
            at: value.recorded_at,
          })),
        })
      }
      return { profile, trips: exported }
    },
    async deleteAccount(user) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const soleTrips = await client.query(
          `select m.trip_id from trip_members m where m.profile_id=$1 and m.role='owner'
          and not exists(select 1 from trip_members other where other.trip_id=m.trip_id and other.role='owner' and other.profile_id<>$1)`,
          [user.id],
        )
        const tripIds = soleTrips.rows.map(value => value.trip_id)
        const files = await client.query(
          `
          select storage_path path from photos where user_id=$1 or trip_id=any($2::uuid[])
          union select thumb_path from photos where thumb_path is not null and (user_id=$1 or trip_id=any($2::uuid[]))
          union select avatar_path from profiles where id=$1 and avatar_path is not null`,
          [user.id, tripIds],
        )
        for (const { path } of files.rows.filter(value => value.path)) {
          await client.query(
            `insert into file_deletion_queue(path) values($1)
            on conflict(path) do update set next_attempt_at=now()`,
            [path],
          )
        }
        if (tripIds.length)
          await client.query('delete from trips where id=any($1::uuid[])', [tripIds])
        await client.query('delete from photos where user_id=$1', [user.id])
        await client.query('delete from trip_invites where email=$1', [user.email])
        await client.query('delete from users where id=$1', [user.id])
        await client.query('commit')
        return files.rows.map(value => value.path).filter(Boolean)
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async close() {
      await pool.end()
    },
  }
  return repository
}
