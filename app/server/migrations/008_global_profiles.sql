create table profiles (
  id uuid primary key references users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into profiles(id,slug,display_name,avatar_path,created_at,updated_at)
select
  u.id,
  coalesce(nullif(btrim(regexp_replace(lower(split_part(u.email,'@',1)), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'traveller')
    || '-' || left(replace(u.id::text, '-', ''), 16),
  coalesce(existing.display_name, split_part(u.email,'@',1)),
  existing.avatar_path,
  u.created_at,
  now()
from users u
left join lateral (
  select
    nullif(trim(m.display_name), '') display_name,
    m.avatar_path
  from trip_members m
  where m.user_id=u.id
  order by (m.avatar_path is not null) desc, m.joined_at desc
  limit 1
) existing on true;

alter table trip_members add column profile_id uuid;
update trip_members set profile_id=user_id;
alter table trip_members alter column profile_id set not null;
alter table trip_members add constraint trip_members_profile_id_fkey
  foreign key (profile_id) references profiles(id) on delete cascade;

insert into file_deletion_queue(path)
select distinct m.avatar_path
from trip_members m
where m.avatar_path is not null
  and not exists (select 1 from profiles p where p.avatar_path=m.avatar_path)
on conflict(path) do nothing;

alter table trip_members drop constraint trip_members_pkey;
alter table trip_members drop constraint if exists trip_members_user_id_fkey;
alter table trip_members drop column user_id;
alter table trip_members drop column display_name;
alter table trip_members drop column avatar_path;
alter table trip_members add primary key (trip_id,profile_id);
