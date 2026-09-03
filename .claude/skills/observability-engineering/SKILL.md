---
name: observability-engineering
description: Apply the Observability Engineering (Majors, Fong-Jones, Miranda — Honeycomb/O'Reilly) standard to Off We Go. Load whenever writing or reviewing server code, integrations, background work, or debugging production — the bar is "diagnose any novel failure from telemetry alone, without shipping new code or opening a shell."
---

# Observability Engineering, applied to Off We Go

Source: *Observability Engineering* (Charity Majors, Liz Fong-Jones, George
Miranda; O'Reilly). This skill is the book's method reduced to rules for this
repo. The one-sentence test the book gives: **can you understand any novel
internal state of the system purely by interrogating its telemetry from
outside, with no new code and no prior knowledge of that failure mode?** If
the answer is no, the work is not done.

## The core ideas, in order of importance

1. **Observability ≠ monitoring.** Monitoring (dashboards, alerts, health
   checks) covers *known* failure modes you predicted in advance. Observability
   is for *unknown-unknowns* — the failures nobody predicted, which is most of
   the interesting ones. Dashboards answer questions you already asked;
   observability lets you ask new questions of data you already collected.

2. **The unit of telemetry is the arbitrarily wide structured event** — one
   event per service per unit of work (the "canonical log line"), not scattered
   log lines, not pre-aggregated metrics. Everything known about that unit of
   work rides in one record: who, what resource, every domain fact, sub-step
   timings, upstream statuses, versions, outcome, error cause.

3. **High cardinality and high dimensionality are the point, not a problem.**
   The most valuable debugging fields are exactly the ones metrics systems
   reject: `user.id`, `trip.id`, request id, device id. A novel incident is
   found by grouping/filtering on *some* dimension until the failing population
   separates from the healthy one (the book's "core analysis loop"). Every
   dimension you didn't record is a question you can't ask.

4. **Correlation over narration.** Events link by request id (and trace/span
   ids across services). A request's story is assembled by *querying its id*,
   not by reading adjacent lines and guessing.

5. **Instrument as you build (observability-driven development).** Telemetry
   ships in the same diff as the feature. After deploying, you *watch the
   feature work in production through its own events* — that observation, not
   the green CI run, is the definition of done.

6. **Debug from the data, not from intuition.** Start from "what is different
   about the failing events" (slice by any field), not from a hypothesis you
   try to confirm. Intuition picks the dimension to slice next; the data
   decides.

## How this repo implements it

- **Wide events**: every API request emits one `evt: "request"` record from the
  `onResponse` hook in `app/server/src/app.js` — method, route template,
  status, duration, pino's request id — merged with whatever the handler
  stamped on `request.wide`. Handlers MUST stamp the high-cardinality facts
  they touch: `request.wide.userId`, `tripId`, `mode`, counts, upstream
  latencies, model names, outcome/cause on failure. If you handled it, stamp
  it.
- **Unit-of-work events beyond HTTP**: MCP tool calls emit `evt: "mcp.tool"`
  (tool, userId, tripId, ms, failed); the AI assistant emits its ask outcome on
  the request event (model, canEdit, ms, error cause). Anything that does work
  on behalf of a person emits one wide event with that person's id on it.
- **Upstream dependencies** (Valhalla, codex, Microsoft, Logto): every refusal
  logs upstream **status + body snippet + latency**; every timeout carries the
  stderr/cause tail. "It failed" without the upstream's own words is a rule
  violation — it cost us a container-archaeology session once
  (the CA-certificates outage, 2026-09-03: codex hung for months of user-minutes
  because a timeout error discarded stderr).
- **Queryable store**: docker logs ship via Alloy to Grafana Cloud Loki
  (`app/deploy/alloy-config.alloy`). LogQL + `| json` is our slice-by-any-field
  engine. A signal that only exists in `docker logs` on the box does not count
  as observability.
- **Health is config truth**: `/api/health` `connectors` reports which optional
  integrations this deployment actually has (outlook, assistant, routing) —
  the first question of any incident ("is it even configured?") answerable
  from outside.

## Rules for new code

1. One wide event per unit of work; stamp `request.wide` rather than emitting
   extra log lines mid-request. Multiple narrative lines per request are a
   smell; a second line is justified only for an upstream failure's evidence.
2. Never drop a dimension you have in hand: ids, enums, counts, flags,
   durations, cache hit/miss, upstream status. Storage is cheaper than a
   3 a.m. question you can't ask. (No PII: emails, names, free text, tokens,
   coordinates of people's homes stay out; opaque ids are fine and wanted.)
3. Every upstream call records latency always, and status + body-snippet on
   failure. Timeouts carry whatever partial evidence exists (stderr tail,
   bytes so far).
4. Failure handling must leave a queryable trail *before* degrading
   gracefully. Degrade-to-absence UI is good; silent degrade-to-absence
   telemetry is forbidden.
5. Route templates in events (`/api/trips/:tripId/legs`), raw values as
   fields — keeps grouping low-cardinality while the fields stay rich.
6. New optional integration ⇒ new key under `/api/health` connectors, and a
   boot-time event naming its configuration (never its secrets).
7. Definition of done for a feature includes: deploy, then read the feature's
   own wide events from Loki and confirm real traffic behaves. State the LogQL
   you used in the PR/report. ("It passed CI" is monitoring; this is
   observability.)

## Debugging protocol (the book's core analysis loop)

1. State what the user experienced, as an event filter (route, status, userId,
   time window).
2. Pull the wide events for that population. Compare against the healthy
   population: which dimension separates them? (model? mode? one tripId? one
   deploy sha?)
3. Follow the request id to every event it produced; the upstream
   status/body/latency fields name the failing dependency.
4. Only after telemetry runs dry do you reach for repro/shell — and the gap it
   exposes becomes instrumentation added in the fix's diff.

## Anti-patterns (the book's, seen locally)

- **Three-pillars theater**: shipping metrics + logs + traces that don't share
  ids answers nothing; correlation is the product.
- **Pre-aggregation**: recording only counters/averages destroys the ability
  to isolate one user's bad afternoon. Keep raw events; aggregate at query
  time.
- **Dashboard-driven debugging**: a wall of pre-built graphs is the list of
  questions you already thought of. Incidents live in the ones you didn't.
- **Narrative logging**: `log.info('starting X') … log.info('X done')` tells a
  story to a human reading sequentially and answers no query. Fold it into the
  wide event.
- **The invisible integration**: an optional dependency that fails by quietly
  showing nothing. (See rule 4; see the CA outage.)
