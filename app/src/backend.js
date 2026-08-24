import { createClient } from '@supabase/supabase-js'
import { STOPS, PHOTOS, ROUTE, FAMILY, TRIP, SEED_COMMENTS } from './data'

/* =========================================================================
   Backend

   One seam between the app and where a trip actually lives. Two implementations
   sit behind it: Supabase, and a local sample trip used when no credentials are
   configured — so `pnpm dev` works on a fresh clone with nothing set up, and the
   whole app can be exercised without a database.

   Access is invite-only: everybody signs in, and you see a trip only if an owner
   has invited your email address. The key below is meant to be public — it
   identifies the project, not the caller — and row level security grants the
   anonymous role nothing at all.

   Supabase calls it the publishable key now and called it the anon key before.
   Both names are read, so a project set up under either convention works.
   ========================================================================= */
const URL_ = import.meta.env.VITE_SUPABASE_URL
const KEY_ = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
             import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasBackend = Boolean(URL_ && KEY_)
export const supabase = hasBackend
  ? createClient(URL_, KEY_, { auth: { persistSession: true, autoRefreshToken: true } })
  : null

const TRAVELLING = new Set(['owner', 'editor'])
const asPerson = m => ({
  id: m.user_id,
  name: m.display_name || 'Someone',
  role: TRAVELLING.has(m.role) ? 'Travelling' : 'Following',
  memberRole: m.role,
  avatar: m.avatar_url || null,
})

/* ---- the sample trip -----------------------------------------------------
   A working copy of the bundled data, so every interaction behaves exactly as
   it will against Supabase (it just does not outlive a refresh). */
let sample = null
const sampleTrip = () => {
  if (!sample) {
    sample = {
      trip: { ...TRIP, id: 'sample' },
      stops: STOPS.map(s => ({ ...s })),
      photos: PHOTOS.map(p => ({ ...p })),
      route: ROUTE.map(p => [...p]),
      family: FAMILY.map(f => ({ ...f, memberRole: f.role === 'Travelling' ? 'editor' : 'viewer' })),
      comments: JSON.parse(JSON.stringify(SEED_COMMENTS)),
      likes: ['p8'],
      invites: [],
    }
  }
  return sample
}
const uid = () => 's' + Math.random().toString(36).slice(2, 10)

// Hand back copies, never the store's own arrays. Spreading the store shares the
// array with React state, and then a push inside createStop lands in state too —
// which the caller then appends to again, creating every stop twice.
const sampleResult = () => {
  const t = sampleTrip()
  return {
    trip: t.trip,
    stops: t.stops.map((x, i) => ({ ...x, seq: i })),
    photos: t.photos.map(x => ({ ...x })),
    route: t.route.map(x => [...x]),
    family: t.family.map(x => ({ ...x })),
    comments: Object.fromEntries(Object.entries(t.comments).map(([k, v]) => [k, v.map(c => ({ ...c }))])),
    likes: [...t.likes],
    source: 'sample', tripId: 'sample', canEdit: true,
    me: t.family[1] || t.family[0],
  }
}

/* ---- load ----------------------------------------------------------------
   Returns either a trip, or a reason there is not one to show. */
export async function loadTrip(session) {
  if (!hasBackend) return sampleResult()
  if (!session) return { needsAuth: true }

  // Turn any invitation addressed to this account into a membership first.
  /* Claim any invitations issued to this address before the account existed.

     Awaited inside a try rather than given a .catch: rpc() hands back a query
     builder, which is thenable but has no .catch, so the tidy-looking version
     throws a TypeError before the sign-in ever completes. Failing here should
     cost you the invite, not the whole trip. */
  try { await supabase.rpc('accept_invites') } catch { /* try again next load */ }

  const wanted = new URLSearchParams(window.location.search).get('t')
  let q = supabase
    .from('trips')
    .select(`id, slug, title, crew, dates, day_count,
             trip_members (user_id, role, display_name, avatar_url),
             stops (id, name, kind, icon, day, time, lng, lat, status, note, image_url, source_url, seq),
             photos (id, stop_id, lng, lat, caption, taken_by, taken_at, storage_path, external_url, seq),
             route_points (lng, lat, seq),
             comments (id, photo_id, user_id, body, created_at),
             photo_likes (photo_id, user_id)`)
    .order('seq', { referencedTable: 'stops' })
    .order('created_at', { referencedTable: 'stops' })
  if (wanted) q = q.eq('slug', wanted)

  const { data: rows, error } = await q.limit(1)
  if (error) throw error
  const t = rows && rows[0]
  if (!t) return { noTrip: true, email: session.user.email }

  const members = t.trip_members || []
  const mine = members.find(m => m.user_id === session.user.id)
  const family = members.map(asPerson)
  const nameOf = id => (members.find(m => m.user_id === id)?.display_name) || 'Someone'

  // Comments arrive flat and are grouped by photo, which is the shape the
  // viewer already renders.
  const comments = {}
  for (const c of (t.comments || []).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    ;(comments[c.photo_id] ||= []).push({
      id: c.id, by: nameOf(c.user_id), text: c.body, userId: c.user_id,
      when: new Date(c.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    })
  }

  const photos = await withPhotoUrls((t.photos || []).map(p => ({
    id: String(p.id), stopId: p.stop_id == null ? null : String(p.stop_id),
    lng: p.lng, lat: p.lat, caption: p.caption, by: p.taken_by, when: p.taken_at,
    storagePath: p.storage_path, src: p.external_url, seq: p.seq,
  })))

  return {
    source: 'supabase',
    tripId: t.id,
    trip: { id: t.id, slug: t.slug, title: t.title, crew: t.crew, dates: t.dates, dayCount: t.day_count },
    stops: (t.stops || []).map((s, i) => ({
      ...s, id: String(s.id), seq: i,
      // `src` is what the image component looks for, so a stop that came from a
      // place lookup shows its real photograph instead of a random placeholder.
      src: s.image_url || null, sourceUrl: s.source_url || null,
    })),
    photos,
    route: (t.route_points || []).sort((a, b) => a.seq - b.seq).map(r => [r.lng, r.lat]),
    family,
    comments,
    likes: (t.photo_likes || []).filter(l => l.user_id === session.user.id).map(l => String(l.photo_id)),
    canEdit: TRAVELLING.has(mine?.role),
    me: mine ? asPerson(mine) : { name: session.user.email, role: 'Following' },
  }
}

// The bucket is private, so files need signed URLs. One batched call rather
// than one per photo.
async function withPhotoUrls(photos) {
  const paths = photos.filter(p => !p.src && p.storagePath).map(p => p.storagePath)
  if (!paths.length) return photos
  const { data } = await supabase.storage.from('trip-photos').createSignedUrls(paths, 3600)
  const byPath = new Map((data || []).map(d => [d.path, d.signedUrl]))
  return photos.map(p => (p.src ? p : { ...p, src: byPath.get(p.storagePath) || null }))
}

/* ---- stops ---------------------------------------------------------------- */
const toRow = (tripId, s) => ({
  trip_id: tripId, name: s.name, kind: s.kind || null, icon: s.icon || 'pin',
  day: s.day || null, time: s.time || null, lng: s.lng, lat: s.lat,
  status: s.status || 'planned', note: s.note || null, seq: s.seq ?? 0,
  image_url: s.src || null, source_url: s.sourceUrl || null,
})
const fromRow = r => ({
  id: String(r.id), name: r.name, kind: r.kind, icon: r.icon, day: r.day,
  time: r.time, lng: r.lng, lat: r.lat, status: r.status, note: r.note, seq: r.seq,
  src: r.image_url || null, sourceUrl: r.source_url || null,
})
const isSample = tripId => tripId === 'sample' || !hasBackend

export async function createStop(tripId, fields) {
  if (isSample(tripId)) {
    const s = { id: uid(), icon: 'pin', status: 'planned', seq: sampleTrip().stops.length, ...fields }
    sampleTrip().stops.push(s)
    return s
  }
  const { data, error } = await supabase.from('stops').insert(toRow(tripId, fields)).select().single()
  if (error) throw error
  return fromRow(data)
}

export async function updateStop(tripId, id, fields) {
  if (isSample(tripId)) {
    const s = sampleTrip().stops.find(x => x.id === id)
    if (s) Object.assign(s, fields)
    return s
  }
  const patch = {}
  for (const [k, v] of Object.entries(fields)) {
    patch[{ src: 'image_url', sourceUrl: 'source_url' }[k] || k] = v
  }
  const { data, error } = await supabase.from('stops').update(patch).eq('id', id).select().single()
  if (error) throw error
  return fromRow(data)
}

export async function deleteStop(tripId, id) {
  if (isSample(tripId)) {
    const t = sampleTrip()
    t.stops = t.stops.filter(x => x.id !== id)
    t.photos = t.photos.map(p => (p.stopId === id ? { ...p, stopId: null } : p))
    return
  }
  const { error } = await supabase.from('stops').delete().eq('id', id)
  if (error) throw error
}

/* ---- comments and likes --------------------------------------------------- */
export async function addComment(tripId, photoId, body, session) {
  if (isSample(tripId)) {
    const c = { id: uid(), by: sampleResult().me.name, text: body, when: 'just now' }
    ;(sampleTrip().comments[photoId] ||= []).push(c)
    return c
  }
  const { data, error } = await supabase.from('comments')
    .insert({ trip_id: tripId, photo_id: photoId, user_id: session.user.id, body })
    .select().single()
  if (error) throw error
  return {
    id: data.id, text: data.body, userId: data.user_id,
    when: new Date(data.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
  }
}

export async function setLike(tripId, photoId, on, session) {
  if (isSample(tripId)) {
    const l = sampleTrip().likes
    const i = l.indexOf(photoId)
    if (on && i < 0) l.push(photoId)
    if (!on && i >= 0) l.splice(i, 1)
    return
  }
  if (on) {
    const { error } = await supabase.from('photo_likes')
      .upsert({ trip_id: tripId, photo_id: photoId, user_id: session.user.id })
    if (error) throw error
  } else {
    const { error } = await supabase.from('photo_likes')
      .delete().eq('photo_id', photoId).eq('user_id', session.user.id)
    if (error) throw error
  }
}

/* ---- the roster ----------------------------------------------------------- */
export async function listInvites(tripId) {
  if (isSample(tripId)) return sampleTrip().invites.map(i => ({ ...i }))
  const { data, error } = await supabase.from('trip_invites')
    .select('id, email, name, role, claimed_at').eq('trip_id', tripId).order('created_at')
  if (error) throw error
  return data || []
}

export async function invitePerson(tripId, { email, name, role = 'viewer' }) {
  if (isSample(tripId)) {
    const row = { id: uid(), email, name, role, claimed_at: null }
    sampleTrip().invites.push(row)
    return row
  }
  const { data, error } = await supabase.from('trip_invites')
    .upsert({ trip_id: tripId, email: email.trim().toLowerCase(), name: name || null, role },
            { onConflict: 'trip_id,email' })
    .select().single()
  if (error) throw error
  return data
}

export async function revokeInvite(tripId, id) {
  if (isSample(tripId)) {
    sampleTrip().invites = sampleTrip().invites.filter(i => i.id !== id)
    return
  }
  const { error } = await supabase.from('trip_invites').delete().eq('id', id)
  if (error) throw error
}

/* ---- photos ---------------------------------------------------------------
   A photo is a file in the bucket plus a row pointing at it. The row is written
   second and the file removed again if it fails, so neither half is ever left
   pointing at nothing. */
export async function uploadPhoto(tripId, file, meta) {
  if (isSample(tripId)) {
    const p = { id: uid(), src: URL.createObjectURL(file), seq: sampleTrip().photos.length, ...meta }
    sampleTrip().photos.push(p)
    return { ...p }
  }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = tripId + '/' + crypto.randomUUID() + '.' + ext
  const up = await supabase.storage.from('trip-photos')
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
  if (up.error) throw up.error

  const { data, error } = await supabase.from('photos').insert({
    trip_id: tripId, stop_id: meta.stopId || null, lng: meta.lng, lat: meta.lat,
    caption: meta.caption || null, taken_by: meta.by || null, taken_at: meta.when || null,
    storage_path: path, seq: meta.seq ?? 0,
  }).select().single()
  if (error) {
    await supabase.storage.from('trip-photos').remove([path])   // no orphan files
    throw error
  }
  const [withUrl] = await withPhotoUrls([{
    id: String(data.id), stopId: data.stop_id, lng: data.lng, lat: data.lat,
    caption: data.caption, by: data.taken_by, when: data.taken_at,
    storagePath: data.storage_path, src: null, seq: data.seq,
  }])
  return withUrl
}

export async function updatePhoto(tripId, id, fields) {
  if (isSample(tripId)) {
    const p = sampleTrip().photos.find(x => x.id === id)
    if (p) Object.assign(p, fields)
    return { ...p }
  }
  const patch = {}
  if ('caption' in fields) patch.caption = fields.caption
  if ('stopId' in fields) patch.stop_id = fields.stopId || null
  const { data, error } = await supabase.from('photos').update(patch).eq('id', id).select().single()
  if (error) throw error
  return { id: String(data.id), stopId: data.stop_id, caption: data.caption }
}

export async function deletePhoto(tripId, id) {
  if (isSample(tripId)) {
    sampleTrip().photos = sampleTrip().photos.filter(p => p.id !== id)
    return
  }
  const { data: row } = await supabase.from('photos').select('storage_path').eq('id', id).single()
  const { error } = await supabase.from('photos').delete().eq('id', id)
  if (error) throw error
  if (row && row.storage_path) await supabase.storage.from('trip-photos').remove([row.storage_path])
}

/* ---- the walked route -----------------------------------------------------
   Replaced wholesale rather than diffed: the line is short, and a partial update
   that half-applied would leave a route nobody walked. */
export async function replaceRoute(tripId, points) {
  if (isSample(tripId)) {
    sampleTrip().route = points.map(p => [...p])
    return
  }
  const del = await supabase.from('route_points').delete().eq('trip_id', tripId)
  if (del.error) throw del.error
  if (!points.length) return
  const { error } = await supabase.from('route_points').insert(
    points.map((p, i) => ({ trip_id: tripId, lng: p[0], lat: p[1], seq: i })))
  if (error) throw error
}

/* ---- the trip itself ------------------------------------------------------ */
export async function createTrip({ title, crew, dates, dayCount }) {
  if (!hasBackend) throw new Error('No backend configured')
  const base = (title || 'trip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const slug = base + '-' + Math.random().toString(36).slice(2, 6)
  /* Written and read back as two statements, deliberately.

     What makes a trip yours is a trip_members row, and that is created by an
     after-insert trigger. Asking for the new row in the same statement — the
     usual .insert().select() — is refused outright: the select policy calls
     is_trip_member, which is stable, so it reads the snapshot from the start of
     the statement and cannot see the ownership the trigger has just granted.
     The insert succeeds and the whole thing fails at the returning clause. */
  const { error } = await supabase.from('trips')
    .insert({ slug, title, crew: crew || null, dates: dates || null, day_count: dayCount || 1 })
  if (error) throw error

  const { data, error: readBack } = await supabase.from('trips')
    .select().eq('slug', slug).single()
  if (readBack) throw readBack
  return data
}

export async function updateTrip(tripId, fields) {
  if (isSample(tripId)) { Object.assign(sampleTrip().trip, fields); return { ...sampleTrip().trip } }
  const patch = {}
  if ('title' in fields) patch.title = fields.title
  if ('crew' in fields) patch.crew = fields.crew
  if ('dates' in fields) patch.dates = fields.dates
  if ('dayCount' in fields) patch.day_count = fields.dayCount
  const { data, error } = await supabase.from('trips').update(patch).eq('id', tripId).select().single()
  if (error) throw error
  return { id: data.id, slug: data.slug, title: data.title, crew: data.crew,
           dates: data.dates, dayCount: data.day_count }
}

/* ---- your own profile on this trip ---------------------------------------- */
export async function updateMe(tripId, userId, { name, avatarUrl }) {
  if (isSample(tripId)) {
    const me = sampleTrip().family[1] || sampleTrip().family[0]
    if (name !== undefined) me.name = name
    if (avatarUrl !== undefined) me.avatar = avatarUrl
    return { ...me }
  }
  const patch = {}
  if (name !== undefined) patch.display_name = name
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl
  const { data, error } = await supabase.from('trip_members').update(patch)
    .eq('trip_id', tripId).eq('user_id', userId).select().single()
  if (error) throw error
  return asPerson(data)
}

export async function uploadAvatar(tripId, userId, file) {
  if (isSample(tripId)) return URL.createObjectURL(file)
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = 'avatars/' + userId + '.' + ext
  const up = await supabase.storage.from('trip-photos')
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true })
  if (up.error) throw up.error
  const { data } = await supabase.storage.from('trip-photos')
    .createSignedUrl(path, 60 * 60 * 24 * 365)
  return (data && data.signedUrl) || null
}

export async function deleteComment(tripId, id) {
  if (isSample(tripId)) {
    const c = sampleTrip().comments
    for (const k of Object.keys(c)) c[k] = c[k].filter(x => x.id !== id)
    return
  }
  const { error } = await supabase.from('comments').delete().eq('id', id)
  if (error) throw error
}

/* ---- live updates ----------------------------------------------------------
   One channel for the whole trip. The callback is deliberately coarse — it says
   "something changed" and the app refetches — because reconciling six tables of
   partial payloads by hand is a lot of code to get subtly wrong, and a trip is
   small enough to reload cheaply. */
export function subscribeToTrip(tripId, onChange) {
  if (isSample(tripId) || !supabase) return () => {}
  const ch = supabase.channel('trip:' + tripId)
  const tables = ['stops', 'photos', 'route_points', 'comments', 'photo_likes', 'trip_members']
  for (const table of tables) {
    ch.on('postgres_changes',
      { event: '*', schema: 'public', table, filter: 'trip_id=eq.' + tripId },
      onChange)
  }
  ch.subscribe()
  return () => { supabase.removeChannel(ch) }
}

/* ---- auth ----------------------------------------------------------------- */
export async function sendMagicLink(email) {
  if (!hasBackend) throw new Error('No backend configured')
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    // shouldCreateUser stays on: an invited follower has no account yet, and
    // the same link both creates it and signs them in.
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  })
  if (error) throw error
}

export async function signOut() {
  if (hasBackend) await supabase.auth.signOut()
}

/* ---------------------------------------------------------------------------
   Attractions

   Seeded once into the database by scripts/seed-attractions.mjs, so a visitor
   gets the castles and museums in one indexed query rather than paying to
   rediscover them from Wikipedia on their own device. Returns null when there
   is no backend, which is the app's signal to go and look them up live.
   --------------------------------------------------------------------------- */
/* A thousand, because that is what PostgREST will return however much more you
   ask for: a limit of four thousand came back with exactly one thousand rows
   and no indication that anything had been left out. Ordered by page id so the
   thousand is always the same thousand — unordered, panning away and back
   reshuffles which pins exist — and low page ids skew towards the older, better
   known articles, which is the right end to keep. */
const MAX_PINS = 1000

export async function loadAttractions(box, { headlineOnly = false, limit = MAX_PINS } = {}) {
  if (!hasBackend) return null
  let q = supabase.from('attractions')
    .select('id,name,descr,category,image_file,lng,lat,extract')
    .gte('lat', box.south).lte('lat', box.north)
    .gte('lng', box.west).lte('lng', box.east)
    .order('id')
    .limit(Math.min(limit, MAX_PINS))
  if (headlineOnly) q = q.eq('headline', true)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data.map(r => ({
    id: r.id, n: r.name, d: r.descr || '', k: r.category,
    f: r.image_file, x: r.lng, y: r.lat, t: r.extract || '',
  }))
}
