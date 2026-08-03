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

- [ ] `backend/physics/tle_ingest.py` — CelesTrak fetch + parsing for the chosen object + candidate set
- [ ] `backend/physics/propagation.py` — SGP4 wrapper via `skyfield`/`sgp4`
- [ ] `backend/physics/frames.py` — TEME → ECI → ECEF transforms via `skyfield`/`astropy`
- [ ] `tests/test_frame_transforms.py` — propagate the ISS, convert frames, compare resulting lat/long/altitude against a known public tracker

🔒 **Gate: frame transform validation test must pass before Phase 3 starts.** This is explicitly called out in CLAUDE.md as the step where silent bugs hide — don't build Pc math on top of unvalidated frames.

---

## Phase 3 — Collision probability (the technically riskiest part — front-load this)

- [ ] `backend/physics/screening.py` — coarse filter + fine propagation, scoped candidate set
- [ ] `backend/physics/tca.py` — time of closest approach refinement
- [ ] `backend/physics/collision_probability.py` — Pc via 2D/encounter-plane method (Foster/Chan/Alfano), following JSpOC's stated assumptions
- [ ] `tests/test_alfano_case.py` — hardcoded regression test, must reproduce Pc ≈ 0.10034
- [ ] `tests/test_envisat_replay.py` — integration test replaying the Oct 2004 event across the four historical prediction days

🔒 **Gate: both the Alfano test and the Envisat replay must pass before Phase 4 starts.** If Envisat numbers are off, this is a stop-and-debug moment — do not proceed to build the demo UI on top of unverified numbers, and do not adjust the narrative to paper over a discrepancy.

---

## Phase 4 — Decision support (maneuver + AI layer)

- [ ] `backend/physics/maneuver.py` — instantaneous delta-V modeling, pre/post-maneuver Pc comparison
- [ ] `backend/ai/schema.py` — structured input/output contracts (pydantic models) for the AI layer
- [ ] `backend/ai/prompts.py` — versioned prompt templates (explanation / tradeoff / recommendation)
- [ ] `backend/ai/advisor.py` — Claude API integration; verify it never restates a number differently than given (spot-check a few calls against known input)
- [ ] `backend/api/main.py` — FastAPI routes tying physics + AI together
- [ ] Confirm: physics endpoints work with zero AI/network calls (test by unplugging the Anthropic key temporarily)

🔒 **Gate: AI layer must degrade gracefully (physics dashboard still usable) when the AI call fails or times out, before Phase 5 starts.**

---

## Phase 5 — Frontend + integration

- [ ] Dashboard skeleton wired to backend API
- [ ] 3D globe rendering live TLE data for the chosen object + candidate set
- [ ] T-minus countdown UI component
- [ ] Envisat replay wired end-to-end (globe + countdown + Pc trend + AI recommendation, all live from real pipeline output)
- [ ] Cosmos 2221 wired as secondary/backup scenario

🔒 **Gate: full Envisat demo flow must run start-to-finish without manual intervention before Phase 6 starts.**

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
