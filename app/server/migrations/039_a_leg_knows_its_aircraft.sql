/* A leg knows its aircraft.

   The seat map draws the cabin a family will sit in, and which cabin that is
   depends on the aircraft: an A220 is two-and-three across, a Dash 8 two-
   and-two, a 787 three-three-three. The airports' boards rarely say which
   (Regina names the type; Pearson and Dublin do not), the transponder says
   only once it is in the air, and the airline's email said it at booking.
   So the type is a thing somebody can write onto the leg, as the booking
   names it, and the mailbox's reader can write it there for them. */

alter table segments add column if not exists aircraft text;
