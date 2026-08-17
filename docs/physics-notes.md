# Physics Layer Notes — Orbital Risk Advisor

This file is a stage-by-stage reference for `backend/physics/`. Read it before writing or reviewing any code in that directory. It exists to make the _why_ behind each stage explicit — not just what library call to make, but what can silently go wrong, and what to actually verify.

This is the highest-scrutiny part of the project. A wrong number here is worse than a missing feature — the project's credibility rests on this layer being genuinely correct, not just plausible. Treat every subsection's "watch out for" list as real, not decorative.

---

## Cross-cutting rule before any of this: unit and frame discipline

Almost every real orbital-mechanics bug — including some that have caused actual mission failures historically — traces back to a units or frame mismatch that looked fine at a glance. Before writing code in this directory:

- **Pick one internal unit convention and hold to it everywhere**: km (not m), seconds (not days), radians (not degrees) is the standard recommendation. Don't let individual functions silently convert back and forth — convert at the boundary (e.g. right after TLE parsing) and never again.
- **Make frame explicit in code, structurally, not just in comments.** A variable holding a position should make its frame (TEME/ECI/ECEF) unambiguous from its name or type — e.g. `pos_teme`, `pos_ecef`, or a lightweight wrapper class that tags a vector with its frame. This should make it structurally awkward to accidentally mix frames, not just discouraged by convention.

This single discipline prevents the majority of the bug class most likely to produce a wrong-but-plausible-looking Pc number.

---

## Stage 1 — TLE ingest

**What it does:** parses a TLE (Two-Line Element set) — a fixed-width text encoding of six orbital elements plus a drag term, at a specific epoch time.

**Know before coding:**

- A TLE is a snapshot at its epoch, not a trajectory — accuracy degrades the further you propagate from epoch. This matters directly for the Envisat replay: use TLEs close to each of the four historical prediction days, not one TLE reused across all four.
- TLE fields are fixed-column, not delimited. An off-by-one-column parsing bug reads garbage silently — don't hand-roll this parser; use the library's parser, but sanity-check its output against a TLE you've read by hand at least once.
- Mean motion is in revolutions/day in the raw TLE — convert to your internal unit convention immediately at ingest, don't let revs/day leak downstream.
- BSTAR (drag term) will differ meaningfully between Envisat and the Zenith-2 debris fragment — this is part of why their predicted positions diverge differently over time, and part of the actual story the demo tells.

**Verify:** read one real TLE by hand, field by field, before trusting the parser on it.

---

## Stage 2 — SGP4 propagation

**What it does:** given a TLE, computes the object's position/velocity at a requested time T.

**Know before coding:**

- SGP4 models Earth's oblateness (J2) and a simplified drag model. It does **not** model Moon/Sun gravity or higher-order perturbations. This is the accepted standard, not a shortcut — but it means accuracy degrades over longer propagation windows. This is a legitimate, citable limitation if a judge asks.
- **Output frame is TEME** (True Equator Mean Equinox). This is the single most important fact in this whole layer — forgetting it is exactly the bug Stage 3 exists to prevent. Never treat raw SGP4 output as if it were already ECI or ECEF.
- Screening (Stage 4) calls this function many times across object-pairs and timesteps — performance matters here specifically. Confirm whether your library usage is vectorized/batched (the Numba-accelerated `sgp4` package supports this) rather than looping propagation calls naively in Python.

**Verify:** propagate one object at a few different times and sanity-check that the position changes the way you'd expect (progressing along the orbit, slow altitude decay from drag, etc.) — don't just trust the numbers because the function ran.

---

## Stage 3 — Reference frame transforms (highest bug risk in this project)

**What it does:** converts SGP4's TEME output into ECI (for collision geometry math) and ECEF (for lat/long/altitude, used by the 3D globe).

**The three frames, and why each exists:**

- **TEME** — SGP4's native output. Inertial, but uses an "of-date" mean equinox rather than a fixed reference epoch — subtle enough to trip people up, since it looks like a standard inertial frame but isn't quite one.
- **ECI (e.g. J2000)** — a clean inertial frame with a fixed reference epoch. Needed because relative-position/velocity math at TCA needs a well-defined, unchanging coordinate system.
- **ECEF** — Earth-fixed, rotates with Earth. Needed to derive lat/long/altitude for the globe visualization.

**Why bugs hide here specifically:**

- The transforms depend on Earth's rotation angle at a _specific instant_. A time-standard error (UTC vs. something else) or an off-by-a-few-seconds bug silently shifts the ECEF position to the wrong point on Earth — and a few hundred km of error on a rendered globe doesn't look obviously broken, it just looks like a slightly different, still-plausible position.
- Mixing frames without noticing (e.g. treating a TEME vector as ECI when computing relative position between two objects) often doesn't crash and doesn't look absurd — the two objects' _relative_ geometry can still look roughly self-consistent even in the wrong frame. **This is the most dangerous bug class in the entire project**: quietly wrong, not obviously wrong.

**Know before coding:**

- Use `skyfield` or `astropy` for the actual rotation math. Do not hand-roll rotation matrices.
- For any position variable in your code, you should be able to state its frame without tracing back through the function that produced it.

**Verify (mandatory gate — see `implementation-checklist.md` Phase 2):** propagate the ISS, convert through the full TEME→ECI→ECEF pipeline, and compare the resulting lat/long/altitude against a real, current public tracker. Use live/current data for this check, not stale or cached data — the whole point is confirming the pipeline against ground truth at a known moment.

---

## Stage 4 — Conjunction screening

**What it does:** finds candidate close approaches between object pairs without checking every possible pair at fine resolution (computationally infeasible at catalog scale).

**Two-stage filter, and why both stages exist:**

- **Coarse filter** — cheap geometric check that rules out pairs whose orbits can't possibly come close (e.g. very different altitude/inclination regimes). The point is speed: cheaply discard the vast majority of pairs before doing expensive work on the rest.
- **Fine propagation** — for surviving candidate pairs, propagate across the analysis window (e.g. 24–72 hours) at fine time steps and compute minimum separation; flag anything under a threshold (a few km) as worth deeper analysis.

**Know before coding:**

- Decide your time window and timestep resolution deliberately — too coarse a timestep and you can miss a close approach that occurs _between_ sample points. This is a correctness risk, not just a performance knob. Standard approach: coarse timestep for the initial scan, then refine locally (this is what Stage 5 does).
- This project is scoped to Envisat + a defined candidate set (see `docs/architecture.md`), not the full catalog — the two-stage structure is still worth implementing faithfully even at small scale, since it mirrors the real architecture correctly. Being able to explain _why_ the two-stage approach exists (not just that you used it) is a meaningful signal to a technical judge.

---

## Stage 5 — TCA (Time of Closest Approach) refinement

**What it does:** once a close approach is flagged in a coarse window, refines the exact time of minimum separation. Pc is computed at this specific moment for instantaneous Pc (the project's stated default).

**Know before coding:**

- Conceptually: relative distance between the two objects, as a function of time, has a minimum somewhere in the flagged coarse window. Find it either by sampling more finely around the candidate, or by numerically root-finding where the derivative of relative distance crosses zero.
- This is a **refinement on top of Stage 4**, not a separate physics concept — it reuses Stage 2/3 propagation and frame machinery at finer time resolution. It should not be implemented as a parallel, independent pipeline.

---

## Stage 6 — Collision probability (Pc): the headline number

The part most likely to draw a hard technical question. Understand the _shape_ of the method even though you're implementing from a published formula rather than deriving it.

**The core idea, in plain terms:**

- TLE-derived positions aren't perfectly accurate — each object's true position has uncertainty, described by a covariance matrix (a "fuzzy ellipsoid" of likely position, not a single exact point).
- At TCA, both objects have this positional uncertainty. Pc is the probability that they're actually within a collision-causing distance of each other, _given_ that uncertainty — not "did the two point-estimates touch," but "what's the probability of touching, given how uncertain we are about where they actually are."
- **The key industry simplification (Foster/Chan/Alfano 2D/encounter-plane method):** because the encounter window is short, relative motion is approximately linear over it, which lets you reduce a 3D probability integral to a 2D problem in the plane perpendicular to relative velocity. This is standard, legitimate practice — not a shortcut unique to this project — but you should be able to explain _why_ it's valid (short encounter → approximately rectilinear relative motion → problem collapses to 2D), not just cite that it's common.

**Get these operationally right:**

- **Combined hard-body radius** — the two objects' combined physical size, defining the control volume you integrate probability over. A units or magnitude error here throws Pc off by orders of magnitude even if everything else is correct.
- **Covariance matrix construction** — TLEs alone do not give you a covariance matrix. Resolve explicitly, and document in `docs/validation-notes.md`, where your covariance for real TLE-based objects (Envisat, Zenith-2 debris) comes from — a standard assumed covariance for validation purposes, or a documented estimation approach. Do not hand-wave this; it's a very plausible judge question.
- **Conservative-bias principle:** when an assumption is uncertain, standard practice biases toward _overestimating_ Pc rather than underestimating — the cost of a false alarm is much lower than a missed real risk. Worth stating explicitly in your writeup if you've followed it.

**Validation contract (non-negotiable, see `implementation-checklist.md` Phase 3):**

- Build and pass the Alfano synthetic test case (Pc ≈ 0.10034) **first**, before touching real TLE data in this stage. It isolates "is my math right" from "is my real-world data noisy" — the cleanest, cheapest correctness signal available.
- Only after that passes, validate the Envisat replay against the published historical range (miss distance 81–316m, Pc 1.4×10⁻⁴–5.5×10⁻⁴ across the four prediction days).

---

## Stage 7 — Maneuver modeling

**What it does:** applies an instantaneous delta-V (velocity change) at a chosen point before TCA, re-propagates, and recomputes miss distance/Pc for the new trajectory — compared against the original.

**Know before coding:**

- This reuses Stage 2/3 machinery again: perturb the velocity component of the state vector at the chosen pre-TCA time, then re-run propagation → frame transform → TCA/Pc for the new trajectory. It is not a separate physics model.
- **Honest scope, already documented in `CLAUDE.md` 1.4:** this does not model real thruster burn dynamics, fuel consumption, burn duration, or attitude control. State this plainly wherever the feature is described — the risk isn't that it's simplified, it's presenting it as more complete than it actually is.

---

## Quick pre-flight checklist before wiring up `backend/physics/`

- [ ] Internal unit convention decided and documented (recommend: km, seconds, radians)
- [ ] Frame-labeling convention decided (naming scheme or wrapper type)
- [ ] You've read one real TLE by hand and can identify each field
- [ ] You understand why TEME ≠ ECI ≠ ECEF, not just that they're "different frames"
- [ ] You know where your Pc covariance matrix is actually going to come from — this should not be an open question once Stage 6 starts
- [ ] You can explain, in your own words, why the 2D/encounter-plane Pc method is valid — not just that it's standard practice
