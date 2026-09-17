/* The airports, speaking for themselves.

   A flight leg has always been what somebody typed onto it: the number, the
   departure, the gate if they knew it. From here the airports' own boards are
   read for every leg the app knows the airport of, and what they say is
   written onto the leg. Two tables keep the evidence.

   The snapshot is the last thing the boards said about a leg, whole, in the
   normalized shape the flights module speaks. It is what the next look is
   compared against, so a gate that has already been announced is not
   announced again, and it is what the phone reads to say "the airport says".
   One per leg; it goes when the leg does. */

create table if not exists flight_snapshots (
  segment_id uuid primary key references segments(id) on delete cascade,
  info jsonb not null,
  fetched_at timestamptz not null,
  updated_at timestamptz not null default now()
);

/* Every change the boards reported, as it was reported: the kind, the old
   and new value, the sentence a person was shown, and which board said it.
   Kept because a notification that was wrong has to be explicable — "which
   board said the gate moved, and when" — and because the day a board changes
   shape, the events it produced are the evidence of what it did before. */
create table if not exists flight_events (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references segments(id) on delete cascade,
  type text not null,
  old_value text,
  new_value text,
  minutes integer,
  text text not null,
  source text,
  noted_at timestamptz not null default now()
);
create index if not exists flight_events_segment_idx on flight_events(segment_id, noted_at desc);
