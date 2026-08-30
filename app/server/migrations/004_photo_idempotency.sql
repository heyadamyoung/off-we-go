alter table photos add column if not exists client_key text;
create unique index if not exists photos_client_key_unique
  on photos(trip_id,user_id,client_key) where client_key is not null;
