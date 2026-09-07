/* Videos travel the same road as photographs: one row, one place on the map,
   the same day, the same comments and likes. What differs is the bytes — a
   video is stored as it arrived, and its poster frame is the picture every
   grid, marker and tray in the app already knows how to draw. */
alter table photos add column if not exists media_kind text not null default 'photo';
alter table photos add column if not exists media_mime text;
alter table photos add column if not exists poster_path text;
alter table photos add column if not exists duration_ms integer;

alter table photos drop constraint if exists photos_media_kind_valid;
alter table photos add constraint photos_media_kind_valid
  check (media_kind in ('photo','video'));

/* A negative or absurd duration is a decoder's guess, not a fact about the
   film: three hours is already far past anything a phone hands over. */
alter table photos drop constraint if exists photos_duration_sane;
alter table photos add constraint photos_duration_sane
  check (duration_ms is null or (duration_ms >= 0 and duration_ms <= 10800000));

/* A poster belongs to a video. Hanging one off a photograph would mean two
   answers to "which picture is this row", and the grids would disagree. */
alter table photos drop constraint if exists photos_poster_is_video;
alter table photos add constraint photos_poster_is_video
  check (poster_path is null or media_kind = 'video');
