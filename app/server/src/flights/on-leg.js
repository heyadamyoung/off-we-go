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
 */
export function flightOnLeg(info, fetchedAt = null) {
  if (!info || typeof info !== 'object') return null
  const extra = info.extra && typeof info.extra === 'object' ? info.extra : {}
  return {
    status: text(info.status) || 'unknown',
    statusText: text(info.statusText),
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
    sources:
      Array.isArray(info.sources) && info.sources.length
        ? info.sources
        : [info.source].filter(Boolean),
    lastUpdated: text(info.lastUpdated),
    fetchedAt: text(fetchedAt),
  }
}
