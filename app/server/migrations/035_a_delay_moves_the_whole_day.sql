/* Where a departure was before it moved.

   A gate change has kept its history since migration 016 — the old gate slides
   into gate_was and the card strikes it through — and the one number on a
   travel day that matters more than the gate kept no history at all. A flight
   put back ninety minutes simply had a different departure time, with nothing
   anywhere to say it had ever been anything else.

   So the card could not say "16:10, now 17:40", the countdown could not be
   re-derived from a known starting point, and a traveller who glanced at the
   screen had no way to tell a delay from having misremembered.

   Null for everything that has never moved, which is almost everything. */

alter table segments add column if not exists departs_was timestamptz;

/* A departure that moved and then moved back to where it started is a
   departure that never moved, and a row saying otherwise would have the card
   striking through a time that is also the time. */
alter table segments drop constraint if exists segments_departs_was_differs;
alter table segments add constraint segments_departs_was_differs
  check (departs_was is null or departs_was <> departs_at);

/* Nothing is backfilled. The old departures were never written down; inventing
   them from the current one would put a struck-through lie on every card on
   every trip in the database. */
