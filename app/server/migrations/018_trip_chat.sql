-- The trip's own conversation: messages from anyone on the trip — viewers
-- included, a family chat has no spectators — and emoji reactions on them.
-- One row per person per emoji per message, so a reaction is a toggle and a
-- count is a group-by, never a mutable counter that drifts.
create table if not exists trip_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  body text not null check (length(trim(body)) > 0 and length(body) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists trip_messages_trip_idx on trip_messages(trip_id, created_at);

create table if not exists trip_message_reactions (
  message_id uuid not null references trip_messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
