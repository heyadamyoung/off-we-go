-- Paperwork belongs wherever the plan needs it, not only on travel legs: a
-- museum ticket on the museum, a booking confirmation on the hotel stop. Same
-- shape as segment_documents, owned by a stop instead.
create table stop_documents (
  id uuid primary key default gen_random_uuid(),
  stop_id uuid not null references stops(id) on delete cascade,
  person_id uuid,
  name text not null,
  kind text not null default 'ticket',
  mime text not null,
  storage_path text not null,
  bytes integer,
  created_at timestamptz not null default now()
);
create index stop_documents_stop_idx on stop_documents(stop_id);
