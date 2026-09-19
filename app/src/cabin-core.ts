/* Which cabin an aircraft has, from its type as a board, the transponder or
   a booking names it.

   The airports and the transponder network name a type in ICAO's four
   letters (BCS3, B38M, DH8D), airlines' emails and timetables in words
   ("Airbus A220-300") or IATA's three (223, 7M8), and a family who want to
   know which side of the aisle they are on need none of it — they need the
   right cross-section: an A220's two-and-three, a 737's three-and-three, a
   Dash 8's two-and-two, a 787's three-three-three. That is what this knows,
   with a name to say and a typical length to draw. The exact chart of one
   airline's one aircraft — which row the exits are, where business ends —
   is licensed art, and the drawing says so. */

export interface CabinFamily {
  /** the ICAO type designator the family is filed under */
  code: string
  name: string
  /** seat letters window→window, one array per bank between aisles */
  sections: string[][]
  /** rows in a typical layout, so the drawing is about the right length */
  rows: number
}

const N33: string[][] = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
]
const N23: string[][] = [
  ['A', 'C'],
  ['D', 'E', 'F'],
]
const MD23: string[][] = [
  ['A', 'B'],
  ['C', 'D', 'E'],
]
/* Regional jets and turboprops: two and two, lettered A C / D F by most of
   the airlines that fly them here (Air Canada Express, WestJet Encore). A
   booking with a B in it says the airline letters them A B / C D instead —
   see cabinFor. */
const R22: string[][] = [
  ['A', 'C'],
  ['D', 'F'],
]
const R12: string[][] = [['A'], ['B', 'C']]
const W333: string[][] = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
  ['H', 'J', 'K'],
]
const W343: string[][] = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F', 'G'],
  ['H', 'J', 'K'],
]
const W242: string[][] = [
  ['A', 'C'],
  ['D', 'E', 'F', 'G'],
  ['H', 'K'],
]
const W232: string[][] = [
  ['A', 'B'],
  ['C', 'D', 'E'],
  ['F', 'G'],
]

/* In order: a name that contains another ("A320neo" holds "A320", "737 MAX
   8" holds "737") is tested first. Each pattern takes the ICAO code, the
   IATA code and the words, upper-cased with the spaces and dashes taken out. */
const FAMILIES: Array<CabinFamily & { match: RegExp }> = [
  {
    code: 'BCS1',
    name: 'Airbus A220-100',
    sections: N23,
    rows: 30,
    match: /^(BCS1|A221|221)$|A220100|CS100/,
  },
  {
    code: 'BCS3',
    name: 'Airbus A220-300',
    sections: N23,
    rows: 36,
    match: /^(BCS3|A223|223)$|A220|CS300/,
  },
  {
    code: 'A21N',
    name: 'Airbus A321neo',
    sections: N33,
    rows: 40,
    match: /^(A21N|32Q|32B)$|A321(NEO|LR|XLR)/,
  },
  {
    code: 'A20N',
    name: 'Airbus A320neo',
    sections: N33,
    rows: 32,
    match: /^(A20N|32N|32A)$|A320NEO/,
  },
  { code: 'A19N', name: 'Airbus A319neo', sections: N33, rows: 30, match: /^(A19N|31N)$|A319NEO/ },
  { code: 'A318', name: 'Airbus A318', sections: N33, rows: 28, match: /^(A318|318)$|A318/ },
  { code: 'A319', name: 'Airbus A319', sections: N33, rows: 30, match: /^(A319|319)$|A319/ },
  { code: 'A320', name: 'Airbus A320', sections: N33, rows: 32, match: /^(A320|320)$|A320/ },
  { code: 'A321', name: 'Airbus A321', sections: N33, rows: 40, match: /^(A321|321)$|A321/ },
  {
    code: 'B37M',
    name: 'Boeing 737 MAX 7',
    sections: N33,
    rows: 26,
    match: /^(B37M|7M7)$|737MAX7$/,
  },
  {
    code: 'B38M',
    name: 'Boeing 737 MAX 8',
    sections: N33,
    rows: 33,
    match: /^(B38M|7M8)$|737MAX8|7378MAX/,
  },
  {
    code: 'B39M',
    name: 'Boeing 737 MAX 9',
    sections: N33,
    rows: 37,
    match: /^(B39M|7M9)$|737MAX9|7379MAX/,
  },
  {
    code: 'B3XM',
    name: 'Boeing 737 MAX 10',
    sections: N33,
    rows: 40,
    match: /^(B3XM|7MJ)$|737MAX10/,
  },
  { code: 'B736', name: 'Boeing 737-600', sections: N33, rows: 22, match: /^(B736|736)$|737600/ },
  {
    code: 'B737',
    name: 'Boeing 737-700',
    sections: N33,
    rows: 26,
    match: /^(B737|73W|73G)$|737700/,
  },
  {
    code: 'B738',
    name: 'Boeing 737-800',
    sections: N33,
    rows: 32,
    match: /^(B738|738|73H)$|737800/,
  },
  {
    code: 'B739',
    name: 'Boeing 737-900',
    sections: N33,
    rows: 36,
    match: /^(B739|739|73J)$|737900/,
  },
  { code: 'B738', name: 'Boeing 737', sections: N33, rows: 32, match: /^B73|^737/ },
  {
    code: 'B752',
    name: 'Boeing 757-200',
    sections: N33,
    rows: 40,
    match: /^(B752|752|75W)$|757200|^757/,
  },
  { code: 'B753', name: 'Boeing 757-300', sections: N33, rows: 46, match: /^(B753|753)$|757300/ },
  { code: 'E170', name: 'Embraer 170', sections: R22, rows: 18, match: /^(E170|E70)$|E170|ERJ170/ },
  {
    code: 'E75L',
    name: 'Embraer 175',
    sections: R22,
    rows: 20,
    match: /^(E75L|E75S|E175|E75|E7W)$|E175|ERJ175/,
  },
  { code: 'E290', name: 'Embraer E190-E2', sections: R22, rows: 27, match: /^(E290|290)$|E190E2/ },
  { code: 'E295', name: 'Embraer E195-E2', sections: R22, rows: 34, match: /^(E295|295)$|E195E2/ },
  { code: 'E190', name: 'Embraer 190', sections: R22, rows: 25, match: /^(E190|E90)$|E190|ERJ190/ },
  { code: 'E195', name: 'Embraer 195', sections: R22, rows: 30, match: /^(E195|E95)$|E195|ERJ195/ },
  {
    code: 'E145',
    name: 'Embraer ERJ 145',
    sections: R12,
    rows: 13,
    match: /^(E145|ER4|ERJ)$|ERJ145|E145/,
  },
  {
    code: 'E135',
    name: 'Embraer ERJ 135',
    sections: R12,
    rows: 10,
    match: /^(E135|ER3)$|ERJ135|E135/,
  },
  {
    code: 'CRJ2',
    name: 'Bombardier CRJ200',
    sections: R22,
    rows: 13,
    match: /^(CRJ2|CR2)$|CRJ200|CRJ100/,
  },
  {
    code: 'CRJ7',
    name: 'Bombardier CRJ700',
    sections: R22,
    rows: 18,
    match: /^(CRJ7|CR7)$|CRJ700|CRJ550/,
  },
  {
    code: 'CRJ9',
    name: 'Bombardier CRJ900',
    sections: R22,
    rows: 20,
    match: /^(CRJ9|CR9)$|CRJ900/,
  },
  {
    code: 'CRJX',
    name: 'Bombardier CRJ1000',
    sections: R22,
    rows: 25,
    match: /^(CRJX|CRK)$|CRJ1000/,
  },
  {
    code: 'DH8D',
    name: 'De Havilland Dash 8-400',
    sections: R22,
    rows: 20,
    match: /^(DH8D|DH4)$|Q400|DASH8400|DHC8400|8Q400/,
  },
  {
    code: 'DH8C',
    name: 'De Havilland Dash 8-300',
    sections: R22,
    rows: 14,
    match: /^(DH8C|DH3)$|Q300|DASH8300|DHC8300/,
  },
  {
    code: 'DH8A',
    name: 'De Havilland Dash 8-100',
    sections: R22,
    rows: 10,
    match: /^(DH8A|DH8B|DH1|DH2)$|Q200|DASH8[12]00|DHC8[12]00|DASH8$/,
  },
  {
    code: 'AT76',
    name: 'ATR 72',
    sections: R22,
    rows: 18,
    match: /^(AT72|AT75|AT76|AT7|ATR)$|ATR72/,
  },
  { code: 'AT46', name: 'ATR 42', sections: R22, rows: 12, match: /^(AT43|AT45|AT46|AT4)$|ATR42/ },
  { code: 'B712', name: 'Boeing 717', sections: MD23, rows: 30, match: /^(B712|717)$|717200|^717/ },
  {
    code: 'MD88',
    name: 'McDonnell Douglas MD-80',
    sections: MD23,
    rows: 34,
    match: /^(MD8\d|M8\d|MD90|M90)$|MD8\d|MD90/,
  },
  { code: 'B788', name: 'Boeing 787-8', sections: W333, rows: 38, match: /^(B788|788)$|7878/ },
  { code: 'B789', name: 'Boeing 787-9', sections: W333, rows: 42, match: /^(B789|789)$|7879/ },
  { code: 'B78X', name: 'Boeing 787-10', sections: W333, rows: 46, match: /^(B78X|781)$|78710/ },
  { code: 'B789', name: 'Boeing 787', sections: W333, rows: 42, match: /^B78|^787/ },
  {
    code: 'B77W',
    name: 'Boeing 777-300ER',
    sections: W343,
    rows: 48,
    match: /^(B77W|77W)$|777300ER/,
  },
  { code: 'B773', name: 'Boeing 777-300', sections: W343, rows: 48, match: /^(B773|773)$|777300/ },
  {
    code: 'B77L',
    name: 'Boeing 777-200LR',
    sections: W343,
    rows: 40,
    match: /^(B77L|77L)$|777200LR/,
  },
  { code: 'B772', name: 'Boeing 777-200', sections: W343, rows: 40, match: /^(B772|772)$|777200/ },
  { code: 'B779', name: 'Boeing 777-9', sections: W343, rows: 50, match: /^(B779|779)$|7779|777X/ },
  { code: 'B77W', name: 'Boeing 777', sections: W343, rows: 48, match: /^B77|^777/ },
  { code: 'B762', name: 'Boeing 767-200', sections: W232, rows: 32, match: /^(B762|762)$|767200/ },
  {
    code: 'B763',
    name: 'Boeing 767-300',
    sections: W232,
    rows: 40,
    match: /^(B763|763|76W)$|767300|^B76|^767/,
  },
  { code: 'B764', name: 'Boeing 767-400', sections: W232, rows: 44, match: /^(B764|764)$|767400/ },
  { code: 'B744', name: 'Boeing 747-400', sections: W343, rows: 50, match: /^(B744|744)$|747400/ },
  { code: 'B748', name: 'Boeing 747-8', sections: W343, rows: 52, match: /^(B748|74H)$|7478/ },
  { code: 'B744', name: 'Boeing 747', sections: W343, rows: 50, match: /^B74|^747/ },
  {
    code: 'A338',
    name: 'Airbus A330-800neo',
    sections: W242,
    rows: 38,
    match: /^(A338|338)$|A330800/,
  },
  {
    code: 'A339',
    name: 'Airbus A330-900neo',
    sections: W242,
    rows: 42,
    match: /^(A339|339)$|A330900/,
  },
  {
    code: 'A332',
    name: 'Airbus A330-200',
    sections: W242,
    rows: 38,
    match: /^(A332|332)$|A330200/,
  },
  {
    code: 'A333',
    name: 'Airbus A330-300',
    sections: W242,
    rows: 42,
    match: /^(A333|333)$|A330300|A330/,
  },
  {
    code: 'A343',
    name: 'Airbus A340-300',
    sections: W242,
    rows: 44,
    match: /^(A343|343)$|A340300|A340/,
  },
  {
    code: 'A346',
    name: 'Airbus A340-600',
    sections: W242,
    rows: 50,
    match: /^(A346|346)$|A340600/,
  },
  {
    code: 'A359',
    name: 'Airbus A350-900',
    sections: W333,
    rows: 42,
    match: /^(A359|359)$|A350900|A350$/,
  },
  {
    code: 'A35K',
    name: 'Airbus A350-1000',
    sections: W333,
    rows: 48,
    match: /^(A35K|351)$|A3501000/,
  },
  { code: 'A388', name: 'Airbus A380', sections: W343, rows: 50, match: /^(A388|388)$|A380/ },
]

/* "Boeing 787-9", "B789", "789", "787-9 Dreamliner" — one key each. */
const keyOf = (text: string) =>
  text
    .toUpperCase()
    /* "Embraer 175" is an E175: the maker's name is the model's letter. */
    .replace(/\bEMBRAER\b/g, 'E')
    .replace(
      /\b(THE|A|AN|AIRBUS|BOEING|BOMBARDIER|DE\s+HAVILLAND|DEHAVILLAND|CANADA|MITSUBISHI|DREAMLINER|AIRCRAFT|OPERATED\s+BY)\b/g,
      ' ',
    )
    .replace(/[\s\-_/().]+/g, '')

/** The family an aircraft belongs to, or null when the words name none. */
export function aircraftFamily(text: string | null | undefined): CabinFamily | null {
  const key = keyOf(String(text ?? ''))
  if (!key) return null
  const found = FAMILIES.find(family => family.match.test(key))
  return found
    ? { code: found.code, name: found.name, sections: found.sections, rows: found.rows }
    : null
}

/** What to call the aircraft on a ticket: the family's name, else the words
    a person typed, never a bare code nobody reads. */
export function aircraftName(text: string | null | undefined): string | null {
  const family = aircraftFamily(text)
  if (family) return family.name
  const raw = String(text ?? '').trim()
  return /\s/.test(raw) && raw.length >= 6 ? raw : null
}
