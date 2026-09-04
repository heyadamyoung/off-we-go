/* Where exactly you are sitting, from nothing but the booking. Real airline
   cabin drawings are licensed art; the question a family actually asks —
   front or back, window or aisle, together or split across an aisle, over
   the wing or clear of it — is answered by a schematic cabin derived from
   the seats themselves. The seat letters carry the truth: A–F is a
   narrow-body's two triples, anything beyond F only exists on a wide-body.
   The drawing owns honesty about the rest ("typical layout"), this module
   owns the geometry. */

export interface SeatPlace {
  row: number
  letter: string
}

export interface CabinPlan {
  /** seat letters in window→window order, one array per bank between aisles */
  sections: string[][]
  rows: number
  /** first and last row shaded as the wing */
  wing: [number, number]
  kind: 'narrow' | 'wide'
}

/* "31A", "4 f", " 12C " — a row and a letter, or nothing. */
export function parseSeat(seat: string | null | undefined): SeatPlace | null {
  const m = /^\s*(\d{1,3})\s*([A-Za-z])\s*$/.exec(seat || '')
  if (!m) return null
  const row = Number(m[1])
  if (!row) return null
  return { row, letter: m[2].toUpperCase() }
}

const NARROW: string[][] = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
]
/* The wide superset: 3-4-3 holds every letter an A330's 2-4-2, a 787's
   3-3-3 or a 777's 3-4-3 can book (I is skipped by every airline). */
const WIDE: string[][] = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F', 'G'],
  ['H', 'J', 'K'],
]

export function cabinFor(seats: Array<string | null | undefined>): CabinPlan {
  const places = seats.map(parseSeat).filter((place): place is SeatPlace => place !== null)
  const wide = places.some(place => place.letter > 'F')
  const sections = wide ? WIDE : NARROW
  const deepest = Math.max(0, ...places.map(place => place.row))
  /* Enough cabin behind the deepest booked row that it never sits on the
     tail cone, and never fewer rows than the family the layout belongs to. */
  const rows = Math.max(deepest + 6, wide ? 46 : 32)
  const wing: [number, number] = [Math.ceil(rows * 0.34), Math.floor(rows * 0.62)]
  return { sections, rows, wing, kind: wide ? 'wide' : 'narrow' }
}
