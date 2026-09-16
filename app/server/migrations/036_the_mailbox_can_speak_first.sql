/* Letting a connected mailbox speak before it is spoken to.

   The connector has been able to read a mailbox since migration 012, and the
   assistant has known what to do with an airline email since the travel legs
   existed — but only when somebody thought to ask it. So a delay reached the
   trip at the moment the traveller already suspected there was one, which is
   the moment they least needed telling.

   Two decisions are written into this file rather than into code, because they
   are the ones that must not be quietly changed later.

   The first is that it is OFF. Reading somebody's mail on a timer is a serious
   thing to do to them, and this app has already deleted one feature for doing
   something nobody asked for. A mailbox watches a trip's legs because its owner
   said so, one mailbox at a time, and the column defaults to false so no
   existing connection starts watching because a migration ran. */

alter table mailbox_connections add column if not exists watch_travel boolean not null default false;

/* When it last looked. A job that re-reports the same email every few minutes
   is a job somebody turns off, and without a watermark there is nothing to
   compare an arrival against. */
alter table mailbox_connections add column if not exists travel_seen_at timestamptz;

/* The second decision: what is kept is what a person needs in order to decide
   whether to open an email — who it is from, what it says on the outside, and
   when it landed. Never the body. The whole worth of this is that it points at
   the mail rather than repeating it, and a table with room for a body is a
   table somebody will eventually fill.

   Which leg it is about is decided in travel-mail.js, on the flight number and
   the booking reference the traveller typed onto that leg themselves — the
   strings that could only be about their own journey. */
create table if not exists segment_mail (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references segments(id) on delete cascade,
  connection_id uuid not null references mailbox_connections(id) on delete cascade,
  message_id text not null,
  subject text not null,
  from_addr text,
  received_at timestamptz not null,
  /* What matched, kept so a wrong match can be understood rather than argued
     about — and so the rule can be changed with evidence. */
  matched_on text not null,
  noticed_at timestamptz not null default now(),
  unique (segment_id, message_id)
);
create index if not exists segment_mail_segment_idx on segment_mail(segment_id, received_at desc);

/* It goes when the mailbox does. Disconnecting a mailbox is somebody saying
   they want it out of this, and leaving the subjects of their email behind
   would be keeping the part that was theirs. */
