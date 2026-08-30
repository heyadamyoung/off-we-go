create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table if not exists login_tokens (
  token_hash text primary key,
  email text not null check (email = lower(email)),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id);
create index if not exists sessions_expiry_idx on sessions(expires_at);

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  crew text,
  dates text,
  day_count integer not null default 1 check (day_count > 0),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now()
);

create table if not exists trip_members (
  trip_id uuid not null references trips(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  display_name text,
  avatar_path text,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  email text not null check (email = lower(email)),
  name text,
  role text not null default 'viewer' check (role in ('editor','viewer')),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trip_id, email)
);
create index if not exists trip_invites_email_idx on trip_invites(email);

create table if not exists stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null,
  kind text,
  icon text not null default 'pin',
  day text,
  time text,
  lng double precision not null,
  lat double precision not null,
  status text not null default 'planned' check (status in ('done','now','next','planned')),
  note text,
  image_url text,
  source_url text,
  seq integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists stops_trip_idx on stops(trip_id, seq, created_at);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  slug text not null,
  token_hash text not null unique,
  timezone text,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  unique (trip_id, slug)
);

create table if not exists positions (
  id bigserial primary key,
  trip_id uuid not null references trips(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  lng double precision not null,
  lat double precision not null,
  accuracy real,
  altitude real,
  speed real,
  heading real,
  battery real,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (device_id, recorded_at)
);
create index if not exists positions_trip_time_idx on positions(trip_id, recorded_at desc);
create index if not exists positions_device_time_idx on positions(device_id, recorded_at desc);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  stop_id uuid references stops(id) on delete set null,
  device_id uuid references devices(id) on delete set null,
  lng double precision,
  lat double precision,
  caption text,
  taken_by text,
  taken_at timestamptz,
  location_source text check (location_source in ('exif','trail','live','manual','approximate')),
  storage_path text not null unique,
  thumb_path text,
  seq integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists photos_trip_idx on photos(trip_id, seq, created_at);

create table if not exists route_points (
  id bigserial primary key,
  trip_id uuid not null references trips(id) on delete cascade,
  lng double precision not null,
  lat double precision not null,
  seq integer not null,
  unique (trip_id, seq)
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  photo_id uuid not null references photos(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists comments_photo_idx on comments(photo_id, created_at);

create table if not exists photo_likes (
  trip_id uuid not null references trips(id) on delete cascade,
  photo_id uuid not null references photos(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);

create table if not exists attractions (
  id bigint primary key,
  name text not null,
  descr text,
  extract text,
  category text,
  image_file text,
  lng double precision not null,
  lat double precision not null,
  headline boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists attractions_bounds_idx on attractions(lat, lng);

create or replace function wayfare_prune_positions(keep_for interval default interval '30 days')
returns bigint language plpgsql as $$
declare removed bigint;
begin
  delete from positions where recorded_at < now() - keep_for;
  get diagnostics removed = row_count;
  return removed;
end $$;
