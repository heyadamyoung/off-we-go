create table mcp_oauth_grants (
  grant_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  scopes text[] not null,
  resource text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table mcp_oauth_tokens add column grant_id uuid not null default gen_random_uuid();

insert into mcp_oauth_grants(grant_id,user_id,client_id,scopes,resource,created_at)
select grant_id,user_id,client_id,scopes,resource,created_at from mcp_oauth_tokens;

alter table mcp_oauth_tokens
  add constraint mcp_oauth_tokens_grant_fk foreign key(grant_id)
  references mcp_oauth_grants(grant_id) on delete cascade;

create index mcp_oauth_tokens_grant_idx on mcp_oauth_tokens(grant_id);

create table mcp_oauth_used_refresh_tokens (
  refresh_hash text primary key,
  grant_id uuid not null references mcp_oauth_grants(grant_id) on delete cascade,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  resource text not null,
  expires_at timestamptz not null,
  used_at timestamptz not null default now()
);

create index mcp_oauth_used_refresh_expiry_idx on mcp_oauth_used_refresh_tokens(expires_at);

create table file_deletion_queue (
  path text primary key,
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index file_deletion_queue_retry_idx on file_deletion_queue(next_attempt_at);
