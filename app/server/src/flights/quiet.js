/* What a board that has gone quiet last said, kept on the view.
 *
 * The two boards of one flight do not answer for the same hours. Dublin's
 * departures listing reaches four hours back and Pearson's a day, and a
 * crossing is seven hours in the air, so by the time the far board is naming
 * a belt the near one may have dropped the flight; and Pearson's arrivals
 * board answers once and then challenges, so for a while the near board is
 * the only one answering. Each end's last word about its own end is kept
 * until that board says otherwise.
 *
 * Without this, a belt un-assigned itself because the board that named it
 * went quiet, a landed flight took off again — and, the worse one, the far
 * board's gate, which is where the flight comes in, was written onto the leg
 * as where it leaves from and announced as a gate change, hours after the
 * flight had left. */

const LANDED = new Set(['landed', 'arrived'])
const ENDED = new Set(['cancelled', 'diverted'])

/* Both looks' sources, the ones answering this minute first. */
const unite = (now, before) => [...now, ...before.filter(one => !now.includes(one))]

/**
 * Only the near board answered: the far end as the arrivals board last had
 * it — the belt, the arrival gate and terminal, the estimate, the landing —
 * and a flight it had landed stays landed, whatever the near board still
 * says about it.
 */
export function keepFarEnd(view, was) {
  const settled = LANDED.has(was.status) && !LANDED.has(view.status) && !ENDED.has(view.status)
  return {
    ...view,
    baggageBelt: view.baggageBelt || was.baggageBelt || null,
    arrivalTerminal: view.arrivalTerminal || was.arrivalTerminal || null,
    arrivalGate: view.arrivalGate || was.arrivalGate || null,
    estimatedArrival: view.estimatedArrival || was.estimatedArrival || null,
    actualArrival: view.actualArrival || was.actualArrival || null,
    ...(settled ? { status: was.status, statusText: was.statusText } : {}),
    sources: unite(view.sources || [], was.sources || []),
  }
}

/**
 * Only the far board answered: the near end as the departures board last had
 * it — the gate and terminal it leaves from, the boarding, when it left, the
 * aircraft, the desks and the walk — and a flight it said had departed has
 * departed, however the far board words the wait for it. The view's own
 * gate is already blank here (mergeBoards): an arrivals board's gate is
 * where the flight comes in.
 */
export function keepNearEnd(view, was) {
  const left = was.status === 'departed' && !LANDED.has(view.status) && !ENDED.has(view.status)
  return {
    ...view,
    gate: was.gate || null,
    terminal: was.terminal || null,
    boardingStatus: was.boardingStatus || null,
    scheduledDeparture: view.scheduledDeparture || was.scheduledDeparture || null,
    estimatedDeparture: view.estimatedDeparture || was.estimatedDeparture || null,
    actualDeparture: view.actualDeparture || was.actualDeparture || null,
    aircraft: was.aircraft || view.aircraft || null,
    ...(was.extra ? { extra: was.extra } : {}),
    ...(left ? { status: was.status, statusText: was.statusText } : {}),
    sources: unite(view.sources || [], was.sources || []),
  }
}
