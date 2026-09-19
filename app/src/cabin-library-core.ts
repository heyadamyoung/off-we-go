/* The airline's own cabin, as the server keeps it: which rows are which
   class and how many across in each, where the doors are, which rows the
   wing is under. The server's library is keyed by the airline's two-letter
   code and the aircraft's type code; this is the client's half — the shape
   it receives, and the airline read off a leg. */

export interface CabinClass {
  name: string
  /** first and last row, inclusive; rows between two classes may be skipped */
  rows: [number, number]
  /** seat letters window→window, one array per bank between aisles */
  sections: string[][]
}

export interface AirlineCabin {
  airline: string
  family: string
  name: string
  seats: number
  cabins: CabinClass[]
  /** rows a door sits beside */
  exits: number[]
  /** first and last row over the wing */
  wing: [number, number]
}

/* The airlines a family flies, by the words a booking calls them, for a leg
   whose number carries no code ("Air Canada · 1115"). A number that does
   carry one — "AC 1115", "KL677" — is believed over the words. */
const BY_NAME: Array<[RegExp, string]> = [
  [/cityhopper/i, 'WA'],
  [/\bklm\b/i, 'KL'],
  [/\bjazz\b|air canada express/i, 'QK'],
  [/\brouge\b/i, 'RV'],
  [/air canada/i, 'AC'],
  [/transat/i, 'TS'],
  [/encore/i, 'WR'],
  [/westjet/i, 'WS'],
  [/aer lingus/i, 'EI'],
  [/\bporter\b/i, 'PD'],
]

/** The airline's two-letter code from a leg's number, else from its name. */
export function airlineCodeOf(leg: {
  carrier?: string | null
  number?: string | null
}): string | null {
  const number = String(leg.number ?? '').trim()
  const coded = /^([A-Z][A-Z0-9]|[0-9][A-Z])\s?\d{1,4}[A-Z]?$/i.exec(number)
  if (coded) return coded[1].toUpperCase()
  const carrier = String(leg.carrier ?? '')
  for (const [words, code] of BY_NAME) if (words.test(carrier)) return code
  return null
}

/** Whether every booked seat has a place in the airline's cabin: a letter
    or a row the cabin has no seat for is a booking on a different aircraft
    than the one named, and the booking is the one thing certainly true. */
export function seatsFit(
  places: Array<{ row: number; letter: string }>,
  cabin: AirlineCabin,
): boolean {
  return places.every(place =>
    cabin.cabins.some(
      section =>
        place.row >= section.rows[0] &&
        place.row <= section.rows[1] &&
        section.sections.flat().includes(place.letter),
    ),
  )
}

/** The cabin that holds a row, or null in a gap of the numbering. */
export function classOfRow(cabin: AirlineCabin, row: number): CabinClass | null {
  return cabin.cabins.find(section => row >= section.rows[0] && row <= section.rows[1]) || null
}

/** A shape off the wire is a cabin, or it is nothing. */
export function isAirlineCabin(value: unknown): value is AirlineCabin {
  const cabin = value as Partial<AirlineCabin> | null
  return (
    !!cabin &&
    typeof cabin.airline === 'string' &&
    typeof cabin.family === 'string' &&
    typeof cabin.name === 'string' &&
    Array.isArray(cabin.cabins) &&
    cabin.cabins.length > 0 &&
    cabin.cabins.every(
      section =>
        typeof section?.name === 'string' &&
        Array.isArray(section.rows) &&
        section.rows.length === 2 &&
        Array.isArray(section.sections),
    ) &&
    Array.isArray(cabin.exits) &&
    Array.isArray(cabin.wing) &&
    cabin.wing.length === 2
  )
}
