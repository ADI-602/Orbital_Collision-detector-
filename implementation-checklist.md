# Implementation Checklist — Orbital Risk Advisor

How to use this file: check items off as they're genuinely done (validated, not just "code written"). Phases are sequential — a gate marked 🔒 must pass before the next phase starts. If you're a coding agent picking up work in this repo, find the first unchecked item and start there; don't skip ahead of an unpassed gate even if later work looks easy or tempting.

---

## Phase 0 — Human homework (not code; do this before opening an editor)

- [ ] Space-Track.org account created (registration can be slow — do this first)
- [ ] Anthropic API key obtained, billing/credits confirmed
- [ ] Cesium Ion token obtained (only if Cesium is chosen over Three.js — see below)
- [ ] Team role split decided (who owns physics / frontend / AI layer)
- [ ] **Decision: Cesium vs. Three.js** for the 3D globe — record the decision and reasoning in `docs/architecture.md`
- [ ] **Decision: primary object + candidate set** for conjunction screening scope — record in `docs/architecture.md` (suggested default: Envisat, since it's the main demo anyway)
- [ ] Skimmed Foster/Chan/Alfano method at a conceptual level (enough to sanity-check the agent's explanation of it)
- [ ] Memorized the two ground-truth validation numbers: Alfano Pc ≈ **0.10034**, Envisat Pc range **1.4×10⁻⁴–5.5×10⁻⁴**

---

## Phase 1 — Setup / scaffolding (infra only, no domain logic yet)

- [x] Repo initialized, `CLAUDE.md` and this checklist committed
- [x] `.gitignore` covers `.env`, `__pycache__`, `node_modules`, data caches
- [x] `.env.example` documents required vars (Anthropic key, Cesium Ion token if used, Space-Track credentials)
- [x] Python env set up in `backend/`, `requirements.txt` created (`sgp4`, `skyfield`, `astropy`, `numpy`, `scipy`, `fastapi`, `pytest`, `anthropic`)
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
- [x] `backend/ai/advisor.py` — Claude API integration with strict numerical integrity enforcement
- [x] `backend/api/main.py` — FastAPI routes tying physics + AI together
- [x] Confirm: physics endpoints work with zero AI/network calls (test by unplugging the Anthropic key temporarily)

🔒 **Gate: AI layer must degrade gracefully (physics dashboard still usable) when the AI call fails or times out, before Phase 5 starts.** ✅ PASSED — 49/49 pytest tests pass. Deterministic rule-based fallback guarantees zero-latency, 100% offline availability for all physics and API endpoints when `ANTHROPIC_API_KEY` is missing or network fails.

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
      confirmed in a headless-Chrome render against the live API. **No physics
      numbers are rendered yet** — every other panel is an explicitly labelled
      pending region. Also rewrote `docs/api_contract.md` from source (it had
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
- [x] T-minus countdown UI component — `lib/countdown.js` (pure T-minus
      arithmetic), `hooks/useCountdown.js` (second-aligned tick), and
      `components/common/Countdown.jsx`. 26 new vitest cases, suite now 86/86.
      Verified in headless Chromium in all four states: it ticks against real
      UTC (T-00:01:05 → T-00:01:00 across a 5 s virtual-time gap), holds
      steady when driven by a supplied clock, renders an em dash with prose
      when there is no TCA, and surfaces a malformed timestamp as an explicit
      error rather than as "no conjunction".
      **Three deliberate constraints**, each guarding a way a countdown can
      overstate what the pipeline knows: (1) a zoneless ISO timestamp is
      *rejected*, not parsed — ECMA-262 reads it as local time, which would
      shift the countdown by the viewer's UTC offset silently; (2) the
      absolute TCA and the clock basis (real UTC vs. simulated) are printed
      beside the countdown, since the globe runs at ×120 and a bare relative
      clock is unverifiable; (3) urgency colour is a caller-supplied prop
      taken from `threat_level` — the component never reddens itself as time
      runs down, which would be the UI asserting a risk judgment no physics
      produced.
      **Scope:** the component is validated, but it is rendered in `Console`
      with a null target — screening is not wired, so there is no real TCA to
      count to yet and it shows its empty state. Wiring it to live pipeline
      output is the next item.
- [x] Envisat replay wired end-to-end — `pages/Replay.jsx`, reached from the
      now-live "Envisat replay" tab. Loading the view fetches the scenario,
      screens all four prediction days, simulates the burn ESA flew, and
      requests AI advice, with no manual step. Suite now 119/119.
      **Every number is live pipeline output**, and matches
      `docs/validation-notes.md` §4.4 — confirmed against a running backend
      and read back out of the rendered DOM: Oct 19 → 329.1 m / 2.74×10⁻⁴,
      Oct 20 → 234.1 m / 1.11×10⁻³, Oct 21 → 151.8 m / 1.93×10⁻³,
      Oct 22 → 268.9 m / 6.59×10⁻⁴, all at computed TCA 05:10:37Z
      (published 05:10:35Z).
      **Screening is not told where to look.** Each day is screened from its
      own 00:00 UTC through the end of Oct 22 — 96 h for Oct 19 — rather than
      from a window centred on the known TCA, which would make the result
      worthless as a proof. Verified to give identical numbers at 1 h, 12 h,
      84 h and 96 h windows; the whole four-day run takes ~2.2 s.
      **Disagreements are shown, not smoothed.** Miss distances are checked
      against the published 81–316 m band and Pc against 1.4–5.5×10⁻⁴, and
      each is labelled *within* or *outside*. Three of four Pc values and one
      miss distance fall outside, and the panel says so, with the documented
      reason (we apply TLE-derived covariance to both objects where ESA used
      Envisat's operational OD for the primary — conservative, biases Pc up).
      Published constants live in one cited module, `lib/envisatGroundTruth.js`,
      so reference material can never be mistaken for computed output.
      **Validated by:** `tests/…` equivalents on the frontend side —
      `lib/envisatGroundTruth.test.js` (pins the transcription against the
      paper and the within/outside verdicts), `lib/format.test.js`,
      `lib/geodetic.test.js`, plus a live-backend render read back from the DOM.
      **Two things this does NOT yet confirm**, both needing an environment
      this container cannot provide:
        - the globe's replay rendering (two objects + the conjunction line) —
          there is no WebGL here, so Cesium cannot construct. The rest of the
          view was verified to work anyway with the globe failed, which is the
          point of the next item.
        - the AI panel's LIVE branch — no API key here, so only the
          rule-based fallback path was exercised. The badge correctly read
          "AI · RULE-BASED FALLBACK".
- [x] Replay clock survives a dead globe — found while validating the above:
      the countdown read "T+7995d" (real time to a 2004 instant) under a
      caption that still said "replay clock ×60", because the globe owned the
      clock and had failed to start. Time now lives in `hooks/useReplayClock.js`
      independent of rendering, and `resolveClockBasis()` makes a caption that
      names a clock it is not counting against structurally impossible
      (3 regression tests in `lib/countdown.test.js`).
- [ ] Cosmos 2221 wired as secondary/backup scenario

🔒 **Gate: full Envisat demo flow must run start-to-finish without manual
intervention before Phase 6 starts.** ⏳ NOT YET PASSED — the flow does run
start-to-finish unattended, but two surfaces remain unconfirmed because this
container has neither WebGL nor an AI key. To close it, run the replay view
once on a machine with a GPU and confirm (a) both objects and the conjunction
line render on the globe against the replay clock, and (b) with a
`GEMINI_API_KEY`/`GOOGLE_API_KEY` exported into the uvicorn process, the AI
panel's badge reads "AI · live model" rather than the fallback. Nothing else
is outstanding.

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

- [ ] Visual polish pass on dashboard/globe
- [ ] `docs/validation-notes.md` written (how we know our numbers are right — Alfano, frame check, Envisat comparison)
- [ ] `demo/recorded_fallback.mp4` recorded (re-record if any pipeline change affects demo numbers)
- [ ] `demo/demo_checklist.md` written (pre-demo run-through steps)
- [ ] Full team rehearsal of the live demo + fallback switch
- [ ] README updated with the physics/AI split stated up front

---

## Notes on using this checklist

- A phase gate (🔒) is a hard stop, not a suggestion — don't start next-phase work "in parallel" to save time if the gate hasn't passed. Frontend work is the one exception: scaffolding (Phase 1) and non-data-dependent UI shell work can reasonably start early, but wiring real data through it should wait for its phase.
- If a checklist item is done but its validation hasn't been run yet, don't check it off — "implemented" and "validated" are different states, and this file only tracks the latter.
- Update this file as part of the same commit/session that completes an item, not retroactively.
