-- A profile gains the things the home globe and the settings page need: where
-- "home" is, which time zone to show local times against, and the notification
-- and privacy choices that used to have nowhere to live.
alter table profiles add column home_place text;
alter table profiles add column home_lat double precision;
alter table profiles add column home_lng double precision;
alter table profiles add column time_zone text;
alter table profiles add column preferences jsonb not null default '{}'::jsonb;

alter table profiles add constraint profiles_home_lat_range
  check (home_lat is null or (home_lat >= -90 and home_lat <= 90));
alter table profiles add constraint profiles_home_lng_range
  check (home_lng is null or (home_lng >= -180 and home_lng <= 180));
-- Either both halves of a coordinate or neither: half a position is not a place.
alter table profiles add constraint profiles_home_pair
  check ((home_lat is null) = (home_lng is null));
