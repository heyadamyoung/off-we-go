/* A phone is paired by typing six characters on it, rather than scanning a
   QR code off another screen. The organiser's screen shows the code; the
   phone types it into /pair and is handed the device's token. One live code
   per phone, a quarter of an hour long, spent on first use. The token it
   hands over is the device's fresh one — the same rotation "New code" always
   did — so it is held here in the clear only for those minutes, and the
   device itself still knows nothing but the hash. */

create table if not exists device_pair_codes (
  code text primary key,
  device_id uuid not null references devices(id) on delete cascade,
  token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index if not exists device_pair_codes_device_idx on device_pair_codes(device_id);
