/* Web push: the travel day on the lock screen of a phone that is not
   running the app, without an Apple key or a Firebase project. The server
   signs its pushes with a key pair it makes for itself at first boot, a
   browser hands over the address the push service gave it, and from then
   on each phone is told one card per leg — replaced in place, a sound only
   for the moments worth one — and what became of each card is written
   down so a kind of push nobody opens can be made quiet. */

create table if not exists push_keys (
  id integer primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_profile_idx on push_subscriptions(profile_id);

/* A leg somebody asked to hear no more about, from the card itself. */
create table if not exists push_mutes (
  subscription_id uuid not null references push_subscriptions(id) on delete cascade,
  segment_id uuid not null references segments(id) on delete cascade,
  muted_at timestamptz not null default now(),
  primary key (subscription_id, segment_id)
);

/* What each phone was last told about each leg, and how many times it has
   been woken for it: the next card is compared with this, not with the
   board, so a gate that went A, B, A while nobody was told is nothing. */
create table if not exists push_cards (
  subscription_id uuid not null references push_subscriptions(id) on delete cascade,
  segment_id uuid not null references segments(id) on delete cascade,
  said jsonb not null,
  woken integer not null default 0,
  sent_at timestamptz not null default now(),
  primary key (subscription_id, segment_id)
);

/* Every push, and what became of it. */
create table if not exists push_sends (
  id uuid primary key,
  subscription_id uuid not null references push_subscriptions(id) on delete cascade,
  segment_id uuid references segments(id) on delete set null,
  kind text not null,
  audible boolean not null,
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  dismissed_at timestamptz
);
create index if not exists push_sends_subscription_idx on push_sends(subscription_id, sent_at desc);
