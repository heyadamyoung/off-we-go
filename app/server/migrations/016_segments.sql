-- The getting-there layer: every leg of a travel day — flight, train, bus,
-- ferry, a drive — as one shape, a segment. Competitors silo the modes;
-- travel days are chains. Deadlines are stored resolved (derived from
-- departure by per-mode templates at write time, editable after), passengers
-- are the trip's own people with their seats, and status only changes on
-- evidence — status_note says whose email moved the gate.
create table segments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  mode text not null,
  carrier text,
  number text,
  ref text,
  from_name text not null,
  from_code text,
  from_lng double precision,
  from_lat double precision,
  to_name text not null,
  to_code text,
  to_lng double precision,
  to_lat double precision,
  departs_at timestamptz not null,
  arrives_at timestamptz,
  depart_tz text,
  arrive_tz text,
  terminal text,
  gate text,
  gate_was text,
  platform text,
  -- [{ personId, name, seat, passPhotoId }]
  passengers jsonb not null default '[]'::jsonb,
  -- { checked, carryOn, personal } as freeform strings ("1 × 23 kg")
  bags jsonb,
  -- { checkinOpensAt, checkinClosesAt, bagsCloseAt, boardingAt, doorsAt } ISO
  deadlines jsonb,
  cost_amount numeric,
  cost_currency text,
  status text not null default 'scheduled',
  status_note text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index segments_trip_departs_idx on segments(trip_id, departs_at);

-- The paperwork a leg needs at a counter: boarding passes, rail PDFs, visa
-- letters — attached to the segment, optionally to one passenger, and often
-- pulled straight out of the booking email by the assistant. A table rather
-- than jsonb because files have a deletion lifecycle the photo pipeline
-- already runs; storage_path joins that same queue when a document goes.
create table segment_documents (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references segments(id) on delete cascade,
  person_id uuid,
  name text not null,
  kind text not null default 'ticket',
  mime text not null,
  storage_path text not null,
  bytes integer,
  created_at timestamptz not null default now()
);
create index segment_documents_segment_idx on segment_documents(segment_id);
