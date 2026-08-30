import pg from 'pg'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDirectory = join(here, '..', 'migrations')

const rows = result => result.rows || []
const camelTrip = value => ({
  id: value.id, slug: value.slug, title: value.title, crew: value.crew,
  dates: value.dates, dayCount: value.day_count,
  startsOn: value.starts_on ? String(value.starts_on).slice(0, 10) : null,
  endsOn: value.ends_on ? String(value.ends_on).slice(0, 10) : null,
})

export async function createPostgresRepository({ databaseUrl, adminEmail }) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 })
  const admin = String(adminEmail || '').trim().toLowerCase()

  const memberRole = async (client, userId, tripId) => {
    const result = await client.query('select role from trip_members where trip_id=$1 and user_id=$2', [tripId, userId])
    return result.rows[0]?.role || null
  }

  const repository = {
    async ready() { await pool.query('select 1') },
    async migrate() {
      const client = await pool.connect()
      try {
        await client.query('select pg_advisory_lock(9152027)')
        await client.query(`create table if not exists schema_migrations (
          name text primary key, checksum text not null, applied_at timestamptz not null default now()
        )`)
        const files = (await readdir(migrationsDirectory)).filter(name => name.endsWith('.sql')).sort()
        for (const name of files) {
          const sql = await readFile(join(migrationsDirectory, name), 'utf8')
          const checksum = createHash('sha256').update(sql).digest('hex')
          const existing = await client.query('select checksum from schema_migrations where name=$1', [name])
          if (existing.rows[0]) {
            if (existing.rows[0].checksum !== checksum) throw new Error(`Migration ${name} changed after it was applied`)
            continue
          }
          await client.query('begin')
          try {
            await client.query(sql)
            await client.query('insert into schema_migrations(name,checksum) values($1,$2)', [name, checksum])
            await client.query('commit')
          } catch (error) { await client.query('rollback'); throw error }
        }
      } finally {
        await client.query('select pg_advisory_unlock(9152027)').catch(() => {})
        client.release()
      }
    },

    async emailAllowed(email) {
      if (email === admin) return true
      const result = await pool.query(`select 1 from users where email=$1
        union all select 1 from trip_invites where email=$1 limit 1`, [email])
      return result.rowCount > 0
    },
    async createMagicToken({ hash, email, expiresAt }) {
      await pool.query('delete from login_tokens where email=$1 or expires_at <= now()', [email])
      await pool.query('insert into login_tokens(token_hash,email,expires_at) values($1,$2,$3)', [hash, email, expiresAt])
    },
    async consumeMagicToken(hash, now) {
      const result = await pool.query('delete from login_tokens where token_hash=$1 and expires_at>$2 returning email', [hash, now])
      return result.rows[0]?.email || null
    },
    async ensureUser(email) {
      const result = await pool.query(`insert into users(email) values($1)
        on conflict(email) do update set email=excluded.email returning id,email`, [email])
      const user = result.rows[0]
      await pool.query(`insert into trip_members(trip_id,user_id,role,display_name)
        select trip_id,$1,role,coalesce(name,split_part($2,'@',1)) from trip_invites
        where email=$2 on conflict(trip_id,user_id) do nothing`, [user.id, email])
      await pool.query('update trip_invites set claimed_at=coalesce(claimed_at,now()) where email=$1', [email])
      return user
    },
    async createSession({ hash, userId, expiresAt }) {
      await pool.query('delete from sessions where expires_at <= now()')
      await pool.query('insert into sessions(token_hash,user_id,expires_at) values($1,$2,$3)', [hash, userId, expiresAt])
    },
    async findSession(hash, now) {
      const result = await pool.query(`select u.id,u.email from sessions s join users u on u.id=s.user_id
        where s.token_hash=$1 and s.expires_at>$2`, [hash, now])
      return result.rows[0] || null
    },
    async deleteSession(hash) { await pool.query('delete from sessions where token_hash=$1', [hash]) },
    async registerMcpClient(client) {
      await pool.query('delete from mcp_oauth_tokens where refresh_expires_at <= now()')
      await pool.query('delete from mcp_oauth_used_refresh_tokens where expires_at <= now()')
      await pool.query(`delete from mcp_oauth_grants g where
        (g.revoked_at is not null or g.created_at < now() - interval '90 days')
        and not exists (select 1 from mcp_oauth_tokens where grant_id=g.grant_id)`)
      await pool.query(`delete from mcp_oauth_clients c where c.created_at < now() - interval '90 days'
        and not exists (select 1 from mcp_oauth_codes where client_id=c.client_id)
        and not exists (select 1 from mcp_oauth_grants where client_id=c.client_id)`)
      const result = await pool.query(`insert into mcp_oauth_clients
        (client_id,client_name,redirect_uris,client_uri,logo_uri,scopes)
        values($1,$2,$3,$4,$5,$6) returning *`, [
        client.id, client.clientName, client.redirectUris, client.clientUri,
        client.logoUri, client.scopes,
      ])
      const value = result.rows[0]
      return {
        id: value.client_id, clientName: value.client_name,
        redirectUris: value.redirect_uris, clientUri: value.client_uri,
        logoUri: value.logo_uri, scopes: value.scopes,
      }
    },
    async findMcpClient(id) {
      const result = await pool.query('select * from mcp_oauth_clients where client_id=$1', [id])
      const value = result.rows[0]
      return value ? {
        id: value.client_id, clientName: value.client_name,
        redirectUris: value.redirect_uris, clientUri: value.client_uri,
        logoUri: value.logo_uri, scopes: value.scopes,
      } : null
    },
    async createMcpAuthorizationCode(code) {
      await pool.query('delete from mcp_oauth_codes where expires_at <= now()')
      await pool.query(`insert into mcp_oauth_codes
        (code_hash,user_id,client_id,redirect_uri,scopes,resource,code_challenge,expires_at)
        values($1,$2,$3,$4,$5,$6,$7,$8)`, [
        code.hash, code.userId, code.clientId, code.redirectUri, code.scopes,
        code.resource, code.codeChallenge, code.expiresAt,
      ])
    },
    async redeemMcpAuthorizationCode(grant) {
      await pool.query('delete from mcp_oauth_tokens where refresh_expires_at <= $1', [grant.now])
      await pool.query('delete from mcp_oauth_used_refresh_tokens where expires_at <= $1', [grant.now])
      const result = await pool.query(`with consumed as (
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
        returning user_id,client_id,scopes,resource`, [
        grant.codeHash, grant.now, grant.clientId, grant.redirectUri, grant.resource,
        grant.codeChallenge, grant.accessHash, grant.refreshHash,
        grant.accessExpiresAt, grant.refreshExpiresAt,
      ])
      const value = result.rows[0]
      return value ? {
        userId: value.user_id, clientId: value.client_id,
        scopes: value.scopes, resource: value.resource,
      } : null
    },
    async findMcpAccessToken(hash, now) {
      const result = await pool.query(`select t.*,u.email from mcp_oauth_tokens t
        join users u on u.id=t.user_id join mcp_oauth_grants g on g.grant_id=t.grant_id
        where t.access_hash=$1 and t.access_expires_at>$2 and g.revoked_at is null`, [hash, now])
      const value = result.rows[0]
      return value ? {
        accessHash: value.access_hash, refreshHash: value.refresh_hash,
        userId: value.user_id, clientId: value.client_id, scopes: value.scopes,
        resource: value.resource, accessExpiresAt: value.access_expires_at,
        refreshExpiresAt: value.refresh_expires_at,
        user: { id: value.user_id, email: value.email },
      } : null
    },
    async rotateMcpRefreshToken(grant) {
      await pool.query('delete from mcp_oauth_tokens where refresh_expires_at <= $1', [grant.now])
      await pool.query('delete from mcp_oauth_used_refresh_tokens where expires_at <= $1', [grant.now])
      const client = await pool.connect()
      try {
        await client.query('begin')
        const family = await client.query(`select grant_id from mcp_oauth_tokens
            where refresh_hash=$1 and client_id=$2 and resource=$3
          union select grant_id from mcp_oauth_used_refresh_tokens
            where refresh_hash=$1 and client_id=$2 and resource=$3`,
        [grant.refreshHash, grant.clientId, grant.resource])
        if (!family.rows[0]) { await client.query('rollback'); return null }
        const locked = await client.query(`select grant_id,revoked_at from mcp_oauth_grants
          where grant_id=$1 for update`, [family.rows[0].grant_id])
        if (!locked.rows[0] || locked.rows[0].revoked_at) { await client.query('rollback'); return null }
        const replay = await client.query(`select 1 from mcp_oauth_used_refresh_tokens
          where refresh_hash=$1 and grant_id=$2 and expires_at>$3`,
        [grant.refreshHash, family.rows[0].grant_id, grant.now])
        if (replay.rows[0]) {
          await client.query('update mcp_oauth_grants set revoked_at=$2 where grant_id=$1',
            [family.rows[0].grant_id, grant.now])
          await client.query('delete from mcp_oauth_tokens where grant_id=$1', [family.rows[0].grant_id])
          await client.query('commit')
          return null
        }
        const consumed = await client.query(`delete from mcp_oauth_tokens
          where refresh_hash=$1 and refresh_expires_at>$2 and client_id=$3 and resource=$4
          returning user_id,client_id,scopes,resource,grant_id,refresh_hash,refresh_expires_at`,
        [grant.refreshHash, grant.now, grant.clientId, grant.resource])
        const value = consumed.rows[0]
        if (!value) { await client.query('rollback'); return null }
        await client.query('update mcp_oauth_used_refresh_tokens set expires_at=$2 where grant_id=$1',
          [value.grant_id, grant.refreshExpiresAt])
        await client.query(`insert into mcp_oauth_used_refresh_tokens
          (refresh_hash,grant_id,client_id,resource,expires_at) values($1,$2,$3,$4,$5)`,
        [value.refresh_hash, value.grant_id, value.client_id, value.resource, value.refresh_expires_at])
        await client.query(`insert into mcp_oauth_tokens
          (access_hash,refresh_hash,user_id,client_id,scopes,resource,access_expires_at,refresh_expires_at,grant_id)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
          grant.accessHash, grant.replacementRefreshHash, value.user_id, value.client_id,
          value.scopes, value.resource, grant.accessExpiresAt, grant.refreshExpiresAt, value.grant_id,
        ])
        await client.query('commit')
        return {
          userId: value.user_id, clientId: value.client_id,
          scopes: value.scopes, resource: value.resource,
        }
      } catch (error) { await client.query('rollback'); throw error }
      finally { client.release() }
    },
    async revokeMcpToken(hash) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const family = await client.query(`select grant_id from mcp_oauth_tokens
            where access_hash=$1 or refresh_hash=$1
          union select grant_id from mcp_oauth_used_refresh_tokens where refresh_hash=$1`, [hash])
        if (family.rows[0]) {
          await client.query('select grant_id from mcp_oauth_grants where grant_id=$1 for update',
            [family.rows[0].grant_id])
          await client.query('update mcp_oauth_grants set revoked_at=now() where grant_id=$1',
            [family.rows[0].grant_id])
          await client.query('delete from mcp_oauth_tokens where grant_id=$1', [family.rows[0].grant_id])
        }
        await client.query('commit')
      } catch (error) { await client.query('rollback'); throw error }
      finally { client.release() }
    },

    async createTrip(user, input) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const base = (input.title || 'trip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'trip'
        const slug = `${base}-${randomBytes(3).toString('hex')}`
        const result = await client.query(`insert into trips(slug,title,crew,dates,day_count,starts_on,ends_on)
          values($1,$2,$3,$4,$5,$6,$7) returning *`, [
          slug, input.title, input.crew || null, input.dates || null, input.dayCount || 1,
          input.startsOn || null, input.endsOn || null,
        ])
        await client.query(`insert into trip_members(trip_id,user_id,role,display_name)
          values($1,$2,'owner',$3)`, [result.rows[0].id, user.id, user.email.split('@')[0]])
        await client.query('commit')
        return { ...camelTrip(result.rows[0]), ownerId: user.id }
      } catch (error) { await client.query('rollback'); throw error }
      finally { client.release() }
    },

    async listTrips(user) {
      const result = await pool.query(`select t.*,m.role from trips t
        join trip_members m on m.trip_id=t.id where m.user_id=$1 order by t.created_at`, [user.id])
      return result.rows.map(value => ({ ...camelTrip(value), role: value.role }))
    },

    async loadCurrentTrip(user, slug) {
      const values = [user.id]
      let where = 'm.user_id=$1'
      if (slug) { values.push(slug); where += ' and t.slug=$2' }
      const tripResult = await pool.query(`select t.* from trips t join trip_members m on m.trip_id=t.id
        where ${where} order by t.created_at limit 1`, values)
      if (!tripResult.rows[0]) return null
      const trip = tripResult.rows[0]
      const [members, stops, photos, route, comments, likes] = await Promise.all([
        pool.query(`select m.user_id,m.role,m.display_name,m.avatar_path,u.email from trip_members m
          join users u on u.id=m.user_id where m.trip_id=$1 order by m.joined_at`, [trip.id]),
        pool.query('select * from stops where trip_id=$1 order by seq,created_at', [trip.id]),
        pool.query('select * from photos where trip_id=$1 order by seq,created_at', [trip.id]),
        pool.query('select lng,lat from route_points where trip_id=$1 order by seq', [trip.id]),
        pool.query(`select c.*,coalesce(m.display_name,split_part(u.email,'@',1)) as author from comments c
          join users u on u.id=c.user_id left join trip_members m on m.trip_id=c.trip_id and m.user_id=c.user_id
          where c.trip_id=$1 order by c.created_at`, [trip.id]),
        pool.query('select photo_id from photo_likes where trip_id=$1 and user_id=$2', [trip.id, user.id]),
      ])
      const groupedComments = {}
      for (const comment of rows(comments)) {
        ;(groupedComments[comment.photo_id] ||= []).push({
          id: comment.id, by: comment.author, text: comment.body, userId: comment.user_id,
          when: new Date(comment.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        })
      }
      return {
        ...camelTrip(trip),
        members: rows(members).map(value => ({
          userId: value.user_id, email: value.email, role: value.role,
          displayName: value.display_name, avatarUrl: value.avatar_path,
        })),
        stops: rows(stops).map(value => ({
          id: value.id, name: value.name, kind: value.kind, icon: value.icon,
          day: value.day, time: value.time, lng: value.lng, lat: value.lat,
          status: value.status, note: value.note, seq: value.seq,
          src: value.image_url, sourceUrl: value.source_url,
        })),
        photos: rows(photos).map(value => ({
          id: value.id, stopId: value.stop_id, lng: value.lng, lat: value.lat,
          caption: value.caption, by: value.taken_by,
          when: value.taken_at?.toISOString?.() || value.taken_at,
          locationSource: value.location_source, storagePath: value.storage_path,
          thumbPath: value.thumb_path, seq: value.seq,
        })),
        route: rows(route).map(value => [value.lng, value.lat]),
        comments: groupedComments,
        likes: rows(likes).map(value => String(value.photo_id)),
      }
    },
    async updateTrip(user, tripId, changes) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const allowed = {
        title: 'title', crew: 'crew', dates: 'dates', dayCount: 'day_count',
        startsOn: 'starts_on', endsOn: 'ends_on',
      }
      const entries = Object.entries(changes).filter(([key]) => allowed[key])
      if (entries.length) {
        const set = entries.map(([key], index) => `${allowed[key]}=$${index + 2}`).join(',')
        await pool.query(`update trips set ${set} where id=$1`, [tripId, ...entries.map(([, value]) => value)])
      }
      const result = await pool.query('select * from trips where id=$1', [tripId])
      return result.rows[0] ? camelTrip(result.rows[0]) : null
    },
    async updateProfile(user, tripId, changes) {
      const previous = changes.avatarPath !== undefined
        ? await pool.query('select avatar_path from trip_members where trip_id=$1 and user_id=$2', [tripId, user.id])
        : null
      const entries = []
      if (changes.name !== undefined) entries.push(['display_name', changes.name])
      if (changes.avatarPath !== undefined) entries.push(['avatar_path', changes.avatarPath])
      if (entries.length) {
        const set = entries.map(([column], index) => `${column}=$${index + 3}`).join(',')
        await pool.query(`update trip_members set ${set} where trip_id=$1 and user_id=$2`,
          [tripId, user.id, ...entries.map(([, value]) => value)])
      }
      const result = await pool.query(`select m.*,u.email from trip_members m join users u on u.id=m.user_id
        where m.trip_id=$1 and m.user_id=$2`, [tripId, user.id])
      const value = result.rows[0]
      return value ? {
        userId: value.user_id, email: value.email, role: value.role,
        displayName: value.display_name, avatarUrl: value.avatar_path,
        oldAvatarUrl: previous?.rows[0]?.avatar_path || null,
      } : null
    },
    async canEditTrip(userId, tripId) {
      return ['owner', 'editor'].includes(await memberRole(pool, userId, tripId))
    },
    async canManageTrip(userId, tripId) { return await memberRole(pool, userId, tripId) === 'owner' },
    async canReadTrip(userId, tripId) { return !!await memberRole(pool, userId, tripId) },
    async createStop(user, tripId, input) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const result = await pool.query(`insert into stops
        (trip_id,name,kind,icon,day,time,lng,lat,status,note,image_url,source_url,seq)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`, [
        tripId, input.name, input.kind, input.icon, input.day, input.time,
        input.lng, input.lat, input.status, input.note, input.src, input.sourceUrl, input.seq,
      ])
      const value = result.rows[0]
      return {
        id: value.id, name: value.name, kind: value.kind, icon: value.icon,
        day: value.day, time: value.time, lng: value.lng, lat: value.lat,
        status: value.status, note: value.note, src: value.image_url,
        sourceUrl: value.source_url, seq: value.seq,
      }
    },
    async updateStop(user, tripId, stopId, changes) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const allowed = {
        name: 'name', kind: 'kind', icon: 'icon', day: 'day', time: 'time', lng: 'lng', lat: 'lat',
        status: 'status', note: 'note', src: 'image_url', sourceUrl: 'source_url', seq: 'seq',
      }
      const entries = Object.entries(changes).filter(([key]) => allowed[key])
      if (!entries.length) {
        const current = await pool.query('select * from stops where id=$1 and trip_id=$2', [stopId, tripId])
        return current.rows[0] || null
      }
      const values = [stopId, tripId, ...entries.map(([, value]) => value)]
      const set = entries.map(([key], index) => `${allowed[key]}=$${index + 3}`).join(',')
      const result = await pool.query(`update stops set ${set} where id=$1 and trip_id=$2 returning *`, values)
      const value = result.rows[0]
      return value ? {
        id: value.id, name: value.name, kind: value.kind, icon: value.icon,
        day: value.day, time: value.time, lng: value.lng, lat: value.lat,
        status: value.status, note: value.note, src: value.image_url,
        sourceUrl: value.source_url, seq: value.seq,
      } : null
    },
    async deleteStop(user, tripId, stopId) {
      if (!await this.canEditTrip(user.id, tripId)) return false
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query('update photos set stop_id=null where trip_id=$1 and stop_id=$2', [tripId, stopId])
        const result = await client.query('delete from stops where id=$1 and trip_id=$2', [stopId, tripId])
        await client.query('commit')
        return result.rowCount > 0
      } catch (error) { await client.query('rollback'); throw error }
      finally { client.release() }
    },
    async replaceRoute(user, tripId, points) {
      if (!await this.canEditTrip(user.id, tripId)) return false
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query('delete from route_points where trip_id=$1', [tripId])
        for (let index = 0; index < points.length; index++) {
          await client.query('insert into route_points(trip_id,lng,lat,seq) values($1,$2,$3,$4)',
            [tripId, points[index][0], points[index][1], index])
        }
        await client.query('commit')
        return true
      } catch (error) { await client.query('rollback'); throw error }
      finally { client.release() }
    },
    async upsertInvite(user, tripId, input) {
      if (!await this.canManageTrip(user.id, tripId)) return null
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await client.query(`insert into trip_invites(trip_id,email,name,role)
          values($1,$2,$3,$4) on conflict(trip_id,email) do update
          set name=excluded.name,role=excluded.role returning *`,
        [tripId, input.email, input.name, input.role])
        await client.query(`update trip_members m set role=$3 from users u
          where m.trip_id=$1 and m.user_id=u.id and u.email=$2 and m.role<>'owner'`,
        [tripId, input.email, input.role])
        await client.query('commit')
        const value = result.rows[0]
        return { id: value.id, email: value.email, name: value.name, role: value.role, claimedAt: value.claimed_at }
      } catch (error) { await client.query('rollback'); throw error }
      finally { client.release() }
    },
    async listInvites(user, tripId) {
      if (!await this.canManageTrip(user.id, tripId)) return null
      const result = await pool.query('select * from trip_invites where trip_id=$1 order by created_at', [tripId])
      return result.rows.map(value => ({
        id: value.id, email: value.email, name: value.name, role: value.role, claimedAt: value.claimed_at,
      }))
    },
    async revokeInvite(user, tripId, inviteId) {
      if (!await this.canManageTrip(user.id, tripId)) return false
      const client = await pool.connect()
      try {
        await client.query('begin')
        const invite = await client.query(`select email from trip_invites
          where id=$1 and trip_id=$2 for update`, [inviteId, tripId])
        if (!invite.rows[0]) { await client.query('rollback'); return false }
        await client.query(`delete from trip_members m using users u
          where m.trip_id=$1 and m.user_id=u.id and u.email=$2 and m.role<>'owner'`,
        [tripId, invite.rows[0].email])
        await client.query('delete from trip_invites where id=$1 and trip_id=$2', [inviteId, tripId])
        await client.query('commit')
        return true
      } catch (error) { await client.query('rollback'); throw error }
      finally { client.release() }
    },
    async removeMember(user, tripId, memberUserId) {
      if (!await this.canManageTrip(user.id, tripId)) return null
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await client.query(`select m.role,u.email from trip_members m join users u on u.id=m.user_id
          where m.trip_id=$1 and m.user_id=$2 for update`, [tripId, memberUserId])
        const member = result.rows[0]
        if (!member) { await client.query('rollback'); return null }
        if (member.role === 'owner') { await client.query('rollback'); return 'owner' }
        await client.query('delete from devices where trip_id=$1 and user_id=$2', [tripId, memberUserId])
        await client.query('delete from trip_invites where trip_id=$1 and email=$2', [tripId, member.email])
        await client.query('delete from trip_members where trip_id=$1 and user_id=$2', [tripId, memberUserId])
        await client.query('commit')
        return 'removed'
      } catch (error) { await client.query('rollback'); throw error }
      finally { client.release() }
    },
    async addComment(user, tripId, photoId, body) {
      if (!await this.canReadTrip(user.id, tripId)) return null
      const result = await pool.query(`insert into comments(trip_id,photo_id,user_id,body)
        select $1,p.id,$2,$3 from photos p where p.id=$4 and p.trip_id=$1 returning *`,
      [tripId, user.id, body, photoId])
      const value = result.rows[0]
      if (!value) return null
      const member = await pool.query(`select coalesce(display_name,split_part($3,'@',1)) name
        from trip_members where trip_id=$1 and user_id=$2`, [tripId, user.id, user.email])
      return {
        id: value.id, by: member.rows[0]?.name, text: value.body, userId: value.user_id,
        when: new Date(value.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
      }
    },
    async deleteComment(user, tripId, commentId) {
      const result = await pool.query(`delete from comments c where c.id=$1 and c.trip_id=$2
        and (c.user_id=$3 or exists(select 1 from trip_members m where m.trip_id=$2 and m.user_id=$3 and m.role in ('owner','editor')))`,
      [commentId, tripId, user.id])
      return result.rowCount > 0
    },
    async setLike(user, tripId, photoId, on) {
      if (!await this.canReadTrip(user.id, tripId)) return false
      if (on) {
        const result = await pool.query(`insert into photo_likes(trip_id,photo_id,user_id)
          select $1,p.id,$2 from photos p where p.id=$3 and p.trip_id=$1
          on conflict(photo_id,user_id) do nothing returning photo_id`, [tripId, user.id, photoId])
        if (result.rowCount) return true
        const exists = await pool.query('select 1 from photo_likes where photo_id=$1 and user_id=$2', [photoId, user.id])
        return exists.rowCount > 0
      }
      await pool.query('delete from photo_likes where trip_id=$1 and photo_id=$2 and user_id=$3', [tripId, photoId, user.id])
      return true
    },
    async createPhoto(user, tripId, input) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const member = await pool.query(`select coalesce(display_name,split_part($3,'@',1)) as name
        from trip_members where trip_id=$1 and user_id=$2`, [tripId, user.id, user.email])
      const result = await pool.query(`insert into photos
        (trip_id,stop_id,user_id,lng,lat,caption,taken_by,taken_at,location_source,storage_path,thumb_path,client_key,seq)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,(select count(*) from photos where trip_id=$1)) returning *`, [
        tripId, input.stopId, user.id, input.lng, input.lat, input.caption, member.rows[0]?.name,
        input.takenAt, input.locationSource, input.storagePath, input.thumbPath, input.clientKey || null,
      ])
      const value = result.rows[0]
      return {
        id: value.id, stopId: value.stop_id, lng: value.lng, lat: value.lat,
        caption: value.caption, by: value.taken_by,
        when: value.taken_at?.toISOString?.() || value.taken_at,
        locationSource: value.location_source, storagePath: value.storage_path,
        thumbPath: value.thumb_path, seq: value.seq,
      }
    },
    async findPhotoByClientKey(user, tripId, clientKey) {
      if (!clientKey || !await this.canEditTrip(user.id, tripId)) return null
      const result = await pool.query(`select * from photos where trip_id=$1 and user_id=$2 and client_key=$3`,
        [tripId, user.id, clientKey])
      const value = result.rows[0]
      return value ? {
        id: value.id, stopId: value.stop_id, lng: value.lng, lat: value.lat,
        caption: value.caption, by: value.taken_by,
        when: value.taken_at?.toISOString?.() || value.taken_at,
        locationSource: value.location_source, storagePath: value.storage_path,
        thumbPath: value.thumb_path, seq: value.seq,
      } : null
    },
    async updatePhoto(user, tripId, photoId, changes) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      if (changes.stopId != null) {
        const stop = await pool.query('select 1 from stops where id=$1 and trip_id=$2', [changes.stopId, tripId])
        if (!stop.rows[0]) return null
      }
      const entries = []
      if (changes.caption !== undefined) entries.push(['caption', changes.caption])
      if (changes.stopId !== undefined) entries.push(['stop_id', changes.stopId])
      if (entries.length) {
        const set = entries.map(([column], index) => `${column}=$${index + 3}`).join(',')
        await pool.query(`update photos set ${set} where id=$1 and trip_id=$2`,
          [photoId, tripId, ...entries.map(([, value]) => value)])
      }
      const result = await pool.query('select * from photos where id=$1 and trip_id=$2', [photoId, tripId])
      const value = result.rows[0]
      return value ? {
        id: value.id, stopId: value.stop_id, caption: value.caption,
        storagePath: value.storage_path, thumbPath: value.thumb_path,
      } : null
    },
    async deletePhoto(user, tripId, photoId) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await client.query(`delete from photos where id=$1 and trip_id=$2
          returning storage_path,thumb_path`, [photoId, tripId])
        const value = result.rows[0]
        if (!value) { await client.query('rollback'); return null }
        for (const path of [value.storage_path, value.thumb_path].filter(Boolean)) {
          await client.query(`insert into file_deletion_queue(path) values($1)
            on conflict(path) do update set next_attempt_at=now()`, [path])
        }
        await client.query('commit')
        return { storagePath: value.storage_path, thumbPath: value.thumb_path }
      } catch (error) { await client.query('rollback'); throw error }
      finally { client.release() }
    },
    async listPendingFileDeletions(now, limit = 50) {
      const result = await pool.query(`select path from file_deletion_queue
        where next_attempt_at <= $1 order by next_attempt_at limit $2`, [now, limit])
      return result.rows.map(value => value.path)
    },
    async completeFileDeletion(path) {
      await pool.query('delete from file_deletion_queue where path=$1', [path])
    },
    async failFileDeletion(path, error, now) {
      await pool.query(`update file_deletion_queue set attempts=attempts+1,last_error=$2,
        next_attempt_at=$3::timestamptz + make_interval(secs => least(3600, (power(2,least(attempts,6))*60)::int))
        where path=$1`, [path, String(error || 'File deletion failed').slice(0, 2000), now])
    },
    async registerDevice(user, tripId, input) {
      if (!await this.canEditTrip(user.id, tripId)) return null
      const result = await pool.query(`insert into devices(trip_id,user_id,name,slug,timezone,token_hash)
        values($1,$2,$3,$4,$5,$6) returning *`, [tripId, user.id, input.name, input.slug, input.timezone, input.tokenHash])
      const value = result.rows[0]
      return { ...value, tripId: value.trip_id, userId: value.user_id, lastSeen: value.last_seen, createdAt: value.created_at }
    },
    async listDevices(user, tripId) {
      if (!await this.canReadTrip(user.id, tripId)) return null
      const result = await pool.query('select * from devices where trip_id=$1 order by created_at', [tripId])
      return result.rows.map(value => ({
        id: value.id, tripId: value.trip_id, userId: value.user_id, name: value.name,
        slug: value.slug, lastSeen: value.last_seen, createdAt: value.created_at,
      }))
    },
    async removeDevice(user, tripId, deviceId) {
      if (!await this.canEditTrip(user.id, tripId)) return false
      return (await pool.query('delete from devices where id=$1 and trip_id=$2', [deviceId, tripId])).rowCount > 0
    },
    async findDeviceByTokenHash(hash) {
      const result = await pool.query('select * from devices where token_hash=$1', [hash])
      const value = result.rows[0]
      return value ? { ...value, tripId: value.trip_id, userId: value.user_id, lastSeen: value.last_seen } : null
    },
    async insertPosition(device, fix) {
      const result = await pool.query(`insert into positions
        (trip_id,device_id,lng,lat,accuracy,altitude,speed,heading,battery,recorded_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(device_id,recorded_at) do nothing returning id`, [
        device.tripId, device.id, fix.lng, fix.lat, fix.accuracy, fix.altitude,
        fix.speed, fix.heading, fix.battery, fix.at,
      ])
      if (result.rowCount) await pool.query(`update devices set last_seen=$2 where id=$1
        and (last_seen is null or last_seen<$2)`, [device.id, fix.at])
      return result.rowCount > 0
    },
    async findPositionNearCapture(user, tripId, capturedAt, toleranceMs) {
      const result = await pool.query(`select p.lng,p.lat,p.recorded_at
        from positions p join devices d on d.id=p.device_id
        where p.trip_id=$1 and d.user_id=$2
          and p.recorded_at between $3::timestamptz - ($4::bigint * interval '1 millisecond')
                                and $3::timestamptz + ($4::bigint * interval '1 millisecond')
        order by abs(extract(epoch from (p.recorded_at-$3::timestamptz))), p.accuracy nulls last
        limit 1`, [tripId, user.id, capturedAt, toleranceMs])
      const value = result.rows[0]
      return value ? { lng: value.lng, lat: value.lat, at: value.recorded_at } : null
    },
    async loadLive(user, tripId, since, { afterId = 0, maxPerDevice = 6000 } = {}) {
      if (!await this.canReadTrip(user.id, tripId)) return null
      const [devices, fixes, cursor] = await Promise.all([
        pool.query('select * from devices where trip_id=$1 order by created_at', [tripId]),
        pool.query(`with ranked as (
          select id,device_id,lng,lat,accuracy,speed,recorded_at,
            row_number() over(partition by device_id order by id desc) as device_rank
          from positions where trip_id=$1 and recorded_at >= $2 and id>$3
        ) select id,device_id,lng,lat,accuracy,speed,recorded_at from ranked
          where device_rank <= $4 order by id`, [tripId, since, afterId, maxPerDevice]),
        pool.query('select coalesce(max(id),$2::bigint) cursor from positions where trip_id=$1', [tripId, afterId]),
      ])
      return {
        devices: rows(devices).map(value => ({
          id: value.id, name: value.name, slug: value.slug, userId: value.user_id,
          lastSeen: value.last_seen, createdAt: value.created_at,
        })),
        fixes: rows(fixes).map(value => ({
          deviceId: value.device_id, lng: value.lng, lat: value.lat,
          accuracy: value.accuracy, speed: value.speed, at: value.recorded_at,
        })),
        cursor: Number(cursor.rows[0].cursor),
      }
    },
    async loadAttractions(bounds, { headlineOnly = false, limit = 1000 } = {}) {
      const result = await pool.query(`select id,name,descr,extract,category,image_file,lng,lat,headline
        from attractions where lat between $1 and $2 and lng between $3 and $4
        and ($5::boolean=false or headline=true) order by id limit $6`,
      [bounds.south, bounds.north, bounds.west, bounds.east, headlineOnly, limit])
      return result.rows.map(value => ({
        id: value.id, name: value.name, descr: value.descr, extract: value.extract,
        category: value.category, imageFile: value.image_file, lng: value.lng,
        lat: value.lat, headline: value.headline,
      }))
    },
    async deleteAccount(user) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const soleTrips = await client.query(`select m.trip_id from trip_members m where m.user_id=$1 and m.role='owner'
          and not exists(select 1 from trip_members other where other.trip_id=m.trip_id and other.role='owner' and other.user_id<>$1)`, [user.id])
        const tripIds = soleTrips.rows.map(value => value.trip_id)
        const files = await client.query(`
          select storage_path path from photos where user_id=$1 or trip_id=any($2::uuid[])
          union select thumb_path from photos where thumb_path is not null and (user_id=$1 or trip_id=any($2::uuid[]))
          union select avatar_path from trip_members where avatar_path is not null and (user_id=$1 or trip_id=any($2::uuid[]))`,
        [user.id, tripIds])
        for (const { path } of files.rows.filter(value => value.path)) {
          await client.query(`insert into file_deletion_queue(path) values($1)
            on conflict(path) do update set next_attempt_at=now()`, [path])
        }
        if (tripIds.length) await client.query('delete from trips where id=any($1::uuid[])', [tripIds])
        await client.query('delete from photos where user_id=$1', [user.id])
        await client.query('delete from trip_invites where email=$1', [user.email])
        await client.query('delete from users where id=$1', [user.id])
        await client.query('commit')
        return files.rows.map(value => value.path).filter(Boolean)
      } catch (error) { await client.query('rollback'); throw error }
      finally { client.release() }
    },
    async close() { await pool.end() },
  }
  return repository
}
