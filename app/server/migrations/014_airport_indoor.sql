-- The inside of an airport, fetched from Overpass once and kept for everyone.
-- The cache used to live only in the process, so every deploy forgot every
-- terminal and the next phone paid the half-minute fetch again; this table is
-- the month-long memory the restart cannot take. Rows age out by fetched_at —
-- the server treats anything past its TTL as a miss and re-asks.
create table if not exists airport_indoor (
  key text primary key,
  body jsonb not null,
  fetched_at timestamptz not null default now()
);
