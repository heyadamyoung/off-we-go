/* Photograph order was drawn from one sequence shared by every trip in the
   product. It is correct and it is fast — Postgres sequences do millions a
   second — but it is a single object every insert in the system touches, and
   the numbering it produces is global, so one trip's photographs are numbered
   1, 57, 231 with everybody else's in the gaps.

   Order is a fact about a trip, so it is now counted within one: each trip
   carries its own high-water mark. Contention becomes per trip, which is
   where it belongs and where it is nearly nothing. */
alter table trips add column if not exists photo_seq bigint not null default 0;

/* Where each trip has already got to. Nothing is renumbered — existing values
   are already increasing within a trip, so the order people see is unchanged
   and the next number simply carries on from that trip's own highest. */
update trips t
set photo_seq = coalesce((select max(p.seq) from photos p where p.trip_id = t.id), 0)
where t.photo_seq = 0;

/* The mark only ever goes up, so a deleted photograph's position is never
   handed out again. That matters more than tidiness now: `seq` is the cursor
   the app pages photographs with, and a number that came back a second time
   would silently skip or repeat a page. This index makes that structural
   rather than a thing to remember. */
create unique index if not exists photos_trip_seq_unique on photos(trip_id, seq);

/* The old sequence stays: dropping it would make a rollback to the previous
   release fail on its first upload, and an unused sequence costs one
   catalogue row. */
