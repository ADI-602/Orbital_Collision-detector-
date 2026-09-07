# Frontend Implementation Plan — Orbital Risk Advisor

This is the working plan for Phase 5 ("Frontend + integration") of
`implementation-checklist.md`. It covers the technical build plan (API
integration, component structure, build order) and the UX/screen structure,
so it can double as a build checklist and a Figma reference.

The backend (Phases 1-4) is complete and validated — 49/49 tests passing.
Nothing here changes backend code; this doc is the frontend build plan only.

---

## 1. Overview & goals

> **Framing correction (2026-08-31).** The paragraph below, and several later
> sections, read as though stepping through the Envisat event were the
> product's core loop. It is not. **The system is general-purpose**: it detects
> close approaches between *any two tracked objects*, computes Pc, and
> recommends a maneuver. Envisat is one **proof of correctness** — a real 2004
> conjunction whose published numbers the pipeline reproduces — shown in its
> own dedicated view and framed as validation. Manually injected close-approach
> cases play the same role for detection. Build every conjunction surface to
> take an arbitrary object pair; never hardcode a scenario.


Build a React + CesiumJS console that visualizes conjunction risk (satellite
close-approach events), lets a user step through the historical Envisat vs.
Zenith-2 debris event of October 2004, and surfaces AI-generated plain-English
risk explanations alongside the underlying physics numbers.

**The physics/AI boundary must stay visible in the UI.** Per
`docs/architecture.md` §1, the AI layer never computes or alters a physics
number — it only explains, compares tradeoffs, and recommends based on
numbers the physics pipeline already produced. The frontend must not blur
this: AI text is always rendered as commentary *on* a number the physics
panel already shows, never as the source of the number itself. When the AI
is in fallback mode (`is_fallback: true`), the UI must say so visibly rather
than silently presenting rule-based text as if it were live AI output.

---

## 2. Known discrepancies (read this before wiring anything)

1. ~~**`docs/api_contract.md` is stale.**~~ **RESOLVED (Phase 5 step 1).**
   `docs/api_contract.md` has been rewritten from `backend/api/main.py` and
   verified against commit `bfe5bd4`. All response examples in it are now
   captured from a live server rather than invented. It is again a usable
   source of truth; re-verify it whenever a route changes.
2. **AI provider mismatch.** `CLAUDE.md`, `backend/README.md`, and
   `.env.example` all reference `ANTHROPIC_API_KEY` (Claude), but the actual
   code in `backend/ai/advisor.py` calls **Google Gemini**
   (`gemini-2.5-flash`) via `GEMINI_API_KEY`/`GOOGLE_API_KEY`. The frontend
   should never assume which provider is live — it only needs to trust the
   response shape (`AIAdvisorResponse`) and the `is_fallback` flag.
3. **No live-satellite-position endpoint exists.** There is no
   `/api/satellites/live` and no endpoint that returns a pre-computed replay
   timeline. The frontend must source TLEs from `/api/conjunctions/envisat`
   and compute per-day miss-distance/Pc itself by calling
   `/api/physics/tca` / `/api/physics/screening` for each of the 4 historical
   days. Cosmos 2221 (the secondary scenario) has no dedicated endpoint
   either — source its TLE pair from `tests/fixtures` (confirm exact fixture
   name when implementing) and drive it through the same physics endpoints.

   **Resolved in step 4 for the live path:** candidate TLEs come from the
   client's own CelesTrak feed. `useLiveSatellites` now keeps each record's raw
   `line1`/`line2` and `useScreening` posts them to `/api/physics/screening`,
   which re-propagates them with the validated Python `sgp4`. Only the raw
   element sets cross — never a position satellite.js computed.

4. ~~⚠️ **One unusable pair fails the whole screening batch.**~~ **RESOLVED,
   and then made moot.** The backend now isolates per-candidate failures
   (`backend/api/assessment.py`), and the frontend no longer runs screening at
   all — it reads the scheduled server-side pass. See §13. The historical note
   below is kept because it explains why `useScreening.js` looked the way it
   did.

   ⚠️ **One unusable pair fails the whole screening batch.**
   `compute_pc` raises on a stationary pair
   (`backend/physics/collision_probability.py:234`) and the route turns any
   exception into a 500 for the entire request
   (`backend/api/main.py:241-246`). Since the live tracked set is CelesTrak's
   `stations` group — where ISS, POISK and NAUKA share element sets — the
   batch form returns 500 every time and no candidate is ever assessed.
   Step 4 works around this in the frontend by screening **one candidate per
   request** (`useScreening.js`), which costs the backend the same total work
   and turns a refused pair into one labelled row. **The backend-side fix —
   skipping an unusable candidate instead of failing the batch — is still
   open**, and is worth doing before the candidate set grows.

---

## 3. Real backend routes (source of truth)

Confirmed from `backend/api/main.py` and `backend/ai/schema.py`:

| Path | Method | Purpose | Notes |
|---|---|---|---|
| `/health` | GET | health check | poll once on app load |
| `/api/conjunctions/envisat` | GET | Envisat/Zenith-2 replay ground truth | returns raw TLE pairs for 4 prediction days (Oct 19–22, 2004). **TLEs only — no miss distance, no Pc**, despite the endpoint docstring |
| `/api/physics/tca` | POST | TCA + miss distance from two raw TLEs | body: `{primary: {name, line1, line2}, secondary: {name, line1, line2}, start_utc_iso, search_duration_hours}` — **corrected**; the earlier `{tle1_line1, ...}` shape in this table was wrong |
| `/api/physics/screening` | POST | screen candidate TLEs vs. primary | returns Pc/miss-distance/threat-level per candidate |
| `/api/physics/maneuver` | POST | simulate a delta-V burn | returns pre/post Pc, fuel used, post-burn miss distance |
| `/api/ai/advise` | POST | AI decision support (Gemini, degrades to rule-based fallback) | body: `ConjunctionContext` + `ManeuverOption[]`; response: `AIAdvisorResponse` (`executive_summary`, `risk_assessment`, `recommended_action`, `tradeoff_analysis`, `key_metrics`, `is_fallback`) |

All physics POST endpoints take **raw TLE line1/line2 pairs** in the body —
there is no "look up by NORAD ID" convenience. The full request/response
JSON schemas are self-documenting at `http://localhost:8000/docs` (Swagger
UI) — check that first when writing the API client, rather than
re-deriving field names from source.

Known edge case (from `tests/test_api_endpoints.py`): `/api/physics/tca` and
`/api/physics/maneuver` can 404 when no close approach is found in the
search window — the API client and UI must handle this as a normal "no
conjunction" state, not a crash.

---

## 4. Environment setup

- `CESIUM_ION_TOKEN` currently exists **without** a `VITE_` prefix in the
  root `.env`. Vite only exposes env vars prefixed `VITE_` to client code, so
  this token as-is is **not** reachable from frontend source.
- Action needed: add a `frontend/.env.local` (gitignored, same as root
  `.env`) with:
  ```
  VITE_CESIUM_ION_TOKEN=<same value as root CESIUM_ION_TOKEN>
  VITE_API_BASE_URL=http://localhost:8000
  ```
- Per `docs/architecture.md` §4, the Cesium Ion token is scoped to
  `assets:read` only (no write/private scopes), so it's designed to be safe
  to reference client-side — still load it via `import.meta.env`, never
  hardcode it in a component.

---

## 5. App structure — a view-state console, not a multi-page site

Think of this as one app shell with view states, not separate routed pages
(matches how the design/Figma pass was scoped):

1. **Landing / Intro** — futuristic hero, mission branding, single CTA into
   the console. Optional: a fake "connecting to tracking network..." boot
   sequence for demo flavor.
2. **Main Console** (the core screen) — HUD layout, globe as the dominant
   center layer with floating glass panels over it:
   - **Header bar** (persistent): UTC mission clock, overall system risk
     level, AI status badge (`LIVE` vs `FALLBACK (physics-only)` driven by
     `is_fallback`)
   - **Globe (center)**: Earth, satellite/debris points, orbit paths, and a
     highlighted line connecting the two objects at TCA when a conjunction
     is selected
   - **Event list panel**: conjunction candidates from `/api/physics/screening`,
     sorted by risk level, color-coded + icon-coded (not color-only)
   - **Event detail panel**: miss distance, Pc, relative velocity, T-minus
     countdown, a Pc-over-time sparkline across the 4 Envisat days
   - **AI assistant panel**: docked, bound to the currently selected event,
     pre-populated with `executive_summary`/`recommended_action`, chat input
     for follow-ups, 2–3 suggested quick-questions
   - **Scenario control**: explicit "Play Envisat Scenario" / "Play Cosmos
     2221" driver that steps the T-minus countdown day by day — this is the
     primary demo action, must be easy to find and trigger
2b. **Envisat replay** (own view, reached from the top bar) — the correctness
   proof: "here is a real conjunction from October 2004; watch the pipeline
   reproduce the published numbers." Deliberately separate from the live
   console, which is general-purpose. A disabled placeholder tab for this
   already exists in `StatusHeader.jsx`.
3. **Maneuver Simulation** (modal/slide-over, not a separate page) — delta-v
   slider + burn direction toggle, live-updating before/after Pc and miss
   distance, wired to `/api/physics/maneuver`
4. **Empty / Loading / Error states** — globe texture loading, "no
   conjunctions found," backend unreachable — design and build these
   explicitly, they will be visible during a live demo if anything hiccups
5. **(Optional, low priority) Presentation/fullscreen mode** — hides chrome
   for projector use; skip if time-constrained

---

## 6. Proposed component structure

```
frontend/src/
  api/              # typed fetch client per endpoint group
    client.js        # base fetch wrapper (VITE_API_BASE_URL, error handling)
    health.js
    conjunctions.js   # /api/conjunctions/envisat
    physics.js         # /api/physics/tca, /screening, /maneuver
    ai.js               # /api/ai/advise
  components/
    globe/
      CesiumGlobe.jsx
      OrbitPath.jsx
      ConjunctionLine.jsx
    panels/
      StatusHeader.jsx
      EventList.jsx
      EventDetail.jsx
      AiAssistantPanel.jsx
    maneuver/
      ManeuverSimModal.jsx
    common/
      GlassPanel.jsx
      RiskBadge.jsx       # color + icon + label, not color-only
      Countdown.jsx
      LoadingState.jsx
      ErrorState.jsx
  hooks/
    useConjunctionScreening.js
    useReplayScenario.js   # drives the day-by-day Envisat/Cosmos 2221 playback
    useAiAdvice.js
  state/
    selectedEventContext.jsx   # currently selected conjunction event
    scenarioPlaybackContext.jsx
  pages/
    Landing.jsx
    Console.jsx
```

---

## 7. Data flow per screen

| Screen/Component | Endpoint(s) | Notes |
|---|---|---|
| App load | `GET /health` | connection status for header badge |
| Event list | `POST /api/physics/screening` | candidates sorted by `risk_level`/threat |
| Event detail (single day) | `POST /api/physics/tca` | miss distance, TCA, relative velocity for selected pair |
| Event detail (Pc trend) | `POST /api/physics/tca` (or `/screening`) looped across the 4 days' TLEs from `GET /api/conjunctions/envisat` | build the sparkline client-side — no server-side timeline exists |
| Scenario playback | `GET /api/conjunctions/envisat` for TLE source, then per-day calls as above | drives the T-minus countdown |
| AI assistant panel | `POST /api/ai/advise` | keyed to selected event; render `is_fallback` as a visible badge, never hide it |
| Maneuver modal | `POST /api/physics/maneuver` | live-updating on slider/toggle change |

---

## 8. Build order

Maps to `implementation-checklist.md` Phase 5 items — work top to bottom:

1. ~~API client (`frontend/src/api/`) + env setup + `/health` smoke test~~ ✅ **DONE**
2. ~~Console shell + design-system components (`GlassPanel`, `RiskBadge`,
   `StatusHeader`)~~ ✅ **DONE**
3. ~~Cesium globe rendering static/replay TLE positions~~ ✅ **DONE** — the
   globe carries the live tracked set and the 2004 replay, and selecting an
   event now draws both objects' orbit tracks (§5.3 blocker 5). See §14.
4. ~~Event list + event detail wired to screening/TCA endpoints~~ ✅ **DONE** —
   `EventList` (in the bottom strip's "Conjunction events" tab) and
   `EventDetail` (right rail) render real `/api/physics/screening` output.
   Ranking, co-orbital classification and formatting live in
   `frontend/src/lib/conjunctions.js` (25 unit tests); `useScreening.js` drives
   the calls. Verified in headless Chrome against a live backend — see §11.
5. ~~T-minus countdown + "Play Envisat Scenario" driver~~ ✅ **DONE** — the
   `Envisat replay` tab is live. `TMinus` (shared: sim-clock mode on the
   replay, wall-clock mode on a live event in `EventDetail`), a looping 2004
   replay clock with play/pause/restart, and all four prediction days re-run
   through `/api/physics/screening`. Clock arithmetic and the published ground
   truth live in `frontend/src/lib/replay.js` (32 unit tests). See §12.
5b. ~~Event list reads the scheduled screening pass~~ ✅ **DONE** — the panel
   is wired to `GET /api/monitoring/events` instead of running its own
   screening. See §13.
6. AI assistant panel wired to `/api/ai/advise`, with fallback-mode badge
7. ~~Maneuver simulation modal wired to `/api/physics/maneuver`~~ ✅ **DONE** —
   `ManeuverPanel`, on the replay view and the live console. Not a modal: see
   §15 for why the encounter needed its own always-visible scale.
8. Cosmos 2221 wired as secondary scenario
9. Empty/loading/error states + polish pass

🔒 Gate (per checklist): the full Envisat demo flow must run start-to-finish
without manual intervention before calling Phase 5 done.

---

## 9. Design system foundations (for Figma + component styling)

- **Palette**: near-black/navy background, one electric accent (cyan/blue)
  for UI chrome, a separate semantic risk scale (green → yellow → orange →
  red) distinct from the accent color
- **Type**: monospace for data/numbers (Pc values, coordinates, countdowns),
  clean sans for labels/body (e.g. JetBrains Mono + Inter)
- **Panels**: one reusable glass/translucent card style (blur + subtle
  border + low-opacity fill) reused across list/detail/AI/header panels
- **Risk indicators**: always pair color with an icon/label — never
  color-only, both for legibility on a projector and for basic
  accessibility

---

## 10. Open items for the team

- [x] ~~Decide whether `docs/api_contract.md` gets rewritten~~ — **done in
      step 1**: rewritten from source, verified against commit `bfe5bd4`.
- [x] ~~Confirm exact request field names for `/api/physics/tca` and
      `/api/physics/maneuver`~~ — **done in step 1**; both are documented in
      `docs/api_contract.md` §3.3 and §3.5 and implemented in
      `frontend/src/api/physics.js`.
- [x] ~~Decide how conjunction state is shared~~ — **step 4 deviated,
      deliberately.** §10 anticipated `state/selectedEventContext.jsx` +
      `hooks/useSelectedEvent.js`. Step 4 instead keeps `selectedEventKey` in
      `Console` and passes props, mirroring the `selectedId`/`onSelect` pair
      already flowing to `AssetStrip` — one extra level of drilling, no new
      files, consistent with surrounding code. Revisit if a third consumer
      appears.
- [ ] ⚠️ **Source** a Cosmos 2221 TLE pair. This item previously assumed a
      fixture existed to be located; it does not. `tests/fixtures/` contains
      only `alfano_case.py` and `envisat_tles.py`, and every other
      `cosmos`/`2221` hit in the repo is prose or a bare display string. This
      needs a CelesTrak/Space-Track fetch plus a validation pass before step 8.
- [x] ~~Decide on state management approach~~ — **decided in step 1**: no
      library and no Context for now. The only shared state is health status,
      polled once in `Console` and passed down as a prop. When `EventList`
      lands in step 4, add `state/selectedEventContext.jsx` (provider only)
      and `hooks/useSelectedEvent.js` (hook only) as **two** files — oxlint's
      `react/only-export-components` warns when a provider and its hook share
      a module. Still no external store: Zustand/Jotai/TanStack Query are
      pitch-relevant dependency decisions per CLAUDE.md, not incidental ones.


---

## 11. Step 4 — what shipped, and how it was verified

**Components.** `components/panels/EventList.jsx` replaces the `PendingRegion`
in the bottom strip's "Conjunction events" tab; `components/panels/EventDetail.jsx`
replaces the placeholder gauge in the right-rail "Conjunction risk" panel.
Derivation logic is in `lib/conjunctions.js` — separate from the components
because vitest runs `environment: 'node'` with no jsdom, so a component cannot
be rendered in a test but a pure function can.

**Two event sources, always distinguishable.** A live run screens the tracked
set against the selected object over the next 24 h. Alongside it, the October
2004 Envisat/Zenith-2 conjunction is injected through the *same* endpoint and
tagged `INJECTED · 2004 REPLAY`, so the console always has an event whose
answer is independently known, and it can never be read as something happening
in orbit now.

**Three display rules the panels enforce.**

1. Events are ranked client-side. The backend sorts by *coarse* separation
   (`screening.py:499`), computed before TCA refinement, so wire order can put
   a GREEN event above a RED one.
2. A co-located pair is labelled, never coloured RED. Two paths reach us:
   the backend refuses outright at exactly-zero relative velocity, and a
   merely-docked pair returns a Pc that is outside the 2D method's domain.
   Both are handled.
3. Nothing is substituted for a number the pipeline would not produce. A
   refused pair shows an em dash and the backend's verbatim reason.

**Verification (2026-08-31), headless Chrome over CDP against a live backend:**

| Check | Result |
|---|---|
| Injected Envisat row | `269 m`, `6.59e-4`, **Critical** — published 268.0 m / 0.000659 ✅ |
| TCA rendered | `2004-10-22 05:10:37Z` |
| Co-located ISS modules (NAUKA, POISK) | **Not assessed**, no Pc, backend reason quoted — not RED ✅ |
| Live detections | `0 detected of 3 screened · 2 not assessed · vs ISS (ZARYA)` |
| Empty state | "No close approaches in the live set" — stated as a result, not a failure |
| Detail panel | full provenance line, computed values, T-minus slot reserved |
| Tests / lint / build | 95 vitest tests pass, oxlint clean, `npm run build` succeeds |

> ⚠️ **A stale backend process will silently serve pre-fix physics.** During
> this verification the server already listening on `:8000` returned the
> *old* wide-window bug for the Envisat case (16 km at 03:30, `pc: 0`, GREEN)
> while the same request against a freshly started server returned the correct
> 268.9 m / 6.59e-4 / RED. The repository code was never wrong. Restart the
> backend before any demo or verification run, and treat a GREEN Envisat row
> as a stale-server symptom first.

---

## 12. Step 5 — what shipped, and how it was verified

**The Envisat replay is now a view, not a table row.** The `Envisat replay`
tab in `StatusHeader` was a disabled placeholder; it is now a second screen
(`pages/Replay.jsx`) with its own globe, its own clock, and its own panels.
`App.jsx` holds the one piece of view state and unmounts the inactive page —
each view owns a Cesium viewer and an animation loop, and keeping both alive
would run two globes for one visible canvas. No router was added: two screens
with no URL semantics do not justify a pitch-relevant dependency.

**The clock is the whole trick.** A historical encounter cannot be shown on a
"now, sped up" clock. `CesiumGlobe` gained an optional `simTimeFor(elapsedMs)`
override; the live console leaves it null and behaves exactly as before, while
the replay supplies `replaySimTime()`, which sweeps a window from 60 min before
to 10 min after the real TCA and wraps. The window deliberately opens before
04:20 UTC, the point at which ESA committed to the burn, so the decision moment
is inside the replay rather than already past. ×60 was chosen over ×120 so the
countdown decrements one simulated minute per real second; faster than that and
the seconds digit jumps by enough to read as a glitch.

**Two countdown modes, one component.** `TMinus` counts against real UTC for a
live event (whose TCA is a real future instant) and against the caller's
simulated clock for the replay. The injected 2004 row in the live console gets
neither — it would read "T+21 years" — and instead offers a route into the
replay view. An unknown or malformed TCA renders an em dash; it never falls
back to `Date.now()`, which would produce a confident countdown to the wrong
moment.

**Four predictions, presented as agreement rather than convergence.** All four
archived element sets are screened over one window around the real TCA, which
makes the rows comparable and costs a sixth of what searching from each day's
own epoch would. The computed values do **not** converge monotonically
(329 → 234 → 152 → 269 m; Pc 2.74e-4 → 1.11e-3 → 1.93e-3 → 6.59e-4), so
`PredictionTable` deliberately does not draw a trend line — that would assert a
sharpening estimate the data does not show. What the four rows demonstrate is
that every prediction, from a three-day-old element set to a same-day one, puts
the encounter sub-kilometre and above ESA's acceptance threshold. That is also
the paper's own framing: it reports a range, not a per-day figure.

**Two reference bands, both labelled.** The published band (81–316 m,
1.4e-4–5.5e-4) is what the paper reported. The asserted band (100–1000 m,
1e-4–2.5e-3) is what `tests/test_envisat_replay.py` actually gates on, and is
wider because this pipeline runs on public-catalog TLEs while ESA used
Envisat's operational orbit determination. Showing only the published band
would mark three of four rows as misses and misreport a passing pipeline;
showing only the asserted band would hide that our inputs are coarser. A unit
test asserts that at least one computed value falls *outside* the published
band, so nobody can quietly widen those constants to make the table look
tidier.

### A real bug this step surfaced

Step 4's globe highlight drew a connecting line between a conjunction's two
objects, and that line **never rendered**. It could not be caught then: the
only live conjunction available was the co-located ISS↔NAUKA pair, whose line
is zero-length and invisible whether or not the code works. The replay's two
objects are thousands of kilometres apart, which made the absence obvious.

Two independent causes, both now fixed in `CesiumGlobe.jsx`:

1. The endpoints were read back with `entity.position.getValue()` — that API
   needs a `JulianDate`, and without one a release build of Cesium returns
   nothing. The positions are now captured as the markers are placed.
2. `polyline.positions` was reassigned every frame. Each assignment
   invalidates the geometry, Cesium rebuilds the primitive asynchronously, and
   re-invalidating on the next frame means the build never completes — the
   entity stays present and valid the whole time and simply never draws. It is
   now built once with a `CallbackProperty`, the supported path for geometry
   that moves every frame.

A `depthFailMaterial` was also added: the chord between two objects on opposite
sides of the planet passes *through* it (in the verified frame, the midpoint
sits 489 km below the surface), so without one that stretch is invisible and
the pair reads as unconnected.

**Verification (2026-08-31), headless Chrome over CDP against a live backend:**

| Check | Result |
|---|---|
| Four prediction days | `329 m / 2.74e-4`, `234 m / 1.11e-3`, `152 m / 1.93e-3`, `269 m / 6.59e-4` — all **Critical**, all inside the asserted band ✅ |
| Against `docs/validation-notes.md` §4.4 | 328.2 / 233.9 / 151.5 / 268.0 m — agrees to under a metre ✅ |
| TCA computed vs published | `05:10:37Z` vs `05:10:35Z`, both shown |
| Countdown running | `T-00:53:53` → `T-00:51:52` over 2 s of wall clock (×60) ✅ |
| Pause | countdown **and** replay clock both frozen at the same instant ✅ |
| Restart | returns to `T-00:59:22` / `04:11:14Z`, the window start ✅ |
| Conjunction line | pixel-sampled along the chord: **41/41** samples are `#f43f5e` ✅ |
| Injected row in live console | no countdown; offers "Open Envisat replay", which switches views ✅ |
| Tests / lint / build | 134 vitest tests pass, oxlint clean, `npm run build` succeeds |

**Known cosmetic limit.** At 1920×1080 the side rails scroll: "What ESA did"
and the AI pending region are below the fold. Everything load-bearing — the
countdown, the headline figures, the four-day table — is visible without
scrolling. Left for the polish pass (step 9).

**Still not verified in a browser:** `TMinus` in wall-clock mode. The live
tracked set (CelesTrak `stations`) contains only co-located pairs, which take
the "not assessed" branch and render no countdown, so there is currently no
live event to count down to. The arithmetic behind it is unit-tested; the
rendered path is not.

---

## 13. Step 5b — the event list now reads the scheduled pass

**The frontend stopped running screening.** `useScreening.js` used to post one
`/api/physics/screening` request per candidate from the browser. That was a
workaround for a backend batch-failure bug, it was fine against CelesTrak's
~20-object `stations` group, and it did not survive the real tracked set: an
all-pairs pass over ~700 objects is roughly 1.6 hours of SGP4 and numpy, so the
button had been capped off at 40 objects and the panel sat permanently empty
while the server held real detections.

The hook now reads `GET /api/monitoring/events` — the last completed pass,
served from cache, returning instantly. `SCREENABLE_MAX` is gone. **REFRESH**
re-reads the cached pass; **SCREEN NOW** asks the server to start a fresh one
and returns immediately, then polls `/api/monitoring/status` (which carries no
event payload) until the pass lands. Nothing in the UI ever blocks on physics.

This also matches how conjunction assessment actually works: scheduled
screenings against a catalogue, published results — not an operator waiting on
a button.

**The injected Envisat case is unchanged** and still goes through
`/api/physics/screening` directly, so the console always carries one event
whose published answer is known.

**Coverage became a first-class claim.** `screen_all_pairs` caps how many gated
pairs get the expensive refinement. When that cap bites, the pass screened the
closest N candidates — *not* the set — so "no close approaches found" would be
a false statement about coverage. `frontend/src/lib/monitoring.js` derives that
distinction and the panel states it above any empty-state phrasing. A unit test
pins the failure direction that matters: `describeCoverage` must not infer
completeness from an **absent** `truncated` field. It did, and the test caught
it before the UI could assert full coverage on the strength of a missing
measurement.

### A real bug this step surfaced

`eventKey` was built from `origin + secondary_name + tca_utc_iso`. That was
unique only while one fixed primary was screened against many candidates.
All-pairs screening removed the guarantee: `ISS (ZARYA) ↔ ISS (NAUKA)` and
`POISK ↔ ISS (NAUKA)` share a secondary, and both are refused as co-located so
neither carries a TCA. The two collided into one React key — a row was dropped,
and because selection is keyed on the same value, clicking the survivor would
select the wrong pair. The key now includes both objects, preferring
tracked-set ids over display names. Two regression tests cover it.

**Verification (2026-09-06), headless Chrome over CDP against a live backend.**
CelesTrak was unreachable from this machine, so the tracked set was seeded from
the committed TLE snapshot (4 real station objects) via a scratch harness. The
element sets are real but stale, so the *physics* below is not a meaningful
current detection — what is verified here is the panel's plumbing.

| Check | Result |
|---|---|
| Meta line | `0 CONJUNCTIONS · 3 NOT ASSESSED · 4 OBJECTS · 2 MIN AGO` ✅ |
| Coverage note | "6 pairs evaluated, all 3 gated pairs refined", neutral styling ✅ |
| Empty state | "No close approaches in the tracked set" — the complete-coverage wording, correctly chosen ✅ |
| Co-located ISS modules | three distinct **Not assessed** rows, no Pc, no false RED ✅ |
| Injected Envisat row | `269 m`, `6.59e-4`, **Critical** — published 268.0 m / 0.000659 ✅ |
| Selection | detail panel fills with the provenance line and computed values ✅ |
| Buttons | REFRESH / SCREEN NOW, neither blocking ✅ |
| Browser console | clean after the `eventKey` fix (8 duplicate-key errors before) ✅ |
| Tests / lint / build | 164 vitest tests pass, 78 pytest pass, oxlint clean, `npm run build` succeeds |

**Not verified:** the `ready` path against a large truncated pass (needs
CelesTrak), the `never_run` and `failed` empty/error branches in a browser
(both were exercised by the API but not screenshotted), and `SCREEN NOW`'s
poll-to-completion cycle end to end.

---

## 14. Step 3b — orbit tracks for a selected conjunction

CLAUDE.md §5.1 requirement 3 asks that selecting an event highlight it on the
globe *"including the orbit tracks of the two objects involved"*. The globe drew
markers and a dashed chord between the pair, which answers *where are they* but
not *why do they come close* — and two orbital planes crossing is the whole
geometric explanation of a conjunction.

`frontend/src/lib/orbitTrack.js` samples one revolution and `CesiumGlobe.jsx`
draws it: both members of the pair in the event's risk colour, **primary solid,
secondary dashed**, so shape carries identity and colour keeps meaning risk
(the same rule §5.2 imposes on object type). An object selected on its own gets
one accent-teal ring — chrome, never a risk token. At most three rings exist at
once, re-sampled on a 250 ms throttle rather than per frame.

### The decision: a closed ring, not a ground track

Sampling a full period and converting each sample with **its own** instant's
GMST draws a ground-track swath that shifts ~22.5° west per revolution and never
closes. Rotating every sample by **one** instant's GMST instead draws the orbit
as it stands at that moment: it closes, the Earth turns beneath it, and —
the property everything rests on — the marker sits exactly on its own ring,
because the marker is `eciToEcf(r_teme(t), gstime(t))` and the ring's centre
sample is that same expression. A unit test pins it; a ring the marker visibly
floats off would be worse than no ring at all.

The rings are the markers' own paths — same element sets, same satellite.js
propagation, same visualisation layer. They are **not** the post-burn trajectory
of §5.2, which must still come back from `/api/physics/maneuver` as a sampled
ephemeris because producing it means applying a ΔV to a state vector. Frame
conversion is `satellite.eciToEcf`, so §1.1's ban on hand-rolled TEME→ECEF
rotations holds.

### Verified against the installed libraries, not assumed

`satellite.js@6.0.2`, `cesium@1.143.0`, real ISS element set:

| Claim | Measured |
|---|---|
| `satrec.no` is rad/min (`no_kozai`/`no_unkozai` do not exist here) | period 92.977 min vs 92.967 min from line 2's mean motion |
| `eciToEcf` is a pure rotation | \|r\| identical to 1e-12 km either side |
| Marker rides its ring | centre sample ↔ marker separation **0.0 km** |
| Ring closure over one revolution | **24.7 km** (0.2° of arc) — real J2 drift, deliberately not stitched shut |

`TRACK_SAMPLES` is 129 — odd on purpose, so the centre sample lands exactly on
the drawn instant. With an even count the nearest sample is up to half a step
(~170 km at LEO) away and the "marker rides its ring" guarantee quietly stops
being true.

### A real bug this step surfaced

The click handler accepted any string entity id as an object selection. Cesium
gives an entity added without an explicit id an auto-generated GUID — also a
string — so clicking the conjunction chord already set `selectedId` to an id no
object has, emptying the selected-object panel instead of doing nothing. Three
more pickable polylines would have made it easy to hit. Selection now requires
membership of the marker map.

**Verification (2026-09-07), headless Chrome over CDP against a live backend.**
CelesTrak is still blocking this IP, so the live tracked set is the committed
4-object offline stations file — co-located objects whose rings coincide, which
proves little. The Envisat replay is the real check, and it needs no third
party.

| Check | Result |
|---|---|
| Replay: two rings | solid Envisat + dashed Zenith-2, planes visibly crossing, both markers on their own ring ✅ |
| Rings persist across frames | still drawn 6 s later, markers advanced along them ✅ (the `polyline.positions` reassignment bug would have made them vanish) |
| Live pair (co-located) | neutral grey rings, never a risk colour for an unassessable pair ✅ |
| Deselect | both rings and the chord removed ✅ |
| Plain object selection | one accent-teal ring ✅ |
| Injected 2004 event on the live console | no rings — `hasGlobePresence` correctly gates it ✅ |
| Browser console | no errors or exceptions ✅ |

---

## 15. Step 7 — the avoidance burn, drawn at a scale where it is visible

`/api/physics/maneuver` now returns `tracks`: the primary's coasting arc, its
post-burn arc, and the secondary, sampled in ECEF from one TCA solution and one
Clohessy-Wiltshire displacement. CLAUDE.md §5.2 requires that to come from the
backend — reconstructing a manoeuvred orbit in JavaScript would be orbital
mechanics outside the validated pipeline, and two lines computed by two
different codebases would not be comparable to each other.

### The measurement that decided the design

Re-flying the real October 2004 burn: **268.9 m → 569.8 m**, Pc **6.59e-4 →
5.69e-5** (91.4% reduction), 0.152 kg of hydrazine. The two trajectories
separate by **389 m at TCA across a 29,425 km arc — about 1:55,000**.

At globe scale those two lines are the same line, by a wide margin. Drawing
them in two colours and calling §5.1.4 satisfied would have shown a judge
nothing. The burn's effect lives at the encounter, so the encounter is drawn:

- **Globe** — both arcs, unflown in the event's risk colour, flown in the
  accent. Context: which stretch of orbit runs from the burn to the encounter.
- **`ManeuverPanel`** — the three TCA positions projected into their own plane,
  to scale, with a labelled scale bar.

The projection is an **isometry** on those three points, so every distance
drawn is the true distance: no foreshortening, nothing scaled up to look more
dramatic. A unit test asserts it against the 3D separations. The labelled
numbers still come from the pipeline's scalars — the drawing is a picture, the
miss distance is a number, and they are never presented as the same kind of
thing.

### Two honest limits, both surfaced rather than tuned away

**The sampled arcs cannot resolve the miss distance.** They span an hour at a
~16 s step while the objects close at ~15 km/s, so the nearest sampled approach
is 7.9 km against a true 268 m, and it moves with the grid. Resolving 268 m
uniformly would need a millisecond step across the whole hour. The encounter is
therefore carried separately as three exact TCA positions, and a pytest
asserts the gap between arcs and truth *exists*, so nobody later files down a
display grid until it looks like a measurement.

**The globe arcs needed reframing to sit on the orbit rings.** Rings are drawn
inertially (one instant's GMST for every sample); the backend's arcs are
Earth-fixed per sample, which is a ground-track swath. `alignTrackToInstant`
undoes each sample's own rotation and reapplies one shared instant's, through
satellite.js calls only. Without it the burn arc visibly wanders off the ring
it is a piece of.

### Placement

The panel lives on the **Envisat replay first**: that view runs a 2004 clock, so
the returned trajectories can be drawn against the objects they belong to. It
replaced the "Maneuver simulation" `PendingRegion` there. On the live console it
sits at the end of the bottom strip, and the globe arcs are drawn only for a
LIVE event — the injected 2004 case is excluded for the same reason its objects
are not highlighted there.

Burns are simulated **on explicit action**, never on selection: a console that
quietly plans a manoeuvre for every row a user clicks is both wasteful and
misleading. A pair the pipeline declined to assess, or a co-orbital pair, is
refused with a reason rather than sent to the endpoint to fail.

**Verification (2026-09-08), headless Chrome over CDP against a live backend.**

| Check | Result |
|---|---|
| Idle state | "Nothing is simulated until you ask" ✅ |
| −4.0 cm/s (the burn ESA flew) | `269 m → 570 m`, `6.59e-4 → 5.69e-5`, 91.4%, 0.152 kg ✅ |
| −8.0 cm/s re-simulates | `269 m → 938 m`, `1.60e-6`, 99.8%, 0.304 kg ✅ |
| Diagram to scale | 570 m line measures 2.13× the 269 m line; true ratio 2.12 ✅ |
| Scale bar | 100 m, labelled beneath the bar it measures ✅ |
| Globe arcs | flown arc present in accent along the risk-coloured ring (124 accent pixels across the orbit's span, checked in the capture) ✅ |
| Browser console | no errors or exceptions ✅ |

