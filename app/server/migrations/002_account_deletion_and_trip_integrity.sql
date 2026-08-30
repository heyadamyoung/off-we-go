alter table photos add column if not exists user_id uuid references users(id) on delete set null;
create index if not exists photos_user_idx on photos(user_id);

alter table stops drop constraint if exists stops_trip_id_id_key;
alter table stops add constraint stops_trip_id_id_key unique (trip_id, id);
alter table photos drop constraint if exists photos_stop_id_fkey;
alter table photos drop constraint if exists photos_stop_trip_fkey;
alter table photos add constraint photos_stop_trip_fkey
  foreign key (trip_id, stop_id) references stops(trip_id, id);
