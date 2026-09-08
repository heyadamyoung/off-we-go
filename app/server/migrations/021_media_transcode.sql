/* A film off a phone is not a film every phone can play: an iPhone records
   HEVC inside a .mov, which Chrome and Android decline to decode, so half a
   trip could not watch what the other half filmed. Converting is minutes of
   CPU, which is nobody's upload to wait through — so the bytes land, the row
   appears, and the work happens behind it. */
alter table photos add column if not exists media_status text not null default 'ready';

alter table photos drop constraint if exists photos_media_status_valid;
alter table photos add constraint photos_media_status_valid
  check (media_status in ('ready', 'pending', 'working', 'failed'));

/* Only a film is ever anything but ready; a photograph is finished the moment
   it is resized. */
alter table photos drop constraint if exists photos_status_is_video;
alter table photos add constraint photos_status_is_video
  check (media_status = 'ready' or media_kind = 'video');

/* The queue. A table rather than a broker on purpose: it is transactional
   with the row it describes, it survives a restart, and `for update skip
   locked` lets any number of workers drain it without talking to each other —
   so moving this off the web box later is a deployment change, not a rewrite.
*/
create table if not exists media_jobs (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  kind text not null default 'transcode',
  state text not null default 'pending' check (state in ('pending', 'working', 'done', 'failed')),
  attempts integer not null default 0,
  last_error text,
  /* Which worker holds it, and until when. A worker that dies mid-convert
     stops renewing, and the job returns to the queue rather than being lost
     to a process that no longer exists. */
  claimed_by text,
  claimed_until timestamptz,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* One job per photograph per kind: an upload retried by a phone on a bad line
   must not queue the same conversion twice. */
create unique index if not exists media_jobs_photo_kind_unique on media_jobs(photo_id, kind);

/* The claim query's index: pending or expired work, oldest first. */
create index if not exists media_jobs_claimable_idx
  on media_jobs(state, run_after) where state in ('pending', 'working');
