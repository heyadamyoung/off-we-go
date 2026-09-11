/* Which itinerary item a photograph belongs to is decided from where it was
   taken, by the rule in stop-placement.js, and re-decided every time the
   itinerary changes shape. That is right nearly always and it is why nobody
   has to file anything.

   It is wrong in two cases, and they are the two people actually hit. A
   picture with no coordinates — an aeroplane in flight, a scan, a phone with
   location off, anything sent over WhatsApp, which strips EXIF — has nothing
   to decide from. And a picture taken four hundred metres from the wrong
   thing is filed at the wrong thing, confidently. Both want a person to say
   where it goes, and until now a person saying so was undone by the next
   stop edit, silently.

   So a filing can be marked as chosen rather than computed. The rule leaves
   those alone; everything else carries on being decided by distance. This is
   deliberately not `location_source = 'manual'`: that column says where the
   coordinates came from, which is a different fact and still true of a
   picture whose stop somebody has since corrected. */
alter table photos add column if not exists stop_pinned boolean not null default false;

/* Existing rows are all computed — there has been no way to say otherwise —
   so the default is the truth for every one of them, and nothing is
   backfilled. */
