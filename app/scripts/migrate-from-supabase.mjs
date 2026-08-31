import pg from 'pg'
import sharp from 'sharp'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { legacyDate, legacyInviteRole, legacyPhotoRequest } from './legacyMigrationCore.mjs'
import { availableSlug, normalizeProfileHandle, slugBase } from '../server/src/slugs.js'

const required = name => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const sourceUrl = required('LEGACY_DATABASE_URL')
const targetUrl = required('DATABASE_URL')
const uploadRoot = resolve(process.env.UPLOAD_DIR || 'data/uploads')
const projectUrl = String(process.env.LEGACY_SUPABASE_URL || '').replace(/\/$/, '')
const serviceKey = process.env.LEGACY_SUPABASE_SERVICE_ROLE_KEY || ''
const dryRun = process.env.DRY_RUN === 'true'
const skipMissing = process.env.SKIP_MISSING_MEDIA === 'true'
const manifestPath = resolve(process.env.MIGRATION_MANIFEST || 'legacy-migration-manifest.json')

const source = new pg.Client({ connectionString: sourceUrl })
const target = new pg.Client({ connectionString: targetUrl })
const rows = async sql => (await source.query(sql)).rows
const checksum = bytes => createHash('sha256').update(bytes).digest('hex')
const manifest = { createdAt: new Date().toISOString(), source: 'legacy-supabase', files: [], skipped: [], counts: {} }

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, bytes, { flag: 'wx' })
  await rename(temporary, path)
}

async function downloadLegacy(row) {
  if (row.external_url) {
    const response = await fetch(row.external_url)
    if (!response.ok) throw new Error(`external image returned ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
  if (!row.storage_path) throw new Error('photo has neither external_url nor storage_path')
  if (!projectUrl || !serviceKey) {
    throw new Error('LEGACY_SUPABASE_URL and LEGACY_SUPABASE_SERVICE_ROLE_KEY are required for private photos')
  }
  const request = legacyPhotoRequest({ storagePath: row.storage_path, projectUrl, serviceKey })
  const response = await fetch(request.url, { headers: request.headers })
  if (!response.ok) throw new Error(`private image returned ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function convertPhoto(row) {
  const bytes = await downloadLegacy(row)
  const image = sharp(bytes, { failOn: 'warning' }).rotate()
  const display = await image.clone().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true }).toBuffer()
  const thumb = await image.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 76, mozjpeg: true }).toBuffer()
  const storagePath = `${row.trip_id}/${row.id}.jpg`
  const thumbPath = `${row.trip_id}/${row.id}.thumb.jpg`
  if (!dryRun) {
    await writeAtomic(join(uploadRoot, storagePath), display)
    await writeAtomic(join(uploadRoot, thumbPath), thumb)
  }
  manifest.files.push({ legacyPath: row.storage_path || row.external_url, storagePath, bytes: display.length, sha256: checksum(display) })
  manifest.files.push({ legacyPath: row.storage_path || row.external_url, storagePath: thumbPath, bytes: thumb.length, sha256: checksum(thumb) })
  return { storagePath, thumbPath }
}

await source.connect()
await target.connect()
try {
  const data = {
    users: await rows('select id,email,created_at from auth.users where email is not null order by created_at'),
    trips: await rows('select * from public.trips order by created_at'),
    members: await rows('select * from public.trip_members order by joined_at'),
    invites: await rows('select * from public.trip_invites order by created_at'),
    stops: await rows('select * from public.stops order by trip_id,seq,created_at'),
    photos: await rows('select * from public.photos order by trip_id,seq,created_at'),
    route: await rows('select * from public.route_points order by trip_id,seq'),
    comments: await rows('select * from public.comments order by created_at'),
    likes: await rows('select * from public.photo_likes order by created_at'),
  }
  manifest.counts.source = Object.fromEntries(Object.entries(data).map(([name, values]) => [name, values.length]))
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, counts: manifest.counts.source }, null, 2))
    process.exitCode = 0
  } else {
    const knownUsers = new Set(data.users.map(value => value.id))
    const knownTrips = new Set(data.trips.map(value => value.id))
    const owners = new Map(data.members.filter(value => value.role === 'owner').map(value => [value.trip_id, value.user_id]))
    const profileNames = new Map()
    for (const member of data.members) {
      if (member.display_name?.trim()) profileNames.set(member.user_id, member.display_name.trim())
    }
    const importedPhotos = []
    const usedHandles = new Set()
    const legacyTripSlugs = new Set(data.trips.map(value => value.slug).filter(Boolean))
    const usedTripSlugs = new Set(legacyTripSlugs)
    for (const photo of data.photos) {
      try { importedPhotos.push({ ...photo, ...await convertPhoto(photo) }) }
      catch (error) {
        const skipped = { id: photo.id, source: photo.storage_path || photo.external_url || null, error: error.message }
        manifest.skipped.push(skipped)
        if (!skipMissing) throw new Error(`Cannot migrate photo ${photo.id}: ${error.message}`)
      }
    }
    const photoIds = new Set(importedPhotos.map(value => value.id))

    await target.query('begin')
    try {
      for (const value of data.users) {
        await target.query(`insert into users(id,email,created_at) values($1,lower($2),$3)
          on conflict(id) do update set email=excluded.email`, [value.id, value.email, value.created_at])
        const rawBase = slugBase(profileNames.get(value.id) || value.email.split('@')[0], 'traveller', 30)
        const base = normalizeProfileHandle(rawBase) || `${rawBase.slice(0, 25) || 'traveller'}-user`
        const handle = await availableSlug(base, candidate => usedHandles.has(candidate), {
          fallback: 'traveller', maxLength: 30,
        })
        usedHandles.add(handle)
        await target.query(`insert into profiles(id,handle,display_name,created_at,updated_at)
          values($1,$2,$3,$4,now()) on conflict(id) do update set display_name=excluded.display_name,updated_at=now()`,
        [value.id, handle, profileNames.get(value.id) || value.email.split('@')[0], value.created_at])
      }
      for (const value of data.trips) {
        const slug = await availableSlug(value.title, candidate => usedTripSlugs.has(candidate))
        usedTripSlugs.add(slug)
        await target.query(`insert into trips(id,slug,title,crew,dates,day_count,created_at)
          values($1,$2,$3,$4,$5,$6,$7) on conflict(id) do update set
          slug=excluded.slug,title=excluded.title,crew=excluded.crew,dates=excluded.dates,day_count=excluded.day_count`,
        [value.id, slug, value.title, value.crew, value.dates, value.day_count || 1, value.created_at])
        if (value.slug && value.slug !== slug) {
          await target.query(`insert into trip_slug_aliases(slug,trip_id) values($1,$2)
            on conflict(slug) do nothing`, [value.slug, value.id])
        }
      }
      for (const value of data.members.filter(value => knownUsers.has(value.user_id) && knownTrips.has(value.trip_id))) {
        await target.query(`insert into trip_members(trip_id,profile_id,role,joined_at)
          values($1,$2,$3,$4) on conflict(trip_id,profile_id) do update set role=excluded.role`,
        [value.trip_id, value.user_id, value.role, value.joined_at])
      }
      for (const value of data.invites.filter(value => knownTrips.has(value.trip_id))) {
        await target.query(`insert into trip_invites(id,trip_id,email,name,role,claimed_at,created_at)
          values($1,$2,lower($3),$4,$5,$6,$7) on conflict(trip_id,email) do update set
          name=excluded.name,role=excluded.role,claimed_at=excluded.claimed_at`,
        [value.id, value.trip_id, value.email, value.name, legacyInviteRole(value.role), value.claimed_at, value.created_at])
      }
      for (const value of data.stops.filter(value => knownTrips.has(value.trip_id))) {
        await target.query(`insert into stops(id,trip_id,name,kind,icon,day,time,lng,lat,status,note,image_url,source_url,seq,created_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          on conflict(id) do update set name=excluded.name,kind=excluded.kind,icon=excluded.icon,day=excluded.day,
          time=excluded.time,lng=excluded.lng,lat=excluded.lat,status=excluded.status,note=excluded.note,
          image_url=excluded.image_url,source_url=excluded.source_url,seq=excluded.seq`,
        [value.id, value.trip_id, value.name, value.kind, value.icon || 'pin', value.day, value.time,
          value.lng, value.lat, value.status || 'planned', value.note, value.image_url, value.source_url,
          value.seq || 0, value.created_at])
      }
      for (const value of importedPhotos) {
        await target.query(`insert into photos(id,trip_id,stop_id,user_id,lng,lat,caption,taken_by,taken_at,location_source,storage_path,thumb_path,seq,created_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          on conflict(id) do update set stop_id=excluded.stop_id,lng=excluded.lng,lat=excluded.lat,
          caption=excluded.caption,taken_by=excluded.taken_by,taken_at=excluded.taken_at,
          location_source=excluded.location_source,storage_path=excluded.storage_path,thumb_path=excluded.thumb_path,seq=excluded.seq`,
        [value.id, value.trip_id, value.stop_id, owners.get(value.trip_id) || null, value.lng, value.lat,
          value.caption, value.taken_by, legacyDate(value.taken_at), value.lng != null && value.lat != null ? 'manual' : null,
          value.storagePath, value.thumbPath, value.seq || 0, value.created_at])
      }
      for (const value of data.route.filter(value => knownTrips.has(value.trip_id))) {
        await target.query(`insert into route_points(trip_id,lng,lat,seq) values($1,$2,$3,$4)
          on conflict(trip_id,seq) do update set lng=excluded.lng,lat=excluded.lat`,
        [value.trip_id, value.lng, value.lat, value.seq])
      }
      for (const value of data.comments.filter(value => photoIds.has(value.photo_id) && knownUsers.has(value.user_id))) {
        await target.query(`insert into comments(id,trip_id,photo_id,user_id,body,created_at)
          values($1,$2,$3,$4,$5,$6) on conflict(id) do update set body=excluded.body`,
        [value.id, value.trip_id, value.photo_id, value.user_id, value.body, value.created_at])
      }
      for (const value of data.likes.filter(value => photoIds.has(value.photo_id) && knownUsers.has(value.user_id))) {
        await target.query(`insert into photo_likes(trip_id,photo_id,user_id,created_at) values($1,$2,$3,$4)
          on conflict(photo_id,user_id) do nothing`, [value.trip_id, value.photo_id, value.user_id, value.created_at])
      }
      await target.query('commit')
    } catch (error) { await target.query('rollback'); throw error }

    const targetCounts = {}
    for (const table of ['users','profiles','trips','trip_members','trip_invites','stops','photos','route_points','comments','photo_likes']) {
      targetCounts[table] = Number((await target.query(`select count(*) count from ${table}`)).rows[0].count)
    }
    manifest.counts.target = targetCounts
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'w' })
    console.log(JSON.stringify({ migrated: manifest.counts, files: manifest.files.length, skipped: manifest.skipped.length, manifestPath }, null, 2))
  }
} finally {
  await Promise.allSettled([source.end(), target.end()])
}
