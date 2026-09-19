/* Being added to a trip by email is being on the trip. There is nothing to
   accept any more: an account that exists is a member the moment it is
   added, and one that does not becomes a member the moment it is made. The
   rows that were waiting for an acceptance nobody will now give are settled
   here the same way. */

insert into trip_members(trip_id,profile_id,role)
select i.trip_id, u.id, i.role
from trip_invites i join users u on u.email = i.email
where i.claimed_at is null
on conflict(trip_id,profile_id) do nothing;

update trip_invites i set claimed_at = now()
from users u where u.email = i.email and i.claimed_at is null;
