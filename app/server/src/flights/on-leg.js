/* The board's last word, as it rides on a leg.
 *
 * The snapshot the watch keeps is the whole FlightInfo view of both boards.
 * The leg does not need all of it: the phone wants what draws the day face —
 * the status and the words behind it, the times as the board knows them, the
 * gate and belt, the check-in zone and desks, how far the gate is, how long
 * security is, whether pre-clearance is on the way, and which board said so
 * and when — everything a traveller would otherwise stand and read off the
 * departures board. Projected here once, so the segments
 * payload, the offline pack and the Lock Screen card all read the same slice
 * and nobody fetches per leg. */

const text = value => (value == null || value === '' ? null : String(value))
const number = value => (Number.isFinite(value) ? value : null)

/**
 * @param {object|null|undefined} info  the snapshot's FlightInfo view
 * @param {string|null} [fetchedAt]  when the watch last read the boards
 * @param {string|null} [note]  the watch's own last sentence in the leg's status note
 */
export function flightOnLeg(info, fetchedAt = null, note = null) {
  if (!info || typeof info !== 'object') return null
  const extra = info.extra && typeof info.extra === 'object' ? info.extra : {}
  return {
    status: text(info.status) || 'unknown',
    statusText: text(info.statusText),
    /* So the phone can tell the watch's sentence from one somebody typed:
       the headline already says what the watch's says, and a note that is
       the board's own is not drawn a second time under it. */
    note: text(note),
    boardingStatus: text(info.boardingStatus),
    gate: text(info.gate),
    terminal: text(info.terminal),
    baggageBelt: text(info.baggageBelt),
    scheduledDeparture: text(info.scheduledDeparture),
    estimatedDeparture: text(info.estimatedDeparture),
    actualDeparture: text(info.actualDeparture),
    scheduledArrival: text(info.scheduledArrival),
    estimatedArrival: text(info.estimatedArrival),
    actualArrival: text(info.actualArrival),
    checkinZone: text(extra.checkinZone),
    checkinDesks: text(extra.checkinDeskRange),
    walkMinutes: number(extra.walkMinutes),
    goToGateTime: text(extra.goToGateTime),
    securityWaitMinutes: number(extra.securityWaitMinutes),
    stand: text(extra.stand),
    /** US pre-clearance before the gate — Dublin says which flights */
    preClearance: extra.preClearance === true ? true : null,
    aircraft: text(info.aircraft),
    /** the arrivals board says the bags are out; only some boards ever do */
    bagsInHall: info.bagsInHall === true,
    /** the type the same number flew last time it was heard, for a leg nothing has named the day's for yet */
    usualAircraft: text(info.usualAircraft),
    sources:
      Array.isArray(info.sources) && info.sources.length
        ? info.sources
        : [info.source].filter(Boolean),
    lastUpdated: text(info.lastUpdated),
    fetchedAt: text(fetchedAt),
  }
}
