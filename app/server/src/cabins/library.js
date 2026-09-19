/* The airlines' cabins, as they publish them: which rows are which class,
 * how many seats across in each, where the doors are and where the wing
 * sits. Keyed by the airline's IATA code and the aircraft's ICAO type — the
 * two things a leg on a trip already carries, one from its number and one
 * from the board, the transponder or the booking.
 *
 * Representative, and said so on the drawing: an airline reconfigures a
 * fleet a sub-type at a time and the exact chart of one registration is
 * theirs. What is here is the configuration the airline publishes for the
 * type, close enough that "row 31 is over the wing, two rows behind the
 * exit, in economy" is true. Letters are the airline's own — where a
 * booking carries a letter a cabin has no seat for, the client falls back
 * to the generic cabin for the type rather than draw a lie.
 *
 * rows: [first, last], inclusive. Rows missing between cabins are gaps in
 * the airline's numbering, which the drawing keeps: economy on an Air
 * Canada 737 starts at row 12. exits: rows a door sits beside, the front
 * door beside the first row and the rear door beside the last. wing: the
 * rows over it. */

const AC_J22 = [
  ['A', 'C'],
  ['D', 'F'],
]
const Y33 = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
]
const Y23 = [
  ['A', 'C'],
  ['D', 'E', 'F'],
]
const R22 = [
  ['A', 'C'],
  ['D', 'F'],
]
const R12 = [['A'], ['C', 'D']]
const J121 = [['A'], ['D', 'G'], ['K']]
const J121_AC = [['A'], ['D', 'G'], ['K']]
const PY232 = [
  ['A', 'C'],
  ['D', 'E', 'G'],
  ['H', 'K'],
]
const Y333 = [
  ['A', 'B', 'C'],
  ['D', 'E', 'G'],
  ['H', 'J', 'K'],
]
const Y343 = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F', 'G'],
  ['H', 'J', 'K'],
]
const Y242 = [
  ['A', 'C'],
  ['D', 'E', 'F', 'G'],
  ['H', 'K'],
]
const J222 = [
  ['A', 'C'],
  ['D', 'G'],
  ['H', 'K'],
]
const Y33_KL = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
]
const Y333_KL = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
  ['G', 'H', 'J'],
]
const PC232_KL = [
  ['A', 'C'],
  ['D', 'E', 'F'],
  ['G', 'J'],
]
const J121_KL = [['A'], ['D', 'E'], ['K']]
const Y343_KL = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F', 'G'],
  ['H', 'J', 'K'],
]
const Y242_KL = [
  ['A', 'C'],
  ['D', 'E', 'F', 'G'],
  ['H', 'K'],
]

const cabin = (name, first, last, sections) => ({ name, rows: [first, last], sections })

/** @type {Array<{airline: string, family: string, name: string, seats: number, cabins: Array<{name: string, rows: [number, number], sections: string[][]}>, exits: number[], wing: [number, number]}>} */
export const CABINS = [
  /* ---- Air Canada ------------------------------------------------------ */
  {
    airline: 'AC',
    family: 'BCS3',
    name: 'Airbus A220-300',
    seats: 137,
    cabins: [cabin('Business', 1, 3, AC_J22), cabin('Economy', 12, 36, Y23)],
    exits: [1, 15, 16, 36],
    wing: [14, 22],
  },
  {
    airline: 'AC',
    family: 'A319',
    name: 'Airbus A319',
    seats: 120,
    cabins: [cabin('Business', 1, 3, AC_J22), cabin('Economy', 12, 29, Y33)],
    exits: [1, 13, 29],
    wing: [11, 18],
  },
  {
    airline: 'AC',
    family: 'A320',
    name: 'Airbus A320',
    seats: 146,
    cabins: [cabin('Business', 1, 3, AC_J22), cabin('Economy', 12, 34, Y33)],
    exits: [1, 20, 21, 34],
    wing: [17, 25],
  },
  {
    airline: 'AC',
    family: 'A321',
    name: 'Airbus A321',
    seats: 190,
    cabins: [cabin('Business', 1, 4, AC_J22), cabin('Economy', 12, 40, Y33)],
    exits: [1, 20, 31, 40],
    wing: [19, 29],
  },
  {
    airline: 'AC',
    family: 'B38M',
    name: 'Boeing 737 MAX 8',
    seats: 169,
    cabins: [cabin('Business', 1, 4, AC_J22), cabin('Economy', 12, 37, Y33)],
    exits: [1, 20, 21, 37],
    wing: [18, 26],
  },
  {
    airline: 'AC',
    family: 'B788',
    name: 'Boeing 787-8',
    seats: 255,
    cabins: [
      cabin('Business', 1, 5, J121_AC),
      cabin('Premium Economy', 12, 14, PY232),
      cabin('Economy', 15, 38, Y333),
    ],
    exits: [1, 12, 29, 38],
    wing: [21, 31],
  },
  {
    airline: 'AC',
    family: 'B789',
    name: 'Boeing 787-9',
    seats: 298,
    cabins: [
      cabin('Business', 1, 8, J121_AC),
      cabin('Premium Economy', 12, 14, PY232),
      cabin('Economy', 15, 42, Y333),
    ],
    exits: [1, 12, 31, 42],
    wing: [23, 35],
  },
  {
    airline: 'AC',
    family: 'B77W',
    name: 'Boeing 777-300ER',
    seats: 400,
    cabins: [
      cabin('Business', 1, 10, J121_AC),
      cabin('Premium Economy', 12, 15, PY232),
      cabin('Economy', 18, 51, Y343),
    ],
    exits: [1, 12, 30, 42, 51],
    wing: [25, 38],
  },
  {
    airline: 'AC',
    family: 'B77L',
    name: 'Boeing 777-200LR',
    seats: 300,
    cabins: [
      cabin('Business', 1, 10, J121_AC),
      cabin('Premium Economy', 12, 15, PY232),
      cabin('Economy', 18, 41, Y343),
    ],
    exits: [1, 12, 27, 41],
    wing: [21, 32],
  },
  {
    airline: 'AC',
    family: 'A333',
    name: 'Airbus A330-300',
    seats: 297,
    cabins: [
      cabin('Business', 1, 7, J121_AC),
      cabin('Premium Economy', 12, 14, PY232),
      cabin('Economy', 15, 45, Y242),
    ],
    exits: [1, 12, 27, 45],
    wing: [21, 33],
  },
  /* ---- Air Canada Express (Jazz) ------------------------------------- */
  {
    airline: 'QK',
    family: 'E75L',
    name: 'Embraer 175',
    seats: 76,
    cabins: [cabin('Business', 1, 3, R12), cabin('Economy', 12, 27, R22)],
    exits: [1, 17, 27],
    wing: [13, 20],
  },
  {
    airline: 'QK',
    family: 'CRJ9',
    name: 'Bombardier CRJ900',
    seats: 76,
    cabins: [cabin('Business', 1, 3, R12), cabin('Economy', 12, 27, R22)],
    exits: [1, 15, 27],
    wing: [14, 20],
  },
  {
    airline: 'QK',
    family: 'DH8D',
    name: 'De Havilland Dash 8-400',
    seats: 78,
    cabins: [cabin('Economy', 1, 20, R22)],
    exits: [1, 11, 20],
    wing: [8, 13],
  },
  /* ---- Air Canada Rouge ---------------------------------------------- */
  {
    airline: 'RV',
    family: 'A319',
    name: 'Airbus A319',
    seats: 136,
    cabins: [cabin('Premium Rouge', 1, 3, AC_J22), cabin('Economy', 12, 32, Y33)],
    exits: [1, 15, 32],
    wing: [12, 20],
  },
  {
    airline: 'RV',
    family: 'A320',
    name: 'Airbus A320',
    seats: 168,
    cabins: [cabin('Premium Rouge', 1, 3, AC_J22), cabin('Economy', 12, 37, Y33)],
    exits: [1, 20, 21, 37],
    wing: [17, 26],
  },
  {
    airline: 'RV',
    family: 'A321',
    name: 'Airbus A321',
    seats: 200,
    cabins: [cabin('Premium Rouge', 1, 4, AC_J22), cabin('Economy', 12, 42, Y33)],
    exits: [1, 20, 31, 42],
    wing: [19, 30],
  },
  /* ---- KLM ------------------------------------------------------------- */
  {
    airline: 'KL',
    family: 'B737',
    name: 'Boeing 737-700',
    seats: 142,
    cabins: [cabin('Economy', 1, 24, Y33_KL)],
    exits: [1, 11, 24],
    wing: [8, 15],
  },
  {
    airline: 'KL',
    family: 'B738',
    name: 'Boeing 737-800',
    seats: 186,
    cabins: [cabin('Economy', 1, 31, Y33_KL)],
    exits: [1, 14, 15, 31],
    wing: [11, 19],
  },
  {
    airline: 'KL',
    family: 'B739',
    name: 'Boeing 737-900',
    seats: 188,
    cabins: [cabin('Economy', 1, 32, Y33_KL)],
    exits: [1, 15, 16, 32],
    wing: [12, 20],
  },
  {
    airline: 'KL',
    family: 'A21N',
    name: 'Airbus A321neo',
    seats: 227,
    cabins: [cabin('Economy', 1, 38, Y33_KL)],
    exits: [1, 13, 26, 38],
    wing: [14, 24],
  },
  {
    airline: 'KL',
    family: 'B789',
    name: 'Boeing 787-9',
    seats: 275,
    cabins: [
      cabin('World Business', 1, 8, J121_KL),
      cabin('Premium Comfort', 10, 12, PC232_KL),
      cabin('Economy', 14, 38, Y333_KL),
    ],
    exits: [1, 10, 28, 38],
    wing: [20, 31],
  },
  {
    airline: 'KL',
    family: 'B78X',
    name: 'Boeing 787-10',
    seats: 344,
    cabins: [
      cabin('World Business', 1, 10, J121_KL),
      cabin('Premium Comfort', 12, 15, PC232_KL),
      cabin('Economy', 17, 48, Y333_KL),
    ],
    exits: [1, 12, 34, 48],
    wing: [25, 38],
  },
  {
    airline: 'KL',
    family: 'B77W',
    name: 'Boeing 777-300ER',
    seats: 408,
    cabins: [
      cabin('World Business', 1, 9, J121_KL),
      cabin('Premium Comfort', 10, 12, PC232_KL),
      cabin('Economy', 14, 48, Y343_KL),
    ],
    exits: [1, 10, 30, 40, 48],
    wing: [23, 35],
  },
  {
    airline: 'KL',
    family: 'B772',
    name: 'Boeing 777-200ER',
    seats: 320,
    cabins: [
      cabin('World Business', 1, 8, J121_KL),
      cabin('Premium Comfort', 10, 12, PC232_KL),
      cabin('Economy', 14, 39, Y343_KL),
    ],
    exits: [1, 10, 27, 39],
    wing: [20, 30],
  },
  {
    airline: 'KL',
    family: 'A332',
    name: 'Airbus A330-200',
    seats: 268,
    cabins: [
      cabin('World Business', 1, 3, J222),
      cabin('Premium Comfort', 5, 7, PC232_KL),
      cabin('Economy', 9, 37, Y242_KL),
    ],
    exits: [1, 5, 24, 37],
    wing: [17, 28],
  },
  {
    airline: 'KL',
    family: 'A333',
    name: 'Airbus A330-300',
    seats: 292,
    cabins: [
      cabin('World Business', 1, 5, J222),
      cabin('Premium Comfort', 7, 9, PC232_KL),
      cabin('Economy', 11, 40, Y242_KL),
    ],
    exits: [1, 7, 26, 40],
    wing: [19, 31],
  },
  /* ---- KLM Cityhopper -------------------------------------------------- */
  {
    airline: 'WA',
    family: 'E75L',
    name: 'Embraer 175',
    seats: 88,
    cabins: [cabin('Economy', 1, 22, R22)],
    exits: [1, 12, 22],
    wing: [9, 16],
  },
  {
    airline: 'WA',
    family: 'E190',
    name: 'Embraer 190',
    seats: 100,
    cabins: [cabin('Economy', 1, 25, R22)],
    exits: [1, 13, 25],
    wing: [10, 18],
  },
  {
    airline: 'WA',
    family: 'E295',
    name: 'Embraer E195-E2',
    seats: 132,
    cabins: [cabin('Economy', 1, 33, R22)],
    exits: [1, 16, 17, 33],
    wing: [13, 23],
  },
  /* ---- Air Transat ----------------------------------------------------- */
  {
    airline: 'TS',
    family: 'A321',
    name: 'Airbus A321',
    seats: 199,
    cabins: [cabin('Club', 1, 3, AC_J22), cabin('Economy', 4, 35, Y33)],
    exits: [1, 13, 24, 35],
    wing: [12, 22],
  },
  {
    airline: 'TS',
    family: 'A21N',
    name: 'Airbus A321neo',
    seats: 199,
    cabins: [cabin('Club', 1, 3, AC_J22), cabin('Economy', 4, 35, Y33)],
    exits: [1, 13, 24, 35],
    wing: [12, 22],
  },
  {
    airline: 'TS',
    family: 'A332',
    name: 'Airbus A330-200',
    seats: 332,
    cabins: [cabin('Club', 1, 2, J222), cabin('Economy', 3, 42, Y242)],
    exits: [1, 8, 24, 42],
    wing: [18, 30],
  },
  {
    airline: 'TS',
    family: 'A333',
    name: 'Airbus A330-300',
    seats: 346,
    cabins: [cabin('Club', 1, 2, J222), cabin('Economy', 3, 44, Y242)],
    exits: [1, 8, 25, 44],
    wing: [19, 32],
  },
  /* ---- WestJet --------------------------------------------------------- */
  {
    airline: 'WS',
    family: 'B737',
    name: 'Boeing 737-700',
    seats: 134,
    cabins: [cabin('Premium', 1, 3, AC_J22), cabin('Economy', 4, 24, Y33)],
    exits: [1, 12, 24],
    wing: [9, 16],
  },
  {
    airline: 'WS',
    family: 'B738',
    name: 'Boeing 737-800',
    seats: 174,
    cabins: [cabin('Premium', 1, 3, AC_J22), cabin('Economy', 4, 30, Y33)],
    exits: [1, 15, 16, 30],
    wing: [12, 20],
  },
  {
    airline: 'WS',
    family: 'B38M',
    name: 'Boeing 737 MAX 8',
    seats: 174,
    cabins: [cabin('Premium', 1, 3, AC_J22), cabin('Economy', 4, 30, Y33)],
    exits: [1, 15, 16, 30],
    wing: [12, 20],
  },
  {
    airline: 'WS',
    family: 'B789',
    name: 'Boeing 787-9',
    seats: 320,
    cabins: [
      cabin('Business', 1, 4, J121),
      cabin('Premium', 5, 8, PY232),
      cabin('Economy', 12, 42, Y333),
    ],
    exits: [1, 12, 30, 42],
    wing: [21, 34],
  },
  /* ---- WestJet Encore -------------------------------------------------- */
  {
    airline: 'WR',
    family: 'DH8D',
    name: 'De Havilland Dash 8-400',
    seats: 78,
    cabins: [cabin('Economy', 1, 20, R22)],
    exits: [1, 11, 20],
    wing: [8, 13],
  },
  /* ---- Aer Lingus ------------------------------------------------------ */
  {
    airline: 'EI',
    family: 'A320',
    name: 'Airbus A320',
    seats: 174,
    cabins: [cabin('Economy', 1, 29, Y33)],
    exits: [1, 11, 12, 29],
    wing: [9, 16],
  },
  {
    airline: 'EI',
    family: 'A21N',
    name: 'Airbus A321neo LR',
    seats: 184,
    cabins: [cabin('Business', 1, 4, AC_J22), cabin('Economy', 10, 37, Y33)],
    exits: [1, 15, 27, 37],
    wing: [15, 25],
  },
  {
    airline: 'EI',
    family: 'A333',
    name: 'Airbus A330-300',
    seats: 317,
    cabins: [cabin('Business', 1, 8, J121), cabin('Economy', 12, 48, Y242)],
    exits: [1, 12, 30, 48],
    wing: [23, 36],
  },
  {
    airline: 'EI',
    family: 'AT76',
    name: 'ATR 72',
    seats: 72,
    cabins: [cabin('Economy', 1, 18, R22)],
    exits: [1, 18],
    wing: [7, 12],
  },
  /* ---- Porter ---------------------------------------------------------- */
  {
    airline: 'PD',
    family: 'E295',
    name: 'Embraer E195-E2',
    seats: 132,
    cabins: [cabin('Economy', 1, 33, R22)],
    exits: [1, 16, 17, 33],
    wing: [13, 23],
  },
  {
    airline: 'PD',
    family: 'DH8D',
    name: 'De Havilland Dash 8-400',
    seats: 78,
    cabins: [cabin('Economy', 1, 20, R22)],
    exits: [1, 11, 20],
    wing: [8, 13],
  },
]
