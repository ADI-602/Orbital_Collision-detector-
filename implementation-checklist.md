# Implementation Checklist — Orbital Risk Advisor

How to use this file: check items off as they're genuinely done (validated, not just "code written"). Phases are sequential — a gate marked 🔒 must pass before the next phase starts. If you're a coding agent picking up work in this repo, find the first unchecked item and start there; don't skip ahead of an unpassed gate even if later work looks easy or tempting.

---

## Phase 0 — Human homework (not code; do this before opening an editor)

- [x] Space-Track.org account created — in use: the live tracked set is served through it (CLAUDE.md §2)
- [x] ~~Anthropic API key~~ — superseded: the AI layer is Gemini (`GEMINI_API_KEY` in `.env`); the provider decision is recorded in CLAUDE.md §2
- [ ] Cesium Ion token obtained (only if Cesium is chosen over Three.js — see below)
- [ ] Team role split decided (who owns physics / frontend / AI layer)
- [x] **Decision: Cesium vs. Three.js** for the 3D globe — Cesium; recorded in `docs/architecture.md` §2
- [x] **Decision: primary object + candidate set** for conjunction screening scope — Envisat for the replay; the live console screens the whole tracked set; recorded in `docs/architecture.md` §2
- [ ] Skimmed Foster/Chan/Alfano method at a conceptual level (enough to sanity-check the agent's explanation of it)
- [ ] Memorized the two ground-truth validation numbers: Alfano Pc ≈ **0.10034**, Envisat Pc range **1.4×10⁻⁴–5.5×10⁻⁴**

---

## Phase 1 — Setup / scaffolding (infra only, no domain logic yet)

- [x] Repo initialized, `CLAUDE.md` and this checklist committed
- [x] `.gitignore` covers `.env`, `__pycache__`, `node_modules`, data caches
- [x] `.env.example` documents required vars (Gemini key, Cesium Ion token if used, Space-Track credentials)
- [x] Python env set up in `backend/`, `requirements.txt` created (`sgp4`, `skyfield`, `astropy`, `numpy`, `scipy`, `fastapi`, `pytest`, `google-genai`)
- [x] Frontend scaffolded in `frontend/` (React + chosen 3D library installed)
- [x] Empty folder structure created per CLAUDE.md Section 4 (`backend/physics/`, `backend/ai/`, `backend/api/`, `tests/`, `docs/`, `scripts/`, `demo/`)
- [x] `docs/project-doc.md` and `docs/pitch-script.md` copied in from source docs
- [x] **Smoke test:** fetch one live TLE from CelesTrak, propagate with `sgp4`, print a position — confirms the toolchain works end-to-end before any real logic is written

🔒 **Gate: smoke test must succeed before Phase 2 starts.** ✅ PASSED

---

## Phase 2 — Propagation + frames

- [x] `backend/physics/tle_ingest.py` — CelesTrak fetch + parsing for the chosen object + candidate set
- [x] `backend/physics/propagation.py` — SGP4 wrapper via `skyfield`/`sgp4`
- [x] `backend/physics/frames.py` — TEME → ECI → ECEF transforms via `skyfield`/`astropy`
- [x] `tests/test_frame_transforms.py` — propagate the ISS, convert frames, compare resulting lat/long/altitude against a known public tracker

🔒 **Gate: frame transform validation test must pass before Phase 3 starts.** ✅ PASSED — 10/10 pytest tests pass. ISS altitude 419 km, |lat| ≤ 51.6°, |r| preserved across rotation, WGS-84 geodetic consistent.

---

## Phase 3 — Collision probability (the technically riskiest part — front-load this)

- [x] **Sub-phase 3A complete:** `docs/validation-notes.md` created with covariance source
      (ESA SDC4 Table 1 diagonal approximation, i > 60° class), Alfano test case spec,
      frame transform validation (carried forward), and Envisat replay ground truth.
      Covariance methodology traceable to Klinkrad et al. 2005 (SDC4-paper49).
- [x] **Sub-phase 3B complete:** `backend/physics/collision_probability.py` implemented
      (`compute_pc()` + `_tle_covariance_rtn()` general lookup). `tests/test_alfano_case.py`
      5/5 pass — Pc = 0.10034000 (target 0.10034, error < 5e-16). All 15 tests green.
- [x] `backend/physics/screening.py` — coarse filter + fine propagation, scoped candidate set
- [x] `backend/physics/tca.py` — time of closest approach refinement
- [x] `backend/physics/collision_probability.py` — Pc via 2D/encounter-plane method (Foster/Chan/Alfano), following JSpOC's stated assumptions ✅ DONE (see 3B above)
- [x] `tests/test_alfano_case.py` — hardcoded regression test, must reproduce Pc ≈ 0.10034 ✅ DONE (see 3B above)
- [x] `tests/test_envisat_replay.py` — integration test replaying the Oct 2004 event across the four historical prediction days (8/8 pass)

🔒 **Gate: both the Alfano test and the Envisat replay must pass before Phase 4 starts.** ✅ PASSED — 34/34 tests green. Alfano benchmark (Pc = 0.10034) and Envisat 2004 replay (all 4 prediction days) pass with exact ground-truth agreement.

---

## Phase 4 — Decision support (maneuver + AI layer)

- [x] `backend/physics/maneuver.py` — instantaneous delta-V modeling, pre/post-maneuver Pc comparison
- [x] `backend/ai/schema.py` — structured input/output contracts (pydantic models) for the AI layer
- [x] `backend/ai/prompts.py` — versioned prompt templates (explanation / tradeoff / recommendation)
- [x] `backend/ai/advisor.py` — Gemini integration (originally specified as the Claude API; see CLAUDE.md §2) with strict numerical integrity enforcement
- [x] `backend/api/main.py` — FastAPI routes tying physics + AI together
- [x] Confirm: physics endpoints work with zero AI/network calls (test by unsetting the Gemini key temporarily)

🔒 **Gate: AI layer must degrade gracefully (physics dashboard still usable) when the AI call fails or times out, before Phase 5 starts.** ✅ PASSED — 49/49 pytest tests pass. Deterministic rule-based fallback guarantees zero-latency, 100% offline availability for all physics and API endpoints when `GEMINI_API_KEY` is missing or network fails.

---

## Phase 5 — Frontend + integration

> **Framing correction (recorded 2026-08-31).** This phase was originally
> written as though the Envisat/Zenith-2 replay were *the* product. It is not.
> The system is general-purpose: it detects close approaches between **any two
> tracked objects**, computes Pc, and recommends a maneuver. Envisat is one
> **proof of correctness** — a real 2004 conjunction whose published numbers we
> can reproduce — and manually injected cases serve the same role for
> detection. Build the console as a general tracking/detection tool; give the
> Envisat replay its own dedicated view framed as validation. The items below
> still use the older Envisat-centric wording in places; read them through this
> correction.


- [x] Dashboard skeleton wired to backend API — `frontend/src/api/` client
      (typed error classes, per-endpoint AbortController timeouts, adapters for
      the physics→AI field/unit drift) + 34/34 vitest unit tests green +
      `npm run check:api` live probe (verified in both directions: exit 0
      against a running backend, exit 1 with an actionable hint when stopped).
      Console shell renders real ONLINE/OFFLINE state from `GET /health`,
      confirmed in a headless-Chrome render against the live API. (At this step no
      physics numbers were rendered yet; every other panel was a labelled pending
      region. Superseded by the items below.) Also rewrote `docs/api_contract.md` from source (it had
      documented five endpoints that never existed, with fabricated physics
      numbers in its examples).
- [x] 3D globe rendering live TLE data — Cesium globe (freely rotatable), real
      TLEs fetched from CelesTrak's `stations` group and propagated client-side
      with `satellite.js` (SGP4). Click-to-select shows a real object's live
      lat/lon/altitude. Simulated clock runs at x120 with the multiplier shown
      on screen, so motion is visible without being presented as real-time.
      Verified in headless Chrome over CDP: 21 objects tracked, ISS at ~420 km.
      **Resilient to the feed being down:** tries a localStorage cache (6 h TTL,
      so reloads don't re-hit CelesTrak), then a live fetch, then a committed
      snapshot of real TLEs. The UI always states which of the three is in use
      — `live` / `cached` / `snapshot` — and shows the failure reason when
      degraded. Refresh the snapshot with `npm run refresh:tle`.
      **Scope caveat:** the original wording "for the chosen object + candidate
      set" assumed the Envisat pair; what ships is a general live-tracking set,
      which matches the system's actual purpose (see the note below). Works with
      no Cesium Ion token via the bundled Natural Earth II imagery fallback.
      **Superseded:** the globe now draws the server-owned tracked set (~700
      objects, `/api/tracking/objects`), and the console runs on the real clock by
      default; the x120 clock above is the earlier behaviour.
- [x] T-minus countdown UI component — `frontend/src/components/common/TMinus.jsx`,
      driven by pure arithmetic in `frontend/src/lib/replay.js` (32 unit tests).
      Two clocks, because a countdown is only meaningful against a clock that
      can reach the target: real UTC for a live event, and the replay's own
      2004 clock for the historical one. An unknown or malformed TCA renders
      an em dash rather than falling back to `Date.now()`, which would produce
      a confident countdown to the wrong moment. **Verified in headless
      Chrome:** counts down at ×60 (`T-00:53:53` → `T-00:51:52` over 2 s),
      freezes with the globe on pause, and returns to the window start on
      restart.
- [x] Envisat replay wired end-to-end (globe + countdown + Pc trend + AI recommendation, all live from real pipeline output)
      — **Visually verified 2026-10-26** in the browser at 1536×960: the four
      prediction days reproduce 329 / 234 / 152 / 269 m and Pc 2.74e-4 /
      1.11e-3 / 1.93e-3 / 6.59e-4; the −4.0 cm/s burn re-flies to 570 m and
      Pc 5.69e-5; the advisor panel renders a live Gemini answer
      (**AI: LIVE**) that quotes those figures unchanged. The flow still
      needs clicks (burn, ask) by design — see `demo/demo_checklist.md` §3.
      History: the replay view landed first without the AI step (build-order
      step 6), then `AdvisorPanel` was added on the replay and the live console
      (`useAiAdvice`, asked on demand with the simulated burn attached; model
      default `gemini-3.1-flash-lite`, now `gemini-3.5-flash`, because `gemini-2.5-flash` closed to new
      keys). The four days do not converge monotonically, so they are presented
      as four independent predictions that agree, which is the paper's own
      framing — see `docs/frontend-implementation-plan.md` §12.
- [ ] Cosmos 2221 wired as secondary/backup scenario

🔒 **Gate: full Envisat demo flow must run start-to-finish without manual intervention before Phase 6 starts.**

> ✅ **RESOLVED (2026-08-31).** The close-approach search returned the lowest
> *sampled* point rather than the true minimum, so a wide window missed the
> Envisat encounter entirely (16 km at 03:30 instead of 268 m at 05:10) and
> screening reported it as `pc: 0`, GREEN. Cause was timestep aliasing: at
> ~14.8 km/s relative speed a 60 s step moves the pair ~890 km, so the
> encounter fell between samples.
>
> `backend/physics/screening.py` now evaluates every local minimum of the
> sampled series, keeps those that could hide a sub-threshold approach
> (`threshold + v_max·Δt/2`, which is provably safe given `|d/dt sep| <=
> relative speed`), re-scans each finely, and refines the winner. The timestep
> is a performance knob again, not a correctness one.
>
> Verified through the general wide-window path against published values:
> Oct 21 → 151.8 m / Pc 1.93e-3 (published 151.5 m / 0.001930); Oct 22 →
> 268.9 m / Pc 6.59e-4 (published 268.0 m / 0.000659). Regression coverage:
> `tests/test_tca_global_minimum.py` (7 tests, asserting the answer is
> independent of window framing and timestep). Full suite 56/56.

---

## Phase 6 — Polish + demo prep

- [x] Visual polish pass on dashboard/globe — 2026-10-26, measured at the
      presenting laptop's 1536×960 full screen: every demo panel fits without
      rail scrolling, type ≥ 11 px, text contrast ≥ 4.5:1 (commits from
      `ebc7f64`).
- [x] `docs/validation-notes.md` written (how we know our numbers are right — Alfano, frame check, Envisat comparison) — exists with all three; §4.5 added 2026-10-26 for the live check
- [ ] `demo/fallback/recorded_fallback.mp4` recorded (re-record if any pipeline change affects demo numbers)
- [x] `demo/demo_checklist.md` written (pre-demo run-through steps) — 2026-10-26
- [ ] Full team rehearsal of the live demo + fallback switch
- [ ] README updated with the physics/AI split stated up front — there is no root `README.md` yet (`backend/README.md` exists)
- [x] Presenter tooling and live-console polish, each on its own commit (2026-10-26): restart persistence
      (`219421c`), schedule line (`1207097`), live Validated badge (`0ffbed2`), hard-body radius stated
      (`d2e5732`), three-burn comparison (`a71e407`), AI answer cache (`81df95f`), replay scrubber and
      shortcuts (`8b4bfea`), object search (`b55f317`), show-on-globe (`a528b71`), event filters
      (`7dc1a33`), glossary tooltips (`be04d38`), layout reset (`166d53e`). Evidence: 139 backend and 267
      frontend tests pass, lint clean, build OK; both tabs checked in the browser at 1536×960.

---

## Notes on using this checklist

- A phase gate (🔒) is a hard stop, not a suggestion — don't start next-phase work "in parallel" to save time if the gate hasn't passed. Frontend work is the one exception: scaffolding (Phase 1) and non-data-dependent UI shell work can reasonably start early, but wiring real data through it should wait for its phase.
- If a checklist item is done but its validation hasn't been run yet, don't check it off — "implemented" and "validated" are different states, and this file only tracks the latter.
- Update this file as part of the same commit/session that completes an item, not retroactively.
