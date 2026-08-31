create table profile_handle_reservations (
  reservation_hash text primary key,
  handle text not null unique check (
    length(handle) between 3 and 30
    and handle ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and handle not in (
      'admin','administrator','api','auth','help','mcp','off-we-go','offwego','owner',
      'privacy','root','safety','security','staff','support','system','trips'
    )
  ),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index profile_handle_reservations_expiry_idx on profile_handle_reservations(expires_at);

alter table profiles drop constraint if exists profiles_slug_check;
alter table profiles drop constraint if exists profiles_slug_key;
update profiles set slug='legacy-' || left(replace(id::text, '-', ''), 16);

do $$
declare
  profile record;
  base text;
  candidate text;
  suffix integer;
  ending text;
begin
  for profile in
    select p.id,p.display_name,u.email
    from profiles p join users u on u.id=p.id
    order by p.created_at,p.id
  loop
    base := trim(both '-' from regexp_replace(
      lower(coalesce(nullif(trim(profile.display_name), ''), split_part(profile.email, '@', 1))),
      '[^a-z0-9]+', '-', 'g'));
    if length(base) < 3 then base := 'traveller'; end if;
    if base in (
      'admin','administrator','api','auth','help','mcp','off-we-go','offwego','owner',
      'privacy','root','safety','security','staff','support','system','trips'
    ) then base := left(base, 25) || '-user'; end if;
    base := trim(trailing '-' from left(base, 30));
    candidate := base;
    suffix := 2;
    while exists(select 1 from profiles where slug=candidate and id<>profile.id) loop
      ending := '-' || suffix;
      candidate := trim(trailing '-' from left(base, 30 - length(ending))) || ending;
      suffix := suffix + 1;
    end loop;
    update profiles set slug=candidate,updated_at=now() where id=profile.id;
  end loop;
end $$;

alter table profiles add constraint profiles_slug_check check (
  length(slug) between 3 and 30 and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
);
alter table profiles add constraint profiles_slug_key unique(slug);
alter table profiles rename column slug to handle;
alter table profiles rename constraint profiles_slug_check to profiles_handle_check;
alter table profiles rename constraint profiles_slug_key to profiles_handle_key;

create table trip_slug_aliases (
  slug text primary key,
  trip_id uuid not null references trips(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index trip_slug_aliases_trip_idx on trip_slug_aliases(trip_id);

insert into trip_slug_aliases(slug,trip_id) select slug,id from trips;
alter table trips drop constraint if exists trips_slug_key;
update trips set slug='legacy-' || replace(id::text, '-', '');

do $$
declare
  trip record;
  base text;
  candidate text;
  suffix integer;
  ending text;
begin
  for trip in select id,title from trips order by created_at,id loop
    base := trim(both '-' from regexp_replace(lower(trip.title), '[^a-z0-9]+', '-', 'g'));
    if base = '' then base := 'trip'; end if;
    base := trim(trailing '-' from left(base, 72));
    candidate := base;
    suffix := 2;
    while exists(select 1 from trips where slug=candidate and id<>trip.id)
      or exists(select 1 from trip_slug_aliases where slug=candidate and trip_id<>trip.id)
    loop
      ending := '-' || suffix;
      candidate := trim(trailing '-' from left(base, 80 - length(ending))) || ending;
      suffix := suffix + 1;
    end loop;
    update trips set slug=candidate where id=trip.id;
  end loop;
end $$;

alter table trips add constraint trips_slug_check check (
  length(slug) between 1 and 80 and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
);
alter table trips add constraint trips_slug_key unique(slug);
