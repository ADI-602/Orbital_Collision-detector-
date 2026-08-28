# Frontend Implementation Plan — Orbital Risk Advisor

This is the working plan for Phase 5 ("Frontend + integration") of
`implementation-checklist.md`. It covers the technical build plan (API
integration, component structure, build order) and the UX/screen structure,
so it can double as a build checklist and a Figma reference.

The backend (Phases 1-4) is complete and validated — 49/49 tests passing.
Nothing here changes backend code; this doc is the frontend build plan only.

---

## 1. Overview & goals

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

1. **`docs/api_contract.md` is stale.** It was an earlier/aspirational design
   doc. None of its 5 documented endpoints match what's actually implemented
   in `backend/api/main.py` — different paths, different HTTP methods
   (GET-with-query-params vs. POST-with-body), and different request/response
   shapes. **Build against the real routes in §3 below, not that doc.**
   Updating `api_contract.md` to match reality is out of scope for this plan
   — track it as a separate follow-up task so it doesn't silently drift
   further.
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

---

## 3. Real backend routes (source of truth)

Confirmed from `backend/api/main.py` and `backend/ai/schema.py`:

| Path | Method | Purpose | Notes |
|---|---|---|---|
| `/health` | GET | health check | poll once on app load |
| `/api/conjunctions/envisat` | GET | Envisat/Zenith-2 replay ground truth | returns raw TLE pairs for 4 prediction days (Oct 19–22, 2004) |
| `/api/physics/tca` | POST | TCA + miss distance from two raw TLEs | body: `{tle1_line1, tle1_line2, tle2_line1, tle2_line2}` (confirm exact field names against `main.py`/OpenAPI schema when implementing) |
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

1. API client (`frontend/src/api/`) + env setup + `/health` smoke test
2. Console shell + design-system components (`GlassPanel`, `RiskBadge`,
   `StatusHeader`)
3. Cesium globe rendering static/replay TLE positions
4. Event list + event detail wired to screening/TCA endpoints
5. T-minus countdown + "Play Envisat Scenario" driver
6. AI assistant panel wired to `/api/ai/advise`, with fallback-mode badge
7. Maneuver simulation modal wired to `/api/physics/maneuver`
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

- [ ] Decide whether `docs/api_contract.md` gets rewritten to match the real
      backend routes (separate follow-up task, not blocking frontend work)
- [ ] Confirm exact request field names for `/api/physics/tca` and
      `/api/physics/maneuver` against the live Swagger UI
      (`http://localhost:8000/docs`) before writing the API client
- [ ] Confirm Cosmos 2221 TLE fixture location/name in `tests/fixtures`
- [ ] Decide on state management approach (React Context, as sketched above,
      vs. a lightweight external store) once the console's shared-state
      surface area is clearer
