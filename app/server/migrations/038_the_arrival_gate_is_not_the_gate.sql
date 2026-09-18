/* The arrival gate is not the gate.

   Once a flight had left its airport by a few hours, that airport's
   departures listing no longer carried it, and only the far end's arrivals
   board answered the watch. The watch took that board's row for the whole
   flight, and the row's gate and terminal — where the flight comes in — were
   written onto the leg as where it leaves from: the real gate slid into
   gate_was and was drawn struck through beside the wrong one, "has moved
   from gate 420 to F82" became the status note in place of the landing, and
   the check-in desks on the ticket gave way to the far end's stand. The
   watch now knows an arrivals board's gate for what it is (mergeBoards and
   keepNearEnd in server/src/flights); this puts back what it wrote over.

   The wrong events are recognisable: a gate or terminal change whose source
   is the destination's board. Only the board at the near end moves a gate. */

create temporary table wrong_flight_events as
  select e.id, e.segment_id, e.type, e.old_value, e.new_value, e.text, e.noted_at
  from flight_events e
  join segments s on s.id = e.segment_id
  join (values
    ('DUB', array['api.dublinairport.com']),
    ('YYZ', array['www.torontopearson.com', 'gtaa-fl-prod.azureedge.net']),
    ('YQR', array['yqr.simpleway.cloud'])
  ) as far (code, hosts) on far.code = upper(s.to_code)
  where e.type in ('GateChanged', 'TerminalChanged')
    and e.source = any (far.hosts);

/* Per leg: the gate and terminal before the far ones were written over them
   (the first wrong event's old value), the far ones as last written (the
   last wrong event's new value), what the near board had last moved the
   gate from — which is what gate_was held before — and when the near board
   said the flight left, which the far-only snapshot lost. */
create temporary table wrong_flight_legs as
  select w.segment_id,
    (array_agg(w.old_value order by w.noted_at) filter (where w.type = 'GateChanged'))[1]
      as gate_before,
    (array_agg(w.new_value order by w.noted_at desc) filter (where w.type = 'GateChanged'))[1]
      as far_gate,
    count(*) filter (where w.type = 'GateChanged') as gate_events,
    array_agg(w.new_value) filter (where w.type = 'GateChanged') as far_gates,
    (array_agg(w.old_value order by w.noted_at) filter (where w.type = 'TerminalChanged'))[1]
      as terminal_before,
    (array_agg(w.new_value order by w.noted_at desc) filter (where w.type = 'TerminalChanged'))[1]
      as far_terminal,
    (select l.old_value from flight_events l
      where l.segment_id = w.segment_id and l.type = 'GateChanged'
        and l.id not in (select id from wrong_flight_events)
      order by l.noted_at desc limit 1) as gate_was_before,
    (select d.new_value from flight_events d
      where d.segment_id = w.segment_id and d.type = 'FlightDeparted'
        and d.new_value ~ '^\d{4}-\d{2}-\d{2}T'
      order by d.noted_at desc limit 1) as departed_at
  from wrong_flight_events w
  group by w.segment_id;

/* The leg. The gate goes back where it still says the far gate; a gate the
   traveller has since corrected by hand is theirs. A far gate never belongs
   in gate_was, corrected by hand or not. The typed gate the first wrong
   write slid into gate_was is the gate when the snapshot had none to say. */
update segments s set
  gate = case
    when l.far_gate is not null and s.gate = l.far_gate
      then coalesce(l.gate_before, case when l.gate_events = 1 then s.gate_was end)
    else s.gate end,
  gate_was = case
    when (l.far_gate is not null and s.gate = l.far_gate) or s.gate_was = any (l.far_gates)
      then l.gate_was_before
    else s.gate_was end,
  terminal = case
    when l.far_terminal is not null and s.terminal = l.far_terminal then l.terminal_before
    else s.terminal end,
  updated_at = now()
from wrong_flight_legs l
where l.segment_id = s.id;

/* The note, where it is still the watch's own sentence about the far gate:
   the landing it displaced, said as the watch says a landing — the far
   board's name, the far end's clock. A note somebody typed is theirs. */
create temporary table wrong_flight_notes as
  select s.id as segment_id,
    (select landed.text || ' ' || far.name || ', '
        || to_char(landed.noted_at at time zone far.zone, 'HH24:MI') || '.'
      from flight_events landed
      where landed.segment_id = s.id and landed.type = 'FlightLanded'
      order by landed.noted_at desc limit 1) as note
  from segments s
  join wrong_flight_legs l on l.segment_id = s.id
  join flight_snapshots f on f.segment_id = s.id
  join (values
    ('DUB', 'Dublin Airport', 'Europe/Dublin'),
    ('YYZ', 'Toronto Pearson', 'America/Toronto'),
    ('YQR', 'Regina Airport', 'America/Regina')
  ) as far (code, name, zone) on far.code = upper(s.to_code)
  where s.status_note is not null and s.status_note = f.note
    and exists (select 1 from wrong_flight_events w
      where w.segment_id = s.id and left(s.status_note, length(w.text)) = w.text);

update segments s set status_note = n.note, updated_at = now()
from wrong_flight_notes n where n.segment_id = s.id;

update flight_snapshots f set note = n.note, updated_at = now()
from wrong_flight_notes n where n.segment_id = f.segment_id;

/* The snapshot, where it is the far board's row taken for the whole flight:
   the far gate and terminal under their own names, the near board's last
   word put back, the far end's extras gone, and the departure the near
   board had reported. */
update flight_snapshots f set
  info = (f.info - 'extra')
    || case when l.far_gate is not null and f.info->>'gate' = l.far_gate
         then jsonb_build_object('gate', l.gate_before, 'arrivalGate', f.info->'gate')
         else '{}'::jsonb end
    || case when l.far_terminal is not null and f.info->>'terminal' = l.far_terminal
         then jsonb_build_object('terminal', l.terminal_before, 'arrivalTerminal', f.info->'terminal')
         else '{}'::jsonb end
    || case when f.info->>'actualDeparture' is null and l.departed_at is not null
         then jsonb_build_object('actualDeparture', l.departed_at)
         else '{}'::jsonb end,
  updated_at = now()
from wrong_flight_legs l
where l.segment_id = f.segment_id
  and ((l.far_gate is not null and f.info->>'gate' = l.far_gate)
    or (l.far_terminal is not null and f.info->>'terminal' = l.far_terminal));

delete from flight_events where id in (select id from wrong_flight_events);

drop table wrong_flight_notes;
drop table wrong_flight_legs;
drop table wrong_flight_events;
