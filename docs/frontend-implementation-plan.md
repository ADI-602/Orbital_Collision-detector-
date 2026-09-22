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
2. **AI provider mismatch — mostly resolved 2026-09-22.** Docs across the repo
   referenced `ANTHROPIC_API_KEY` (Claude) while `backend/ai/advisor.py` has
   always called **Google Gemini** (`gemini-2.5-flash`) via
   `GEMINI_API_KEY`/`GOOGLE_API_KEY`. `backend/README.md`, `backend/ai/`,
   `backend/api/main.py` (whose docstring is served publicly at `/docs`),
   `docs/architecture.md`, `docs/api_contract.md` and this file now all say
   Gemini. Both `.env.example` files were already correct.
   **`CLAUDE.md` still says Claude API** in sections 0, 2 and 4. It is the
   project's governing file and asks that conflicts be flagged rather than
   silently resolved, so it is left for the human to change.
   Either way the frontend should never assume which provider is live — it
   only needs to trust the response shape (`AIAdvisorResponse`) and the
   `is_fallback` flag.
3. **No live-satellite-position endpoint exists.** There is no
   `/api/satellites/live` and no endpoint that returns a pre-computed replay
   timeline. The frontend must source TLEs from `/api/conjunctions/envisat`
   and compute per-day miss-distance/Pc itself by calling
   `/api/physics/tca` / `/api/physics/screening` for each of the 4 historical
   days. Cosmos 2221 (the secondary scenario) has no dedicated endpoint
   either — source its TLE pair from `tests/fixtures` (confirm exact fixture
   name when implementing) and drive it through the same physics endpoints.

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
3. ~~Cesium globe rendering static/replay TLE positions~~ ✅ **DONE**
4. ~~Event list + event detail~~ ✅ **DONE** — the replay's prediction-day
   list and per-day detail, and the live console's general `EventList` with
   its LIVE/INJECTED toggle, both wired to `/api/physics/screening`.
5. ~~T-minus countdown + "Play Envisat Scenario" driver~~ ✅ **DONE**
   (`Countdown.jsx`, `useCountdown`, `lib/countdown.js`, and the replay's
   play/pause/restart driving `useReplayClock`)
6. ~~AI assistant panel wired to `/api/ai/advise`, with fallback-mode badge~~
   ✅ **DONE** (`AiAdvisorPanel`, strict `is_fallback === false` check). The
   follow-up chat input is not built — the panel is read-only for now.
7. ~~Maneuver simulation (delta-v slider)~~ ✅ **DONE** — `ManeuverPlanner`,
   in both the console and the replay. Built as an inline panel rather than
   the modal this plan first sketched: the tradeoff is worth more beside the
   Pc readout it is moving than on top of it.
8. ~~Cosmos 2221 wired as secondary scenario~~ **DROPPED** (scope decision,
   2026-09-13 — see `implementation-checklist.md` Phase 5). Envisat as the
   correctness proof plus live-time detection is enough; a second historical
   scenario adds no new evidence. This also retires the Cosmos TLE-sourcing
   item in §10 below.
9. Empty/loading/error states ✅ **DONE** (every panel has explicit empty,
   loading and error states; an empty screening result is rendered as a
   finding with the window that was searched) + **polish pass still to do**
   (Phase 6).

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
- [~] ~~**Source** a Cosmos 2221 TLE pair~~ — **no longer needed**, the
      scenario was dropped (see step 8). No Cosmos 2221 element set exists
      anywhere in the repo, and sourcing one would have needed a
      CelesTrak/Space-Track fetch plus its own validation pass.
- [x] ~~Decide on state management approach~~ — **decided in step 1**: no
      library and no Context for now. The only shared state is health status,
      polled once in `Console` and passed down as a prop. When `EventList`
      lands in step 4, add `state/selectedEventContext.jsx` (provider only)
      and `hooks/useSelectedEvent.js` (hook only) as **two** files — oxlint's
      `react/only-export-components` warns when a provider and its hook share
      a module. Still no external store: Zustand/Jotai/TanStack Query are
      pitch-relevant dependency decisions per CLAUDE.md, not incidental ones.


---

## 11. What is left (as of 2026-09-19)

Phase 5 is complete, but that is not the same as "the frontend is finished".
Three things from this plan were never built, and none of them is blocked:

- ~~**Maneuver delta-v slider**~~ ✅ **DONE** — `ManeuverPlanner` gives both
  views draggable ΔV (-20..+20 cm/s) and lead time (5..180 min), re-running
  `/api/physics/maneuver` on a 250 ms debounce. Results are always labelled
  with the burn they belong to: while a new burn is in flight the previous one
  stays visible, dimmed, and captioned with its own parameters, since the
  failure mode of a live control is a slider reading -6.0 while the numbers
  are still the -4.0 answer. The staleness rule is `lib/burn.js`, tested.
- **AI follow-up chat input** (§5). `AiAdvisorPanel` is read-only: it renders
  the advisor's opening analysis and nothing more. The planned follow-up box
  and suggested quick-questions do not exist.
- **Landing / intro screen** (§5 item 1). The app opens straight into the
  console. There is no hero, no mission branding, no entry CTA.

Plus, from Phase 6: the **visual polish pass**, which is the one item of the
three-in-Phase-6 that is frontend work.

And three confirmations that need an environment the build container cannot
provide — a GPU for the globe's rendering, an API key for the AI panel's live
badge, and network for live screening to find a real conjunction.
