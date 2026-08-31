create table if not exists oidc_login_attempts (
  state_hash text primary key,
  code_verifier text not null,
  nonce text not null,
  client_kind text not null check (client_kind in ('web','native')),
  binding_hash text not null,
  continuation text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists oidc_login_attempts_expiry_idx on oidc_login_attempts(expires_at);

create table if not exists oidc_identities (
  issuer text not null,
  subject text not null,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issuer, subject)
);
create index if not exists oidc_identities_user_idx on oidc_identities(user_id);

create table if not exists login_handoffs (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  client_kind text not null check (client_kind in ('web','native')),
  binding_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists login_handoffs_expiry_idx on login_handoffs(expires_at);
