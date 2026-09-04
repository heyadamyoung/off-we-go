-- A travel leg has an identity: this trip, this mode, this carrier and number,
-- this departure instant. The agent answered a retried question twice on a
-- phone whose connection died mid-answer, and the trip woke up with every leg
-- doubled — so first the existing doubles fold into their earliest copy
-- (documents follow), and from here on the API treats a matching insert as an
-- update rather than a sibling.
with ranked as (
  select id,
         first_value(id) over w as keeper,
         row_number() over w as rn
  from segments
  window w as (
    partition by trip_id, mode, coalesce(carrier, ''), coalesce(number, ''), departs_at
    order by created_at, id
  )
)
update segment_documents sd
set segment_id = r.keeper
from ranked r
where sd.segment_id = r.id and r.rn > 1;

with ranked as (
  select id,
         row_number() over w as rn
  from segments
  window w as (
    partition by trip_id, mode, coalesce(carrier, ''), coalesce(number, ''), departs_at
    order by created_at, id
  )
)
delete from segments s
using ranked r
where s.id = r.id and r.rn > 1;
