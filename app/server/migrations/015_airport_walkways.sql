-- Hand-laid walking segments inside a terminal, for the stretches OSM has not
-- mapped. Added through the assistant's MCP tools, merged into the airport
-- indoor payload at serve time as ordinary corridor ways, and walked by the
-- same router as everything OpenStreetMap drew — the island-stitcher welds
-- them to the mapped network.
create table airport_walkways (
  id uuid primary key default gen_random_uuid(),
  -- The anchor is the segment's first point; serving selects by proximity.
  lng double precision not null,
  lat double precision not null,
  -- OSM level syntax, "1" or "0;1", exactly what parseLevels reads.
  level text not null default '0',
  name text,
  -- Ordered [lng, lat] pairs, at least two.
  points jsonb not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index airport_walkways_anchor_idx on airport_walkways(lng, lat);
