create table mcp_oauth_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris text[] not null,
  client_uri text,
  logo_uri text,
  scopes text[] not null default array['trips:read']::text[],
  created_at timestamptz not null default now()
);

create table mcp_oauth_codes (
  code_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  scopes text[] not null,
  resource text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index mcp_oauth_codes_expiry_idx on mcp_oauth_codes(expires_at);

create table mcp_oauth_tokens (
  access_hash text primary key,
  refresh_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  scopes text[] not null,
  resource text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index mcp_oauth_tokens_access_expiry_idx on mcp_oauth_tokens(access_expires_at);
create index mcp_oauth_tokens_refresh_expiry_idx on mcp_oauth_tokens(refresh_expires_at);
