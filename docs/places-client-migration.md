# The places layer, on the client

What the React client does with `/api/places/*`, and what it means for the
Wikipedia-based "sights" it is taking over from. The server contract is
`docs/places-layer-contract.md`; this is only the client half.

## What was added

| File | What it is |
| --- | --- |
| `app/src/places-core.ts` | Pure presentation: confidence bands, attribution notices, grouping, the words for a degraded answer. No React, no fetch. |
| `app/src/features/places/api/places.ts` | `searchPlaces`, `placeById`, `nearbyPlaces`, and `sightsNearby`. |
| `app/src/features/places/ui/place-search.tsx` | The typeahead in the stop editor. |
| `app/src/features/places/ui/place-attribution.tsx` | The licence line under anything drawing places. |
| `app/src/features/places/index.ts` | The slice barrel. |
| `app/tests/places-core.test.js` | `npx tsx --test tests/places-core.test.js` — for the integrator's list. |

### Confidence

Two thresholds, in `places-core.ts`: at or above **0.75** the record is *firm*,
at or above **0.5** it is *reported*, and below that it is *rough* and carries
a "Roughly located" hint beside it. A record with no confidence at all is
treated as rough, because we will not claim a precision nobody stated.

Nothing is ever hidden for being doubtful. Overture's measured mean is 0.665,
so a threshold that hid the doubtful records would hide most of the world; the
honest version shows the record and says what it is.

### Attribution

`creditsFor(places)` returns the minimum set of notices for what is on screen,
deduplicated by **licence**, not by record — twenty ODbL rows are one
"© OpenStreetMap contributors". CDLA-Permissive and Apache-2.0 demand no notice
but their sources stay nameable, and a licence this build has never heard of is
rendered rather than dropped: an ugly line is survivable, a missing attribution
is not.

### Degraded answers

A list that comes back `degraded` draws a sentence — "Still gathering places
here — this is what we have so far." — instead of a spinner that never ends.
`failed` and `empty` coverage get their own wording.

## The stop editor

The integration point is the stop's **Name** field, in
`app/src/features/itinerary/ui/stop-editor.tsx`. It was a plain text input; it
is now `PlaceSearch`, which is the same text input with an offer attached.

The rule the component exists to hold: **the search is an offer, never a gate.**
Whatever is typed is the stop's name the moment it is typed. Choosing one of
the offered places adds only what the choosing knows — exact coordinates, and
`placeId`. "Gran's house" stays a stop like any other, and a stop renamed away
from the record it was matched to drops the match rather than carrying a stale
id.

`placeId` rides on the ordinary stop create and update bodies, camelCase like
`sourceUrl`, and is sent on every update including as `null` so that dropping a
match is as saveable as making one. **The server must map `placeId` to the
`stops.place_id` column added in migration 043**, in the same `allowed` table
as `sourceUrl` → `source_url` in `server/src/postgres.js`. Until it does, the
field is ignored and everything else works unchanged — which is why free-text
stops were never waiting on any of this.

## Sights nearby

`sightsNearby()` asks `GET /api/places/nearby` with **no** category filter. The
`sights` category is one of the twenty and the obvious thing to ask for, but
the server's nearby ranking already weights sights highest and then museums,
galleries and the rest — filtering to the one category would throw away the
Rijksmuseum to keep a bridge.

`app/src/features/sights/api/find-sights.ts` is **not** deleted. It is marked
superseded at the top of the file and still runs the "Sights nearby" panel,
because it holds two things the places layer cannot reproduce from data we own:
a human-written description for the card, and readership — the only free stand-
in for "worth going to", and the reason the panel's list is not forty canals
with the Rijksmuseum missing.

## What changes, what is retired, what is kept

**What changes for users.** Naming a stop now offers matches as you type,
anywhere on earth, from data we hold: each one showing what kind of place it is
and its address, so two pubs called The Crown are visibly two pubs. Picking one
drops the pin exactly where the place is instead of wherever the map was
clicked. A match we are unsure of says "Roughly located" rather than pretending.
A region we have not finished ingesting says so in a sentence instead of
spinning. Every screen showing places credits where they came from. Typing a
name that matches nothing is unchanged: it makes the stop, as it always did.

**What is retired.** Nothing yet, for users. Internally: the stop editor's plain
name input, and — the moment the panel can show a description without it —
`find-sights.ts` and its Wikipedia geosearch, ranking by readership, batching in
twenties and per-browser cache. No new work goes into that file.

**What is kept.** The Wikipedia path in full, running the "Sights nearby" panel
and the attraction pins on the map, together with the descriptions, pictures and
readership ranking that only it has. Free-text stops, which are the normal case
and always will be. "Fill in from Wikipedia" in the editor, which is still the
only thing that writes a paragraph into a stop's note. And every stop already on
a trip: none is rewritten, re-matched or moved by any of this.
