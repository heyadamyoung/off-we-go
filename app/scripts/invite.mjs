#!/usr/bin/env node
/* ===========================================================================
   Put somebody on the trip and print a link that signs them in.

   The app's own invitation flow emails people, and email is the part that
   breaks: a free Supabase project sends a handful an hour through a shared
   sender, and a good deal of that lands in spam or nowhere at all. This does
   the same job without any of it — creates the account, adds them to the trip,
   and hands back a link to send however you actually talk to them.

     SUPABASE_URL=https://xxxx.supabase.co \
     SUPABASE_SECRET_KEY=sb_secret_... \
     node scripts/invite.mjs gran@example.com rob@example.com

   Roles: --role=viewer (default, can look and comment) or --role=editor (can
   change the itinerary). --list shows who is already on the trip. Re-running
   for somebody who is already a member just issues them a fresh link.

   The links are single use and last about an hour, so send them when the
   person is around to click. Run it again for another.
   =========================================================================== */
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const list = args.includes('--list')
const roleArg = args.find(a => a.startsWith('--role='))
const role = roleArg ? roleArg.slice(7) : 'viewer'
const site = (args.find(a => a.startsWith('--site=')) || '--site=https://wayfare.adam-5bf.workers.dev/').slice(7)
const emails = args.filter(a => !a.startsWith('--'))

if (!['viewer', 'editor', 'owner'].includes(role)) {
  console.error(`--role must be viewer, editor or owner (got "${role}")`)
  process.exit(1)
}

const URL_ = process.env.SUPABASE_URL
const KEY_ = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE
if (!URL_ || !KEY_) { console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY.'); process.exit(1) }
const db = createClient(URL_, KEY_, { auth: { persistSession: false } })

const { data: trip, error: tripErr } = await db.from('trips').select('id,title,crew').limit(1).single()
if (tripErr) { console.error('No trip found:', tripErr.message); process.exit(1) }

const { data: accounts } = await db.auth.admin.listUsers()
const findAccount = email => accounts.users.find(u => u.email?.toLowerCase() === email.toLowerCase())

if (list || !emails.length) {
  const { data: members } = await db.from('trip_members')
    .select('user_id,role,display_name').eq('trip_id', trip.id)
  console.log(`${trip.title} — ${members.length} on the trip`)
  for (const m of members) {
    const who = accounts.users.find(u => u.id === m.user_id)
    console.log(`  ${m.role.padEnd(7)} ${(who?.email || 'unknown').padEnd(34)}` +
                ` last seen ${who?.last_sign_in_at?.slice(0, 10) || 'never'}`)
  }
  if (!emails.length && !list) console.log('\nPass one or more email addresses to invite somebody.')
  process.exit(0)
}

for (const email of emails) {
  let account = findAccount(email)
  if (!account) {
    // Confirmed on creation: the link below is the proof of address, and making
    // them confirm by email first would reintroduce the very thing being avoided.
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true })
    if (error) { console.error(`  ${email}: could not create — ${error.message}`); continue }
    account = data.user
  }

  const { error: memberErr } = await db.from('trip_members').upsert({
    trip_id: trip.id, user_id: account.id, role,
    display_name: email.split('@')[0],
  }, { onConflict: 'trip_id,user_id' })
  if (memberErr) { console.error(`  ${email}: could not add to the trip — ${memberErr.message}`); continue }

  const { data: link, error: linkErr } = await db.auth.admin.generateLink({
    type: 'magiclink', email, options: { redirectTo: site },
  })
  if (linkErr) { console.error(`  ${email}: could not make a link — ${linkErr.message}`); continue }

  console.log('')
  console.log(`${email}  (${role})`)
  console.log(link.properties.action_link)
}

console.log('')
console.log('Single use, good for about an hour. Run it again for a fresh one.')
