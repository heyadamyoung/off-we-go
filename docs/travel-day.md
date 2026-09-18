# The travel day: how the airports' word should reach a family

The flight intelligence layer (see `flight-intelligence.md`) reads Dublin's and
Regina's boards and writes what they say onto the legs. This is the design for
what a family sees of it on the day: what the best flight apps get right, what
they cannot do that Off We Go can, and the surfaces that follow. It ends with
what was built from it.

## 1. What a travel day is

Not a flight. A sequence of hard deadlines with people spread across a city,
then an airport, then the sky, then a belt, and someone at home watching the
whole thing. Read hour by hour, the questions are:

| When | The question | Who asks |
| --- | --- | --- |
| The evening before | Is it still on, which terminal, what time do we leave? | travellers |
| Home or hotel, T−6h to T−2h | When do we leave, each of us? | each traveller |
| The airport, T−2h to boarding | Which desks, how long is security, which gate, how far? | travellers |
| Boarding to doors | Go to gate / boarding / final call; is everyone here? | the one who got there first |
| In the air | Did they leave, when do they land? | home |
| Landed | Which belt, are they out, where do we meet? | home and the driver |
| Connections | Will the second leg wait for the first? | everyone |

Every row is answerable today with what the app already holds: the legs and
their deadlines, everyone's live position, the papers, the map, and now the
boards.

## 2. What the best apps do, and where they stop

- **Flighty** is the standard for one person and one flight: a status headline
  in words, times with the old ones struck through, a phase timeline
  (check-in, boarding, departed, landed), "where is my plane" from the inbound
  aircraft, the plane on a map, a Lock Screen card, and pushes it claims beat
  the airline's. It stops at the person: no family, no positions against
  deadlines, no trip around the flight, and a subscription.
- **TripIt Pro** owns the itinerary and the alert: delays, gate changes, "Go
  Now" (leave for the airport, from traffic), alternate flights, layover
  guidance. It stops at the itinerary: nothing live about the people, a dated
  surface, alerts that read like email.
- **App in the Air** draws the phases as a timeline and adds auto check-in and
  airport tips, at the cost of clutter.
- **Airline apps and Apple Wallet** are the authority for the pass and the gate,
  when the airline pushes; slow, one airline at a time, nothing about anyone
  else.
- **Google** puts a card in Gmail and predicts delays; broad and shallow.

None of them show a mother that her son is twelve minutes from the gate with
nine to spare, or tell a grandparent that the plane has landed and the bags are
on belt five before the phones come out of airplane mode.

## 3. What only this app can do

1. **The family as the unit.** Positions against deadlines, per person, with a
   verdict each; "who is here" at the gate; a leave-by time for whoever is
   still at home.
2. **The trip as the context.** The leg chained to the stops before and after,
   the papers one tap away and offline, the same map the family follows all
   week.
3. **The people at home on the same board.** A follower sees the same card,
   gets the landing and the belt from the airport rather than from a phone
   that has to find a signal first.
4. **Provenance.** Every live fact says where it came from and how old it is.
   Travellers trust "Dublin Airport says" over "we say", and a board that has
   gone quiet is said to have gone quiet rather than shown as fresh.

## 4. Principles

1. **Lead with the answer, in words.** One headline per leg: "On time · gate
   106 · boarding in 42 min", "Delayed 55 min, leaves 19:30", "Landed 23:28,
   bags on belt 5". Never a raw status word.
2. **Show the delta.** Old time struck through beside the new, old gate beside
   the new, "+55 min" beside "Delayed".
3. **Time is the backbone.** The phases are the deadlines the app already
   derives; actuals from the board replace the plan as they happen; the
   countdown is always to the next hard thing.
4. **Progressive disclosure.** The capsule over the map is one line. The card
   it opens is the leg block and who is where. The leg on the Travel tab is the
   whole board: phases, where, the airport's trail. The paper is one tap from
   any of them.
5. **Say the source and the age.** "Dublin Airport · 2 min ago". A board that
   has not answered for a while: "the board has not answered since 12:04;
   showing what it last said". An airport with no board: say so, and offer
   the airline.
6. **Notify on change, once, to the right people.** Travellers: gate, delay,
   boarding, final call, cancellation. Home: departed, landed, belt. Nothing
   twice, nothing on schedule.
7. **The map stays the hero.** The gate on the indoor map (exists); the plane
   on the map while it is in the air, over the family's own dots.
8. **Offline is the default.** The board's last word rides with the legs, so
   the day works at a desk with no signal.

## 5. The surfaces

### The leg on its day: the board

The card a leg wears on its day (`segmentFace === 'day'`) becomes the board:

- **Headline** in words with the tone (ok, tight, late), built from the
  board's status, the delta and the next deadline.
- **Times**: departure and arrival big, the old struck through, the airport's
  own clock; actual times take over once the board gives them.
- **Phases**: check-in → bags → security → gate → boarding → doors → departed →
  landed → bags, each done (✓ with its time), now (the countdown), or later
  (its time). Built from the deadlines the app derives and the board's
  actuals.
- **Where**: terminal, gate with its old value, check-in zone and desks, walk
  to the gate in minutes, belt on arrival; the security queue in minutes where
  the airport publishes it (Dublin does).
- **Who is where**: every traveller with a fix, against the current phase's
  deadline, with the walk to the gate counted; and for anyone still away, a
  leave-by time.
- **Source line**: which board, how old, and whether it has gone quiet.
- **The trail**: what the airport said, newest first, opened on demand.

### The capsule and the now card

On a travel day the capsule leads with the live leg: "✈ KL 677 · boarding in
42 min · gate E19". The card it opens carries the leg block first (headline,
gate, the airport's last word, the papers), then who is where, then the day's
stops and pictures as today. A follower's card leads with the airport's news.

### Notices and notifications

The airport's sentences join the notices: a follower who opens the app is told
"KL 677 has landed at 06:10. Dublin Airport, 06:12." first, before the
arrivals and the pictures; a landing the board reported is not announced twice
when the trail also notices it. On a phone that is running, a changed sentence
is said once (built). The Lock Screen card follows the leg (built).

### The plane on the map

While a leg is airborne and ADS-B hears it, its position is drawn on the trip
map with the aircraft's heading, refreshed each minute, so the family at home
watches the plane cross on the map they already know.

### What is not built, and why

- **Where is my plane (the inbound aircraft).** Needs the airframe's rotation,
  which no public board gives. Flighty buys it. Documented as the first thing
  a paid feed would add.
- **Time to leave from traffic.** The leave-by time is from the same pace
  arithmetic the make-it meter uses; road time from the routing engine is the
  next step and the engine is already in the stack.
- **Pearson live.** Best effort until the GTAA partner API; the far end's board
  and ADS-B cover the leg.

## 6. What the boards give you, and what only the pass has

Everything a traveller would otherwise stand and read off the departures
board is on the ticket, as columns: TERMINAL, GATE, CHECK-IN, WALK TO GATE,
SECURITY, BELT — always the same headings for a flight, a dash under the
ones the board has not filled in, so nothing moves when it does. Per airport
(recorded by the source probe, 17 September 2026):

| Column | Dublin (`api.dublinairport.com`) | Toronto Pearson (`torontopearson.com`) | Regina (`yqr.simpleway.cloud`) |
| --- | --- | --- | --- |
| Terminal | `terminalName` (T1/T2) | `term` (T1/T3) | not published (one terminal) |
| Gate | `gate` | `gate` | `GATE` |
| Check-in | `checkinZone` ("13") and `checkinDeskRange` ("1204-1319") | `zone` is the run of counters ("169-182"), `aisle` the airport's own name for where they are ("Aisle 5") | not published |
| Walk to gate | `walkTime` (minutes) | — | — |
| Security | `/dap/get-security-times` per terminal, minutes | not verified (GTAA publishes wait times on its site; the endpoint is not confirmed) | — (CATSA publishes for larger airports; not verified) |
| Belt | `baggageBelt` on arrivals | `carousel` | `CAROUSEL` |
| Stand | — | `stand` | — |
| US pre-clearance | `requiresPreClearance` | (the region is `termzone` USA/INTL/CAN) | — |
| Go-to-gate time | `goToGateTime` | — | — |

What is on a boarding pass and on no board — the boarding group or zone,
the sequence number, the fare class, the gate and boarding time printed at
issue — lives in the pass's own barcode (IATA BCBP: a PDF417 on paper, an
Aztec or QR on a phone). The app already keeps the passes as images and
PDFs; decoding the barcode on upload is the next step and needs a barcode
reader in the client, which is why it is not in this build.

## 7. What was built

- **The ticket.** Every leg on its eve and its day is a ticket: the route
  and times, then the columns above with a dash until the board says. The
  seats and the papers stay on it; a changed gate keeps the old one struck
  through in the column.
- **The day face.** The answer on top in words with a tone — "On time · gate
  E19 · check-in closes in 2 h 10", "Delayed 55 min · leaves 21:55", "Go to
  gate 406 · 12 min walk", "Landed 22:41 · bags on belt 5" — never a raw
  status word; the phases underneath (check-in, bags, to the gate, boarding,
  doors, departs, lands, belt) each done, now or later, with leaving and
  landing the board's to call; the source line ("Dublin Airport · 2 min ago
  · ON SCHEDULE"), which calls a quiet board quiet; and the airport's trail,
  newest first, on demand.
- **The board's word rides on every leg** (`segment.flight`, projected by
  `server/src/flights/on-leg.js` onto the segments list), so the ticket,
  the pill, the Lock Screen and the offline pack all have it without a
  second fetch.
- **Dublin's security queue** is read every minute and written onto the leg
  for the terminal it leaves from, until it has left.
- **The make-it meter** counts the walk from the door to the gate against
  everybody and tells whoever is still away when to leave.
- **The pill and the now card** lead with the live leg on its day: "✈ KL 677
  · On time · gate E19 · check-in closes in 2 h 10", and the card opens on
  the ticket's headline, its columns in a line, the board and its age, and
  the papers.
- **The airport's sentences are notices**: a follower who opens the app is
  told "KL 677 has landed at 06:10. Dublin Airport, 06:12." first, and a
  landing the board reported is not announced twice when the trail also
  notices it. On a phone they come first in the buzz.
- **The Lock Screen card follows the board**: boarding when the board says
  go to gate, airborne when it says departed, landed when it says so.
- **The plane on the map** while a leg is plausibly in the air, from the
  transponder network by the callsign the airline files, once a minute
  through the server's cache, pointing the way it is going.
- **Pearson's desks and aisle** land in the same columns as Dublin's; Regina
  fills the gate and the belt and nothing else, because that is all its
  board publishes.
