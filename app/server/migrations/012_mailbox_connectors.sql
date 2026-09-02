-- A mailbox somebody has connected. One row per mailbox rather than a column on
-- the user, so connecting a second one is a second row and nothing else changes.
create table mailbox_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null default 'outlook',
  account_id text not null,
  account_email text,
  account_name text,
  tenant text,
  scopes text[] not null default '{}'::text[],
  -- Sealed rather than hashed: a refresh token has to come back out again.
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Set when Microsoft stops accepting the refresh token, so the screen can say
  -- "sign in again" rather than failing quietly for ever.
  needs_reconnect boolean not null default false,
  unique (user_id, provider, account_id)
);
create index mailbox_connections_user_idx on mailbox_connections(user_id);

-- A connection attempt in flight: the verifier never leaves us, and the state
-- is stored hashed so a leaked row is not a usable callback.
create table mailbox_connection_requests (
  state_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  provider text not null default 'outlook',
  verifier text not null,
  redirect_to text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index mailbox_connection_requests_expiry_idx on mailbox_connection_requests(expires_at);
