-- ===========================================================================
-- Wayfare — schema, row level security, invites.
--
-- Run this in your Supabase project: SQL Editor -> New query -> paste -> Run.
-- It is idempotent, and it also migrates an install of the earlier link-based
-- version (it drops the anonymous read path, which no longer exists).
--
-- The access model, in one sentence: everybody signs in, and you can only see a
-- trip you have been invited to by email.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists trips (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  title      text not null,
  crew       text,
  dates      text,
  day_count  int default 1,
  created_at timestamptz not null default now()
);

-- Membership doubles as the cast list: these are the people the app shows under
-- "Family", with owners and editors travelling and viewers following along.
create table if not exists trip_members (
  trip_id      uuid not null references trips (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'viewer' check (role in ('owner','editor','viewer')),
  display_name text,
  avatar_url   text,
  joined_at    timestamptz not null default now(),
  primary key (trip_id, user_id)
);

-- An invitation is by email address, issued before that person has an account.
-- It is claimed on their first sign-in by accept_invites() below.
create table if not exists trip_invites (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips (id) on delete cascade,
  email      text not null,
  name       text,
  role       text not null default 'viewer' check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
-- The client upserts on (trip_id, email), and Postgres will only match that
-- against a plain column index — an expression index on lower(email) makes the
-- upsert fail with "no unique or exclusion constraint matching the ON CONFLICT
-- specification". So the address is stored lower-cased, enforced by the check,
-- and the unique index is on the columns themselves.
drop index if exists trip_invites_unique;
update trip_invites set email = lower(email) where email <> lower(email);
alter table trip_invites drop constraint if exists trip_invites_email_lower;
alter table trip_invites add constraint trip_invites_email_lower check (email = lower(email));
create unique index if not exists trip_invites_email_unique on trip_invites (trip_id, email);

create table if not exists stops (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips (id) on delete cascade,
  name       text not null,
  kind       text,
  icon       text default 'pin',
  day        text,
  time       text,
  lng        double precision not null,
  lat        double precision not null,
  status     text default 'planned' check (status in ('done','now','next','planned')),
  note       text,
  -- A picture and the page it came from, when a stop was created from a place
  -- lookup. Kept as a url rather than copied into storage so the licence and
  -- attribution stay with the source.
  image_url  text,
  source_url text,
  seq        int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists photos (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips (id) on delete cascade,
  stop_id      uuid references stops (id) on delete set null,
  lng          double precision,
  lat          double precision,
  caption      text,
  taken_by     text,
  taken_at     text,
  storage_path text,
  external_url text,
  seq          int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists route_points (
  id      bigserial primary key,
  trip_id uuid not null references trips (id) on delete cascade,
  lng     double precision not null,
  lat     double precision not null,
  seq     int not null
);

-- Comments and likes belong to an account now that followers have one. trip_id
-- is carried on both so a policy can check membership without joining photos.
create table if not exists comments (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips (id) on delete cascade,
  photo_id   uuid not null references photos (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists photo_likes (
  trip_id    uuid not null references trips (id) on delete cascade,
  photo_id   uuid not null references photos (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);

create index if not exists stops_trip_idx        on stops (trip_id, seq);
create index if not exists photos_trip_idx       on photos (trip_id, seq);
create index if not exists route_points_trip_idx on route_points (trip_id, seq);
create index if not exists comments_photo_idx    on comments (photo_id, created_at);
create index if not exists likes_photo_idx       on photo_likes (photo_id);

-- Migration from the earlier link-based version -----------------------------
alter table stops        add column if not exists image_url  text;
alter table stops        add column if not exists source_url text;
alter table trip_members add column if not exists display_name text;
alter table trip_members add column if not exists avatar_url   text;
alter table trip_members add column if not exists joined_at    timestamptz not null default now();
alter table trips        drop column if exists share_token;
drop function if exists trip_by_token(text);
drop table if exists trip_people;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Deny by default, and there is no policy anywhere granting the anonymous role
-- anything. Every read requires a session and a membership row.
-- ---------------------------------------------------------------------------
alter table trips        enable row level security;
alter table trip_members enable row level security;
alter table trip_invites enable row level security;
alter table stops        enable row level security;
alter table photos       enable row level security;
alter table route_points enable row level security;
alter table comments     enable row level security;
alter table photo_likes  enable row level security;

-- Membership tests as security-definer functions: a policy on trip_members that
-- reads trip_members to decide access recurses forever otherwise.
create or replace function is_trip_member(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from trip_members m
                 where m.trip_id = p_trip and m.user_id = auth.uid());
$$;

create or replace function can_edit_trip(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from trip_members m
                 where m.trip_id = p_trip and m.user_id = auth.uid()
                   and m.role in ('owner','editor'));
$$;

-- Trip content: any member reads, only owners and editors write.
do $$
declare t text;
begin
  foreach t in array array['stops','photos','route_points'] loop
    execute format('drop policy if exists "members read %1$s"  on %1$s', t);
    execute format('drop policy if exists "editors write %1$s" on %1$s', t);
    execute format('create policy "members read %1$s" on %1$s for select to authenticated
                    using (is_trip_member(trip_id))', t);
    execute format('create policy "editors write %1$s" on %1$s for all to authenticated
                    using (can_edit_trip(trip_id)) with check (can_edit_trip(trip_id))', t);
  end loop;
end $$;

drop policy if exists "members read trips"  on trips;
drop policy if exists "editors write trips" on trips;
drop policy if exists "create trips"        on trips;
create policy "members read trips" on trips for select to authenticated
  using (is_trip_member(id));
create policy "editors write trips" on trips for update to authenticated
  using (can_edit_trip(id)) with check (can_edit_trip(id));
create policy "create trips" on trips for insert to authenticated with check (true);

-- Members can see who else is on the trip; only owners change the roster.
drop policy if exists "members read roster" on trip_members;
drop policy if exists "owners manage roster" on trip_members;
create policy "members read roster" on trip_members for select to authenticated
  using (is_trip_member(trip_id));
create policy "owners manage roster" on trip_members for all to authenticated
  using (can_edit_trip(trip_id)) with check (can_edit_trip(trip_id));

-- Invites are owner-only; an invitee never queries this table directly, they
-- claim through accept_invites() which runs as definer.
drop policy if exists "owners manage invites" on trip_invites;
create policy "owners manage invites" on trip_invites for all to authenticated
  using (can_edit_trip(trip_id)) with check (can_edit_trip(trip_id));

-- Comments: members read all, write their own, delete their own; editors may
-- delete anyone's, so an owner can clean up.
drop policy if exists "members read comments"   on comments;
drop policy if exists "members write comments"  on comments;
drop policy if exists "authors delete comments" on comments;
create policy "members read comments" on comments for select to authenticated
  using (is_trip_member(trip_id));
create policy "members write comments" on comments for insert to authenticated
  with check (is_trip_member(trip_id) and user_id = auth.uid());
create policy "authors delete comments" on comments for delete to authenticated
  using (user_id = auth.uid() or can_edit_trip(trip_id));

drop policy if exists "members read likes"  on photo_likes;
drop policy if exists "members own likes"   on photo_likes;
create policy "members read likes" on photo_likes for select to authenticated
  using (is_trip_member(trip_id));
create policy "members own likes" on photo_likes for all to authenticated
  using (user_id = auth.uid() and is_trip_member(trip_id))
  with check (user_id = auth.uid() and is_trip_member(trip_id));

-- ---------------------------------------------------------------------------
-- Creating and joining
-- ---------------------------------------------------------------------------
create or replace function claim_new_trip()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into trip_members (trip_id, user_id, role, display_name)
  values (new.id, auth.uid(), 'owner',
          split_part(coalesce(auth.jwt() ->> 'email', 'owner@'), '@', 1));
  return new;
end $$;

drop trigger if exists claim_new_trip_trg on trips;
create trigger claim_new_trip_trg after insert on trips
  for each row when (auth.uid() is not null) execute function claim_new_trip();

-- Called by the client right after sign-in. Turns every invitation addressed to
-- this account's email into a membership. Security definer because the invitee
-- cannot read trip_invites — matching on their own verified email is the whole
-- authorisation, so keep that WHERE clause exact.
create or replace function accept_invites()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  n int := 0;
begin
  if v_email is null then return 0; end if;

  insert into trip_members (trip_id, user_id, role, display_name)
  select i.trip_id, auth.uid(), i.role,
         coalesce(nullif(trim(i.name), ''), split_part(v_email, '@', 1))
  from trip_invites i
  where lower(i.email) = v_email
  on conflict (trip_id, user_id) do nothing;

  get diagnostics n = row_count;
  update trip_invites set claimed_at = now()
   where lower(email) = v_email and claimed_at is null;
  return n;
end $$;

revoke all on function accept_invites() from public;
grant execute on function accept_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- Photo storage. The bucket is private now that there are no anonymous
-- viewers; the client asks for short-lived signed URLs instead.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('trip-photos', 'trip-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "members read photos"   on storage.objects;
drop policy if exists "public read photos"    on storage.objects;
drop policy if exists "members upload photos" on storage.objects;
drop policy if exists "members change photos" on storage.objects;
drop policy if exists "members remove photos" on storage.objects;
create policy "members read photos" on storage.objects for select to authenticated
  using (bucket_id = 'trip-photos');
create policy "members upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-photos');
create policy "members change photos" on storage.objects for update to authenticated
  using (bucket_id = 'trip-photos') with check (bucket_id = 'trip-photos');
create policy "members remove photos" on storage.objects for delete to authenticated
  using (bucket_id = 'trip-photos');

-- ---------------------------------------------------------------------------
-- Realtime
--
-- Added here rather than left as a dashboard checkbox, so a fresh project has
-- live updates working the moment the schema is applied. Two people editing the
-- itinerary see each other's changes without refreshing.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stops','photos','route_points','comments','photo_likes','trip_members'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception
      when duplicate_object then null;   -- already published
      when undefined_object then null;   -- publication absent on self-hosted
    end;
  end loop;
end $$;

-- When the trip runs. `dates` was a free-text field nobody could fill in
-- confidently and the app never displayed; these are what the form now asks
-- for, and the day count and the printed range are both worked out from them.
alter table trips add column if not exists starts_on date;
alter table trips add column if not exists ends_on   date;

-- ---------------------------------------------------------------------------
-- Attractions
--
-- The castles, museums, lochs and monuments drawn under the itinerary. Shared
-- by every trip and every account, because they are facts about the world
-- rather than anything belonging to a family.
--
-- Seeded once by scripts/seed-attractions.mjs, which walks a region in
-- ten-kilometre cells and upserts what it finds. Doing it here rather than in
-- the browser means one person pays for the fetching, once, instead of every
-- visitor paying for it again on their own device.
-- ---------------------------------------------------------------------------
create table if not exists attractions (
  id          bigint primary key,              -- wikipedia pageid
  name        text not null,
  descr       text,
  category    text not null default 'place',
  image_file  text,
  lng         double precision not null,
  lat         double precision not null,
  headline    boolean not null default false,  -- worth a pin at country zoom
  updated_at  timestamptz not null default now()
);

-- Views are always a bounding box: latitude narrows it, longitude finishes it.
create index if not exists attractions_bbox on attractions (lat, lng);
-- The wide-zoom query asks only for the headline ones, so let it skip the rest.
create index if not exists attractions_headline_bbox on attractions (lat, lng)
  where headline;

-- The opening lines of the article, so a card opens without asking Wikipedia
-- anything. Filled by the seeder's second pass; empty string means "looked and
-- there was nothing", which is what stops it being looked for again.
alter table attractions add column if not exists extract text;

alter table attractions enable row level security;

-- Readable by anyone signed in. There is nothing private here, but the rest of
-- this schema grants the anonymous role nothing and this is no reason to start.
drop policy if exists attractions_read on attractions;
create policy attractions_read on attractions
  for select to authenticated using (true);

-- No insert, update or delete policy exists, so only the service_role key can
-- write - which is the seed script, run from a machine and never the browser.
