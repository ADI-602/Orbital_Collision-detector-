# CLAUDE.md — Orbital Risk Advisor

This file is the project's persistent context for Claude Code (or any coding agent working in this repo). Read this in full before writing or modifying any code. If something in a task request conflicts with this file, this file wins — flag the conflict to the human instead of silently picking one.

---

## 0. What this project is (read this first)

**Orbital Risk Advisor** is a debris collision-risk decision-support platform, built for a space-exploration hackathon judged by professionals (technical judges expected). It has two halves that must remain strictly separated:

1. **Physics pipeline** (Python) — real orbital mechanics. TLE ingest → SGP4 propagation → frame transforms → conjunction screening → TCA refinement → collision probability (Pc) → simplified maneuver modeling. This is deterministic, validated, testable code. **No AI/LLM is involved anywhere in this pipeline.**
2. **AI layer** (LLM via Claude API) — takes the _already-computed, already-validated_ output of the physics pipeline (Pc, miss distance, covariance summary, maneuver options) and produces plain-language explanation, tradeoff comparison, and a recommendation. **The AI never computes, estimates, overrides, or "sanity-checks" a physics number. It only narrates numbers it is handed.**

The core credibility claim of this project, repeated in the pitch, is: _"Real physics computes the risk. AI makes the risk understandable and actionable."_ Every architectural decision should protect this claim. If a proposed change would blur the line between the two halves, don't make it — ask first.

Full context lives in `/docs/project-doc.md` and `/docs/pitch-script.md` (copy the two source docs there at project start — see folder structure below). Read those for the full spec, validation test cases, and demo script before starting implementation work.

**Before starting any task, check `implementation-checklist.md` at the repo root.** It tracks phase-by-phase progress with hard gates (🔒) — e.g. Pc/AI-layer work must not start before frame transforms are validated, and demo/frontend work must not start before the Alfano and Envisat validation tests pass. Find the first unchecked item and work there; don't skip ahead of an unpassed gate even if a later task looks easy or was explicitly requested — flag the gate to the human instead of silently working around it. Update the checklist in the same session as the work, and only check an item off once it's actually validated, not merely implemented.

**Before writing or reviewing any code in `backend/physics/`, read `docs/physics-notes.md`.** It's a stage-by-stage reference covering what each pipeline stage does, the specific bug classes to watch for at each stage (frame-mixing in particular), and what to verify before trusting output. It exists alongside this file specifically because physics correctness is the project's highest-scrutiny area — treat it as required reading, not optional background.

---

## 1. Non-negotiable technical guardrails

These exist because the project will be judged by people who can and will check the physics. A wrong number here is worse than a missing feature.

### 1.1 Never reimplement solved orbital-mechanics algorithms

- Use the `sgp4` package (Brandon Rhodes' implementation) for propagation. Do not hand-write SGP4.
- Use `skyfield` (or `astropy` as a cross-check) for reference frame transforms and time systems. Do not hand-roll rotation matrices for TEME → ECI → ECEF.
- Implement Pc from a **published closed-form reference formula** (Foster/Chan/Alfano 2D encounter-plane method). Do not derive the Gaussian integral from scratch or approximate it without a cited source.
- If you (the agent) are about to write novel numerical code for any of the above from first principles instead of using the library/published formula, stop and flag it instead of proceeding.

### 1.2 Mandatory validation before anything is trusted or demoed

- **Alfano synthetic test case is a hard pytest regression test, not optional.** Known inputs must reproduce Pc ≈ 0.10034. This test must exist in the repo and must pass before any Pc-dependent feature is considered "done."
- **Frame transforms must be validated against a known reference** (e.g., propagate the ISS, convert frames, sanity-check resulting lat/long/altitude against a real public tracker) before any code builds on top of them. Write this as a script or test, not a one-off manual check that leaves no trace.
- **Envisat/Zenith-2 replay must reproduce published historical numbers in the right ballpark** (miss distance 81–316m, Pc 1.4×10⁻⁴–5.5×10⁻⁴ across the four prediction days) before it's used as the main demo. If your numbers are wildly off, that's a bug — do not adjust the demo narrative to hide it; fix the pipeline or surface the discrepancy.
- Never mark a physics feature complete based on "it ran without crashing." It's only correct if a validation case says so.

### 1.3 Strict separation between physics and AI

- The physics pipeline must be able to run, be tested, and produce output completely independently of the AI layer (no API key, no network call to an LLM required to get Pc numbers).
- The AI layer's input contract is structured JSON only (Pc, miss distance, hard-body radius, covariance summary, maneuver deltas, etc.) — never raw state vectors or an invitation to "estimate" anything numeric.
- The AI layer's output must never silently replace or restate a number differently than what it was given. If you're prompting the LLM, the prompt should explicitly instruct it to use the given numbers verbatim and only add interpretation/narrative.
- Any temptation to have the LLM "smooth over" a missing or off-looking physics value (e.g., estimate a plausible Pc because propagation failed) must be resisted. Missing data should surface as missing data, with a clear error state in the UI — never a plausible-looking fabrication.

### 1.4 Scope reductions must be explicit in code and docs, not hidden

The project doc already commits to these scope reductions. Do not silently expand or hide them — if the implementation matches the reduced scope, say so in code comments and README; if you must deviate, flag it:

- Conjunction screening: scoped candidate set, not full ~40,000-object catalog.
- Maneuver modeling: instantaneous delta-V effect on trajectory only — not thruster burn physics, fuel consumption, or full spacecraft dynamics.
- Pc method: 2D/encounter-plane method (industry standard), not a full 3D integral.

### 1.5 Numerical / scientific coding hygiene

- Always use explicit units in variable names or docstrings (km vs m, seconds vs days, degrees vs radians) — orbital mechanics bugs are disproportionately unit-mismatch bugs.
- Never mix TEME, ECI, and ECEF frame data without an explicit, named conversion step in between. A variable holding position data should make its frame unambiguous from its name or type.
- Log/print intermediate values (miss distance, TCA, Pc) during development runs so a bad number is traceable to a specific pipeline stage, not just visible at the end.
- Prefer raising a clear exception over returning `None`/`NaN`/a fallback default when a physics calculation can't complete. Silent fallbacks are how wrong demo numbers happen.

### 1.6 AI/LLM integration hygiene

- Never hardcode or invent citation-worthy scientific claims inside LLM prompts (e.g., don't have the prompt assert thresholds or formulas as fact unless they're sourced in `/docs`).
- Keep prompts and the structured-input schema version-controlled and reviewed like code, not tuned ad hoc in a notebook and forgotten.
- Handle LLM API failures gracefully in the UI (timeout, rate limit, malformed response) — the physics dashboard must remain usable even if the AI layer is down. This also protects the live demo.
- Never put an Anthropic API key or any secret in source, commits, or client-side code. Use environment variables and confirm `.env` is gitignored before the first commit.

### 1.7 General engineering guardrails (apply regardless of domain)

- Don't invent library APIs, config flags, or CLI options — if unsure whether something exists, check the actual installed package (docs, `--help`, source) rather than guessing plausible-sounding syntax.
- Don't touch `/docs` source files (they're reference material); write new docs elsewhere.
- Don't commit large data dumps (full TLE catalogs, etc.) to git — fetch live or cache locally and gitignore the cache.
- When a task is ambiguous between "quick hack for demo" and "correct implementation," default to correct, and say so if you had to choose — this project's whole pitch rests on being the team that didn't fake the science.
- Before declaring any physics-adjacent task "done," state explicitly which validation check (1.2) confirms it — don't just say "implemented."

---

## 2. Tech stack reference

**Backend / physics:** Python, `sgp4`, `skyfield`, `astropy` (cross-check), `numpy`/`scipy`, FastAPI
**Data source:** CelesTrak API (live TLEs, **no auth — there are no accounts**)
primary; Space-Track.org secondary; committed offline set as the floor

> **CelesTrak blocked this project's IP (2026-09-06).** DNS resolved, the whole
> rest of the internet was reachable, and the TCP handshake to
> celestrak.org:443 silently timed out — a firewall drop, not a rate-limit
> response. Contributing cause on our side: before the fix, a failed fetch was
> retried on *every* `/api/tracking/objects` request plus every monitor pass.
> That is now backed off 60 s and never runs on a request thread.
>
> Since CelesTrak has no accounts, this is IP-scoped and no registration can
> undo it. The response was `backend/data/offline_tracked_set.json` — a capped
> subset of real element sets the server falls back to, regenerated with
> `scripts/refresh_tracked_set.py` from any working network. **The demo no
> longer depends on a third party being reachable.** The offline set seeds
> INPUTS only; it is never selected for producing conjunctions (§5.2).
>
> **Space-Track is now the live source (2026-10-05).** CelesTrak was still
> blocked, so `backend/api/spacetrack.py` maps each tracked group to a
> Space-Track `gp` query (by international designator) and `tracked_set.py`
> uses it for any group CelesTrak cannot serve. Account-scoped, not IP-scoped,
> so it works from here. Measured: 700 live objects (stations + Cosmos 2251 +
> Iridium 33 debris), 41 real conjunctions on the first pass (1 YELLOW).
> **Rate limits are hard**: one login + one query per group per refresh, 6 h
> cache, 30 min backoff after a failure, no retry at all after a rejected
> login. Never poll it from a loop or a request thread. Tests must never reach
> it — `tests/conftest.py` blocks it suite-wide. The offline set is now
> regenerated from Space-Track by default (513 objects, capped per group).
**AI layer:** Google Gemini (`gemini-2.5-flash`), structured JSON in/out — see the provider note below
**Frontend:** React + Vite, CesiumJS (3D globe), plain per-component CSS, vitest
**Testing:** `pytest` (backend), `vitest` (frontend), with the Alfano case as a hardcoded regression test

Don't introduce a different orbital mechanics library, a different frontend framework, or swap the LLM provider without discussing it — these are pitch-relevant decisions, not incidental ones.

**LLM provider (decided 2026-08-31).** This file originally specified the Claude API; the implementation in `backend/ai/advisor.py` uses Gemini 2.5 Flash via `GEMINI_API_KEY`. That divergence was raised and the human chose to **keep Gemini** rather than switch before the demo. This is now the recorded decision, not an unnoticed drift — the AI layer's contract (structured JSON in, structured JSON out, narrates numbers it is handed, computes nothing) is provider-independent and unchanged. The deterministic offline fallback stays in place so the physics dashboard survives an AI outage on stage. Don't "fix" this back to Anthropic without asking.

---

## 3. How to work in this repo

- Read `/docs/project-doc.md` for full technical spec and the 4-week build plan; check which week's tasks are in scope before starting something out of order (e.g., don't build maneuver modeling before Pc is validated).
- Read `/docs/pitch-script.md` to understand what will actually be demoed — this should inform which edge cases matter (the Envisat and Cosmos 2221 scenarios specifically need to work end-to-end).
- Run relevant tests (`pytest`) after any change to `/backend/physics/`. If a physics test starts failing, treat it as a stop-everything bug, not something to patch around.
- Keep commits scoped and descriptive — judges or teammates may look at commit history as evidence of real, incremental engineering work rather than a last-minute dump.

---

## 4. Project layout

Top-level structure — a judge should be able to tell what's physics, what's AI, what's proof-of-correctness, and what's demo-facing from the root alone:

- `docs/` — spec, pitch script, and validation write-up (source of truth; don't edit `project-doc.md`/`pitch-script.md`, add new docs alongside them)
- `backend/physics/` — the deterministic orbital-mechanics pipeline; no LLM calls anywhere in this tree
- `backend/ai/` — the LLM explanation/recommendation layer (Gemini — see §2); only consumes physics output as structured JSON
- `backend/api/` — FastAPI routes tying physics + AI together for the frontend
- `tests/` — pytest suite, including the Alfano regression test and Envisat replay validation (must pass before demo)
- `frontend/` — React app (globe, countdown, dashboard, AI advisor panel)
- `demo/` — recorded fallback video + pre-demo checklist, kept current with the live pipeline

Within `backend/physics/`, keep pipeline stages in separate files matching Section 3 of `docs/project-doc.md` (TLE ingest, propagation, frame transforms, screening, TCA, collision probability, maneuver) rather than one large module — this keeps the physics/AI boundary and each validated stage easy to point to.

A short `docs/validation-notes.md` ("here's how we know our numbers are right") is worth writing early and keeping current — it's the single artifact most likely to earn credibility with a technical judge without them having to ask.

---

## 5. Demo target for the live console (agreed 2026-08-31)

The human set these requirements for the final demo. They are the destination
for the live-console half of the product; the Envisat replay (already built)
remains the correctness proof. Work toward these, and keep the guardrails in
§5.2 — they are what stop each requirement from quietly becoming a fake.

### 5.1 What the live console must do

1. **Run screening returns a populated list of real conjunction events.** Not
   an empty honest result — actual detections.
2. **Every event gets the Envisat treatment**: orbit shown, collision risk,
   TCA, the full detail panel.
3. **Selecting an event highlights it on the globe**, including the orbit
   tracks of the two objects involved.
4. **The post-maneuver orbit is drawn in a different colour** from the
   original trajectory, so the burn's effect is visible rather than described.
5. **Satellites and debris are visually distinguishable** for legibility on a
   projector.
6. **The AI layer advises on a selected high-risk event**, and screening runs
   automatically on an interval so a human does not have to press the button —
   a new high-risk detection raises a non-blocking alert carrying the AI's
   explanation.

### 5.2 Guardrails — how each of those stays honest

These exist because every requirement above has an easy fake version that
would look identical on stage and collapse under one judge's question.

- **"Ingested" means seeding INPUTS, never OUTPUTS.** The list is populated by
  pointing the pipeline at a larger, debris-rich candidate set (real TLEs from
  CelesTrak) so the real screening finds real conjunctions. Never seed,
  synthesise, or hardcode a Pc, a miss distance, a TCA, or a threat level.
  An empty result from a real run is a result; a populated list of invented
  numbers is the one thing that would end this project's credibility.
- **The AI never runs the screening.** Continuous monitoring is the *physics*
  pipeline on a timer. The AI is handed the results afterwards and explains
  them. Never describe it, name it, or label it in the UI as "AI screening" or
  "AI monitoring" — that phrasing inverts the project's core claim ("real
  physics computes the risk, AI makes it understandable") and a judge hearing
  it will reasonably conclude the LLM is doing the orbital mechanics.
- **The post-burn trajectory must come from the backend as a sampled
  ephemeris.** `/api/physics/maneuver` currently returns only scalars while
  computing a post-burn ECI state internally (`maneuver.py:141-162`); extend
  the endpoint to return pre-burn and post-burn tracks. Do NOT derive the
  post-burn orbit in the frontend — that is orbital mechanics in JavaScript,
  which §1.1 and §1.3 both forbid. Returning both tracks from one source also
  keeps the two drawn lines genuinely comparable.
- **Object-type colour must not compete with the risk scale.**
  `frontend/src/styles/tokens.css` defines exactly two colour systems
  (`--accent-*` chrome, `--risk-*` threat) and forbids mixing them. Encode
  payload / debris / rocket-body by **shape** plus a muted neutral tint, and
  leave colour meaning risk. Also: object type is parsed out of the CelesTrak
  name (`DEB`, `R/B`), which is a display heuristic — label it as one rather
  than implying authoritative catalogue metadata.

### 5.3 Known blockers, in the order they need solving

1. ~~The coarse filter is switched off.~~ **DONE, and it was worse than a
   switch.** The filter rejected pairs more than 15° apart in inclination,
   which deleted this project's own validation case: Envisat and the Zenith-2
   fragment are 27.2° apart, so screening reported *no event*. The check is
   backwards — a large plane difference is what produces a high relative
   velocity at encounter, so it preferentially discarded the most dangerous
   conjunctions. Removed, with a regression test. The apogee/perigee altitude
   check (Hoots, Crawford & Roehrich 1984) is sound and stays.
2. ~~One unusable candidate fails the whole batch.~~ **DONE.** Per-candidate
   failures are isolated in `backend/api/assessment.py`; a refused pair comes
   back inside `events` marked `unassessable` with the pipeline's own reason.
   Request-level failures (unparseable primary, malformed window) are now 400s
   rather than 500s, and unparseable candidates are named in
   `rejected_candidates`. `tests/test_screening_batch_isolation.py` pins it.
   `frontend/src/hooks/useScreening.js` no longer needs the per-candidate
   worker pool at all — it reads the scheduled pass instead (blocker 7).
3. **`parse_tle_pair` accepted garbage.** Handed "nonsense" it returned a
   usable satellite at catalogue number 0 with a 1999 epoch, which propagates
   and produces conjunctions with real objects. Now validates and raises
   `InvalidTLEError`. This mattered more once we ingest hundreds of TLEs.
   **DONE.**
4. ~~Maneuver endpoint does not return trajectories (see §5.2).~~ **DONE.** `/api/physics/maneuver` now returns
   `tracks`: the primary's coasting arc, its post-burn arc, and the secondary,
   sampled in ECEF from one TCA solution and one Clohessy-Wiltshire
   displacement — so a drawn line cannot contradict a reported number. The two
   arcs are identical to the bit before the burn instant, and the window is
   clipped at the CW validity horizon (~1 orbit) rather than extrapolating.

   **Measured, and it changes how this can be drawn:** the burn separates the
   two trajectories by 389 m at TCA and 538 m at most, across a 29,425 km arc
   — about 1:55,000. At globe scale the two lines are the same line, by a wide
   margin. "Different colour so the effect is visible" cannot be satisfied by
   drawing two orbit-scale tracks; the effect lives at the encounter, so the
   encounter has to be the thing shown. The sampled arcs also cannot resolve
   it (7.9 km sampled against a true 268 m at a ~16 s step and 15 km/s), which
   is why the exact TCA positions are carried separately and why a miss
   distance must never be measured off the arcs.

   So it is drawn twice. The globe carries both arcs — unflown in the event's
   risk colour, flown in the accent, since a planned burn is a proposed action
   and not a threat level — which shows WHERE the burn and the encounter sit in
   the orbit. `ManeuverPanel` then draws the encounter itself to scale, with a
   labelled scale bar: the three TCA positions projected into their own plane,
   which is an isometry, so every distance on the diagram is the true distance
   and nothing is exaggerated to look more dramatic. The labelled numbers still
   come from the pipeline's scalars, never measured off the picture.

   It lives on the Envisat replay first, because that view runs a 2004 clock
   and can draw 2004 trajectories against the objects they belong to. On the
   live console the arcs are drawn only for a LIVE event, for the same reason
   the injected case is not highlighted there.
5. ~~Orbit tracks are not rendered at all yet — only point markers.~~ **DONE.**
   Selecting an event draws one revolution of each object's orbit
   (`frontend/src/lib/orbitTrack.js`), in the event's risk colour, primary
   solid and secondary dashed so shape carries identity while colour keeps
   meaning risk. Sampling in TEME and rotating every sample by the SAME
   instant's GMST is what makes it a closed ring rather than a ground track,
   and it is what puts the marker exactly on its own ring — pinned by a unit
   test, because a ring the marker visibly floats off is worse than no ring.
   The ~25 km the ring fails to close by is real J2 drift over one revolution
   and is left alone rather than stitched shut. This is the marker's own path
   from the same element set, so it stays inside the visualisation layer;
   blocker 4's POST-BURN track is a different claim and still has to come from
   the backend.
6. ~~Frontend still fetches its own TLEs from CelesTrak.~~ **DONE.** The server
   owns the tracked set (`GET /api/tracking/objects`) and
   `useLiveSatellites.js` reads from there, so the globe and the event list
   describe the same objects.
7. ~~The event list ran its own screening and could not reach the scheduled
   results.~~ **DONE.** `useScreening.js` posted one
   `/api/physics/screening` request per candidate — workable against ~20
   station objects, hopeless against ~700, so the button was capped off at 40
   and the panel sat permanently empty while the server held real detections.
   It now reads `GET /api/monitoring/events` (the last completed pass, served
   from cache) and merges the injected Envisat case. The cap is gone; REFRESH
   re-reads, SCREEN NOW asks for a fresh pass and returns immediately.
   Coverage honesty moved with it: a pass whose refinement was capped
   (`stats.truncated`) is never described as a complete screening, and
   `frontend/src/lib/monitoring.js` refuses to infer completeness from an
   absent `truncated` field.

### What the screening architecture actually became

Measured, not assumed. A full all-pairs pass over ~700 objects is roughly
1.6 hours, and no tuning makes it a click — the cost is inherent to resolving a
5 km encounter at 15 km/s on a sampled grid. So screening runs on a timer
(`backend/api/monitoring.py`) and the API serves the last completed pass
instantly. That is also how real conjunction assessment works: scheduled
screenings, published results, not a button an operator waits on.

Three stages, cheapest first (`backend/physics/screening.py`):

1. `_cache_ephemerides` — one propagation per object rather than per pair.
   `screen_pair` propagates both its objects every call, so all-pairs cost
   O(N²) propagations for O(N) objects' worth of information.
2. `_gate_pairs` — vectorised, with a **rigorous lower bound** on the true
   minimum computed per sample interval. Never an answer; only a gate. A
   sampled minimum overstates a real approach by up to 2.8× at 60 s.
3. `screen_pair` — the validated de-aliasing refinement. Every reported
   separation comes from here.

Measured on 695 real objects over 24 h: 241,165 pairs evaluated, 5.1% gated,
33 real conjunctions found when refining the closest 300. **Threat spread from
live data: 0 RED, 1 YELLOW, 32 GREEN** — which is why §5.1's populated list
pairs real detections with injected historical cases for the high-risk rows.

`PHYSICS_TRACE=1` re-enables the per-stage prints (`backend/physics/trace.py`);
they are off by default because all-pairs screening would otherwise emit tens
of thousands of lines per pass.

Agreed build order: **backend scaling first** (blockers 1-2 and the wider
candidate set), because every other requirement needs the event list to
actually contain events before it has anything to act on.

Whenever `backend/physics/` changes for any of this, run `pytest` — the Alfano
case and the Envisat replay are the regression tests that say whether the
change was safe, and a failure there is a stop-everything bug (§1.2, §3).
