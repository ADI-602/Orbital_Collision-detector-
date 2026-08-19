# Phase 3 Plan — Collision Probability Pipeline

## Overview

Phase 3 builds the four remaining physics modules and their validation tests.
The goal is a working, validated Pc (collision probability) number that a
technical judge can scrutinise. Everything is broken into sub-phases with hard
validation gates between them — no sub-phase starts until the previous one's
gate passes.

The order is deliberately conservative:
1. Prove the Pc math is correct on synthetic data (Alfano) before touching
   real TLE data.
2. Prove screening + TCA work before feeding them into Pc.
3. Only wire the Envisat replay (real data) once Pc is validated.

Phase 3 gate (from implementation-checklist.md): **both** the Alfano test
AND the Envisat replay must pass before Phase 4 starts.

---

## Sub-phase 3A — Covariance decision + docs foundation

### Intent
Before any code is written, resolve the one open architectural question from
Phase 2: where does the covariance matrix come from? The answer directly
determines how `collision_probability.py` accepts inputs and how the Envisat
replay is wired.

Decision: hardcode the covariance values published in ESA's SDC4 paper
("Collision Avoidance for Operational ESA Satellites") for the
Envisat/Zenith-2 October 2004 event specifically. These are the most
authoritative values for the demo scenario and make the Envisat replay
directly traceable to a published source.

Also create `docs/validation-notes.md` now — it should be written before the
physics, not after, so each stage has a place to record what was verified.

### Expected Outcomes
- `docs/validation-notes.md` exists with sections for: covariance source,
  Alfano test case, frame transform validation (already done), Envisat replay
- The SDC4 paper covariance values for Envisat and Zenith-2 are documented in
  that file with a citation
- No code changes yet

### Todo List
- [ ] Read ESA SDC4 paper / locate published covariance values for Envisat and
      Zenith-2 debris for the Oct 2004 conjunction
- [ ] Create `docs/validation-notes.md` documenting:
      - Covariance source and exact values (or best available proxy if exact
        paper values are not publicly accessible)
      - Frame transform validation (already passed — copy from checklist)
      - Alfano test case inputs and expected output (Pc ≈ 0.10034)
      - Envisat replay: 4 prediction days, expected miss distance range
        81–316 m, expected Pc range 1.4×10⁻⁴–5.5×10⁻⁴
- [ ] Update `implementation-checklist.md` when done

### Relevant Context
- `docs/physics-notes.md` Stage 6: "Covariance matrix construction — TLEs
  alone do not give you a covariance matrix. Resolve explicitly and document
  in validation-notes.md."
- `docs/project-doc.md` §4.2: published Envisat/Zenith-2 historical numbers
- ESA reference: "Collision Avoidance for Operational ESA Satellites"
  (SDC4 proceedings paper)

### Status
[ ] pending

---

## Sub-phase 3B — Collision probability: Alfano-first implementation

### Intent
Implement `collision_probability.py` using the Foster/Chan/Alfano 2D
encounter-plane method and validate it against the Alfano synthetic test case
(Pc ≈ 0.10034) before it ever touches real TLE data. This is the cleanest
signal that the math is correct, completely decoupled from data quality.

This sub-phase produces ONLY the Pc module and the Alfano regression test.
No screening, no TCA, no real TLE data involved here.

### Expected Outcomes
- `backend/physics/collision_probability.py` accepts: two ECI state vectors
  at TCA, two covariance matrices (3×3), combined hard-body radius → returns
  Pc as a float
- `tests/test_alfano_case.py` passes: hardcoded Alfano inputs reproduce
  Pc ≈ 0.10034 (tolerance ±0.001)
- The Pc formula is traceable to the published Foster/Chan/Alfano reference —
  documented in `docs/validation-notes.md`

### Todo List
- [ ] Research and document the exact Foster/Chan/Alfano 2D encounter-plane
      closed-form formula (source: JSpOC "How JSpOC Calculates Pc", or
      Alfano 2005 AAS paper). Do NOT derive from scratch.
- [ ] Implement `collision_probability.py`:
      - `compute_pc(state_eci_1, state_eci_2, cov1_eci, cov2_eci, hard_body_radius_km)`
      - Project combined covariance onto the encounter plane (perpendicular
        to relative velocity at TCA)
      - Compute 2D Gaussian integral over circle of radius = hard_body_radius_km
      - Return Pc as float, log inputs and intermediate values
- [ ] Hardcode the Alfano synthetic test case inputs in
      `tests/fixtures/alfano_case.py` (or inline in the test)
- [ ] Write `tests/test_alfano_case.py`: single test, asserts
      `abs(Pc - 0.10034) < 0.001`
- [ ] Run `pytest tests/test_alfano_case.py` — must pass before 3C starts
- [ ] Document formula, assumptions, and conservative-bias principle in
      `docs/validation-notes.md`

### Relevant Context
- `docs/physics-notes.md` Stage 6: full explanation of the 2D method, what
  to get right (hard-body radius units, covariance construction), and the
  validation contract
- `docs/project-doc.md` §3.6 and §4.1: Alfano test case spec (Pc ≈ 0.10034)
- `backend/physics/frames.py`: `StateVectorECI` is the input type
- `bob.md` §1.1: "Implement Pc from a published closed-form reference formula
  — do not derive the Gaussian integral from scratch"
- Phase 2 watch-out: `ecef_to_geodetic()` re-propagates from scratch; Pc does
  not use that function so this is not a blocker here

### Status
[ ] pending

---

## Sub-phase 3C — Screening + TCA

### Intent
Implement conjunction screening and TCA refinement as two separate modules
that feed each other. These sit between TLE ingest (Phase 2) and Pc (3B) in
the pipeline. They do not introduce any new physics — they reuse
`propagation.py` and `frames.py` from Phase 2 at different scales.

Screening is scoped to Envisat + a defined candidate set (not full catalog —
this is the deliberate scope reduction from `docs/architecture.md`).

### Expected Outcomes
- `backend/physics/screening.py`: given primary satellite + candidate list →
  returns list of `ConjunctionCandidate` (object pair + coarse TCA window)
  for any pair with minimum separation under threshold (e.g. 5 km) across
  the analysis window
- `backend/physics/tca.py`: given a `ConjunctionCandidate` → returns refined
  TCA time and miss distance (km) by minimising relative distance within
  the flagged window
- Both modules log timestep, separation, and flagged pairs so a wrong result
  is traceable
- The vectorised propagation path (skyfield array API) is used for screening
  to avoid the Python-loop performance issue flagged in Phase 2

### Todo List
- [ ] Fix `propagate_sequence()` in `propagation.py` to use skyfield's
      vectorised array path before screening uses it at scale
- [ ] Implement `screening.py`:
      - Coarse filter: compare altitude regimes and inclination bands to
        cheaply rule out pairs with no geometric proximity possibility
      - Fine propagation: propagate surviving pairs at 60s timesteps over
        24–72h window, compute separation at each step
      - Flag pairs with minimum separation < 5 km as conjunction candidates
      - Return `ConjunctionCandidate` dataclass with: satellite pair, coarse
        TCA window (start/end time), minimum separation found
- [ ] Implement `tca.py`:
      - Accept a `ConjunctionCandidate` window
      - Minimise relative distance using `scipy.optimize.minimize_scalar` or
        finer timestep sampling within the window
      - Return refined TCA time (skyfield Time), miss distance (km),
        relative velocity at TCA (km/s)
- [ ] Write a quick smoke test (not a gate test) that runs screening on two
      hardcoded TLEs with a known close approach and confirms the pair is
      flagged and TCA is refined to within 30s of the expected time

### Relevant Context
- `docs/physics-notes.md` Stage 4 and Stage 5
- `backend/physics/propagation.py`: `propagate()` and `propagate_sequence()`
- Phase 2 watch-out: `propagate_sequence()` is currently a Python loop —
  must be vectorised before being called in screening at scale
- `docs/architecture.md`: Envisat + SSO debris candidate set is the defined
  scope

### Status
[ ] pending

---

## Sub-phase 3D — Envisat replay integration test

### Intent
Wire the full pipeline (screening → TCA → Pc) on real historical TLE data for
the Envisat/Zenith-2 Oct 2004 conjunction and validate against published
numbers. This is the hardest sub-phase and the Phase 3 gate.

If numbers are off: stop, debug, do not adjust the narrative. This is
explicitly called out in `bob.md` and `implementation-checklist.md` as a
stop-and-fix moment.

Four prediction days to replay (from `project-doc.md` §4.2):
- Oct 19, 2004 (T-3 days)
- Oct 20, 2004 (T-2 days)
- Oct 21, 2004 (T-1 day)
- Oct 22, 2004 (day of TCA, 05:10:35 UTC)

Expected output per day: miss distance 81–316 m, Pc 1.4×10⁻⁴–5.5×10⁻⁴.

### Expected Outcomes
- `tests/fixtures/envisat_tles.py`: hardcoded historical TLEs for Envisat and
  Zenith-2 fragment for each of the four prediction days
- `tests/test_envisat_replay.py`: parametrised test across the four days,
  each asserting miss distance in [50, 400] m and Pc in [5×10⁻⁵, 1×10⁻³]
  (slightly wider than published range to allow for implementation tolerance)
- All four assertions pass
- `docs/validation-notes.md` updated with actual computed values vs. published
  values for each of the four days

### Todo List
- [ ] Source historical TLEs for Envisat (NORAD 27386) and the Zenith-2 debris
      fragment for Oct 19–22 2004 from Space-Track.org historical archive
      (requires Space-Track account — credentials in `.env.example`)
- [ ] Hardcode those TLEs into `tests/fixtures/envisat_tles.py` with the
      prediction day and source documented
- [ ] Hardcode the ESA SDC4 covariance values (from sub-phase 3A) into the
      fixture file alongside the TLEs
- [ ] Write `tests/test_envisat_replay.py`: parametrised across 4 days,
      runs full pipeline (ingest → propagate → TCA → Pc), asserts output
      is in the expected range
- [ ] Run the test — if numbers are in range: pass, update checklist, done
- [ ] If numbers are NOT in range: debug pipeline stage by stage using
      intermediate logs (miss distance, TCA time, covariance projection) —
      do not adjust the expected range or the demo narrative
- [ ] Update `docs/validation-notes.md` with actual vs. published numbers
- [ ] Run full pytest suite to confirm no regressions

### Relevant Context
- `docs/project-doc.md` §4.2: published historical numbers
- `docs/physics-notes.md` Stage 6: covariance source requirement
- `bob.md` §1.2: "If your numbers are wildly off, that's a bug — do not
  adjust the demo narrative to hide it; fix the pipeline or surface the
  discrepancy"
- `implementation-checklist.md` Phase 3 gate: both Alfano AND Envisat must
  pass before Phase 4

### Status
[ ] pending

---

## Phase 3 Gate

Both of the following must pass before Phase 4 (maneuver + AI layer) begins:

- `pytest tests/test_alfano_case.py` → Pc ≈ 0.10034 ✅
- `pytest tests/test_envisat_replay.py` → all 4 days in range ✅

If either fails, it is a stop-everything event. Debug before proceeding.

---

## Watch-outs carried in from Phase 2

1. `propagate_sequence()` is a Python loop — fix in 3C before screening uses
   it at scale.
2. `ecef_to_geodetic()` re-propagates from the satellite object, not the
   passed state vector — not a blocker for Pc (which works in ECI) but must
   be fixed before Phase 4's maneuver module uses it.
3. Covariance source must be documented in `docs/validation-notes.md` before
   `collision_probability.py` is written (handled in 3A).
