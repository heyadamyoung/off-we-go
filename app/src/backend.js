import { createClient } from '@supabase/supabase-js'
import { STOPS, PHOTOS, ROUTE, FAMILY, TRIP, SEED_COMMENTS } from './data'

/* =========================================================================
   Backend

   One seam between the app and where a trip actually lives. Two implementations
   sit behind it: Supabase, and a local sample trip used when no credentials are
   configured — so `pnpm dev` works on a fresh clone with nothing set up, and the
   whole app can be exercised without a database.

   Access is invite-only: everybody signs in, and you see a trip only if an owner
   has invited your email address. The anon key below is meant to be public — it
   identifies the project, not the caller — and row level security grants the
   anonymous role nothing at all.
   ========================================================================= */
const URL_ = import.meta.env.VITE_SUPABASE_URL
const KEY_ = import.meta.env.VITE_SUPABASE_ANON_KEY

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
    stops: t.stops.map(x => ({ ...x })),
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
  await supabase.rpc('accept_invites').catch(() => {})

  const wanted = new URLSearchParams(window.location.search).get('t')
  let q = supabase
    .from('trips')
    .select(`id, slug, title, crew, dates, day_count,
             trip_members (user_id, role, display_name, avatar_url),
             stops (id, name, kind, icon, day, time, lng, lat, status, note, seq),
             photos (id, stop_id, lng, lat, caption, taken_by, taken_at, storage_path, external_url, seq),
             route_points (lng, lat, seq),
             comments (id, photo_id, user_id, body, created_at),
             photo_likes (photo_id, user_id)`)
    .order('seq', { referencedTable: 'stops' })
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
    stops: (t.stops || []).map(s => ({ ...s, id: String(s.id) })),
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
})
const fromRow = r => ({
  id: String(r.id), name: r.name, kind: r.kind, icon: r.icon, day: r.day,
  time: r.time, lng: r.lng, lat: r.lat, status: r.status, note: r.note, seq: r.seq,
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
  const { data, error } = await supabase.from('stops').update(fields).eq('id', id).select().single()
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
