# Orbital Risk Advisor — Debris Collision-Risk Decision Support Platform

**Theme fit:** Space Exploration — predictive spacecraft monitoring, space debris tracking & collision avoidance, decision-support systems
**Timeline:** 4 weeks
**One-liner:** A real orbital-mechanics pipeline (TLE ingest → SGP4 propagation → collision probability) paired with an AI layer that turns hard physics into plain-language, actionable maneuver recommendations for a human operator.

---

## 1. The Problem

Space agencies and satellite operators track tens of thousands of objects in orbit — active satellites, dead satellites, and debris fragments from collisions and explosions. Multiple times a day, pairs of objects come close enough to each other that operators need to assess collision risk and decide whether to move a satellite out of the way.

The physics behind this (orbit propagation, collision probability) is well-established but genuinely complex, and the output — a probability number and a covariance matrix — is not something a non-specialist (or even a specialist under time pressure) can act on quickly. Real conjunction warnings arrive with a short decision window, and the tradeoffs (fuel cost vs. risk reduction vs. mission schedule impact) are not always obvious from raw numbers alone.

**What we're building:** a system that does the real physics correctly, then uses AI specifically where AI adds genuine value — translating a quantitative risk assessment and a set of maneuver options into a clear, explained recommendation a human can act on quickly. We are explicit that the AI's job is interpretation and decision support, not "predicting collisions better than physics" — the physics does the physics, the AI makes the physics usable.

---

## 2. Why This Project (and why it can win)

- **Most hackathon "space debris" projects fake or oversimplify the physics.** Getting real orbital mechanics right — using validated algorithms and validating against known real-world test cases — is a strong technical differentiator that's hard to bluff.
- **It directly answers the brief's core question**: "how can AI help transform space exploration from data-heavy to insight-driven systems?" Here the "data" is a covariance matrix and a probability number; the "insight" is a maneuver recommendation in plain English with clear tradeoffs.
- **It's honest about what AI does and doesn't do**, which is more credible to technical judges than a project that claims AI is doing the orbital mechanics.
- A live, real-time 3D globe with real satellites and a replayed real historical near-miss is a strong visual "wow" moment for a demo.

---

## 3. Physics Pipeline (what has to be technically correct)

This is the backbone of the project. Each stage below is a real, separate piece of work — don't compress these into "just call a library and move on." Understanding _why_ each stage exists is what will let the team explain and defend the project to judges.

### 3.1 Orbital elements & TLEs (the input data)

A TLE (Two-Line Element set) encodes an object's orbit as:

- **Inclination (i)** — tilt of orbital plane vs. Earth's equator
- **RAAN (Ω)** — right ascension of ascending node (orients the plane around Earth's axis)
- **Eccentricity (e)** — how elliptical the orbit is
- **Argument of perigee (ω)** — orientation of the ellipse within its plane
- **Mean anomaly (M)** — where the object is right now along its orbit
- **Mean motion (n)** — orbits per day
- **BSTAR** — a drag/ballistic coefficient term

Source: CelesTrak and Space-Track publish TLEs for the full public satellite catalog, including debris.

### 3.2 Orbit propagation — SGP4

Given a TLE, SGP4 answers "where is this object at time T?" It's the NORAD-designed standard still used as the baseline for every catalogued object. It models Earth's oblateness (J2 term) and a simplified exponential atmospheric drag model — it does **not** model third-body gravity (Moon/Sun) or higher-order perturbation terms. That's an accepted tradeoff for speed and universal applicability from TLE data alone.

**Do not reimplement SGP4.** Use the well-maintained `sgp4` Python package (Brandon Rhodes' implementation, Numba-accelerated) or `skyfield` built on top of it. This is a solved problem — our value-add is downstream of this step.

Key detail worth understanding: objects with different BSTAR values respond differently to drag. A maneuvering satellite doing continuous drag makeup will hold its orbit more precisely over time than an uncontrolled debris fragment. Good detail to know for demo narration.

### 3.3 Reference frame transforms (where bugs hide)

SGP4 outputs position/velocity in the **TEME** frame (True Equator Mean Equinox). Collision geometry calculations need a clean inertial frame (**ECI**), and 3D visualization needs an Earth-fixed frame with lat/long/altitude (**ECEF**). Each conversion involves Earth rotation models and is easy to get subtly wrong — this is explicitly the step where real conjunction-assessment tools report the most silent bugs.

**Action item:** use `skyfield` or `astropy` for the actual rotation math — do not hand-roll rotation matrices. But **validate this step explicitly**: propagate a known object (e.g., the ISS), convert frames, and sanity-check the resulting lat/long/altitude against a known public tracker before building anything on top of it.

### 3.4 Conjunction screening (finding candidate close approaches)

You cannot check every possible pair of ~40,000+ catalogued objects against each other — it's computationally infeasible at hackathon scale. Standard practice is a two-stage filter:

1. **Coarse geometric filter** — quickly rule out object pairs whose orbits can't possibly come close (e.g., very different altitude/inclination regimes).
2. **Fine propagation** — for the remaining candidate pairs, propagate over the analysis window (e.g., next 24–72 hours) and compute minimum separation distance; flag anything under a threshold (a few km) as a close approach worth deeper analysis.

**Scope for this project:** don't attempt full-catalog all-vs-all screening. Pick one object of interest (or a small handful) and screen against a reasonable candidate set (known debris/satellites in similar orbital regimes). This is a deliberate, defensible scope reduction — say so explicitly in the writeup.

### 3.5 Time of Closest Approach (TCA)

Once a close approach is flagged in a coarse time window, refine the exact time of minimum separation — either by propagating at finer time steps around the coarse flag, or with a simple numerical minimization (derivative of relative distance = 0). This is a refinement step on top of 3.4, not a separate algorithm.

### 3.6 Collision Probability (Pc) — the headline number

This is the part most likely to be scrutinized by a technically literate judge, so it needs to be genuinely correct.

**Standard framework:** the relative position between two objects at TCA is treated as a noisy estimate following a multivariate normal (Gaussian) distribution, with a known covariance matrix representing each object's positional uncertainty (TLEs are not perfectly accurate — this uncertainty is _why_ Pc isn't just "did they touch"). Pc is computed by integrating this 3D Gaussian probability density over a "control volume" defined by the two objects' combined hard-body radius (their combined physical size).

**Key simplification used industry-wide:** the standard **2D / encounter-plane method** (associated with Foster, Chan, and Alfano in the literature) reduces the 3D integral to a 2D problem in the plane perpendicular to relative velocity at TCA. This works because relative motion over the short encounter window is approximately linear/rectilinear — a "hyperkinetic" conjunction assumption. This is standard practice, not a shortcut that needs extra justification.

**JSpOC's own stated assumptions** (good implementation spec to follow):

- Object sizes are known or can be bounded
- The conjunction is short enough that relative motion is approximately rectilinear
- Gaussian statistics apply
- Covariance is known and constant through the encounter
- When an assumption is uncertain, bias the calculation toward **overestimating** Pc — conservative by design, so operators are warned rather than under-warned

**Instantaneous vs. cumulative Pc:** instantaneous Pc is risk at the exact TCA moment; cumulative Pc integrates risk over a time interval. Know the difference; instantaneous is the simpler and more common starting point.

**Implementation guidance:** implement from a published closed-form reference formula (Foster/Chan/Alfano methods are documented in the literature) — do not derive the integral from scratch under time pressure. **Validate your implementation against the known test case below before trusting your own output.**

### 3.7 Maneuver / avoidance modeling (the decision-support layer)

Given a flagged risky conjunction, model "what if we did a small burn":

- Apply a simple delta-V (velocity change) nudge at some point before TCA
- Re-propagate, recompute miss distance and Pc for the post-maneuver trajectory
- Compare pre- vs. post-maneuver risk

**Scope for this project:** this is intentionally simplified — we are modeling an instantaneous velocity change and its downstream effect on risk, **not** simulating real thruster burns, fuel consumption physics, or full spacecraft dynamics. State this simplification explicitly and honestly in the writeup; it's a legitimate scope choice, not a shortcut to hide.

---

## 4. Validation — Test Cases (proving the physics is actually correct)

Use these three together; they serve different purposes.

### 4.1 Alfano synthetic test case (primary numerical validation)

Alfano published standard synthetic conjunction test cases specifically for validating Pc software. For one such case, Alfano's own Monte Carlo simulation (30 million samples) yields **Pc = 0.10034**, matching independent 3D and Monte Carlo estimates from CARA (NASA's Conjunction Assessment Risk Analysis team).

**Use this as a unit test.** Hardcode the known input orbital states/covariances for this case and assert your Pc implementation reproduces ~0.10034. This decouples "is my math right" from "is real-world TLE data noisy" — it's your cleanest proof of correctness.

### 4.2 Envisat vs. Zenith-2 debris fragment, October 2004 (real historical event, main demo)

ESA tracked a real conjunction between its Envisat satellite and an explosion fragment of a Russian Zenith-2 rocket upper stage. Predicted closest approach: October 22, 2004, 05:10:35 UTC. Over four consecutive daily predictions in the days before TCA, predicted miss distance ranged from 81m to 316m, with Pc ranging from 1.4×10⁻⁴ to 5.5×10⁻⁴ — all exceeding ESA's accepted risk threshold of Pc ≤ 10⁻⁴. This triggered a real avoidance maneuver.

(Context: different agencies use different thresholds — France's CNES considers maneuvers above Pc ≤ 10⁻³. Verify current thresholds if quoting a specific figure live, as these can be updated.)

**Use this as your primary demo scenario.** It has real historical numbers at multiple points in time as TCA approaches — perfect for a "T-minus countdown" demo showing Pc evolve, culminating in a real maneuver decision your system can recommend.

### 4.3 Cosmos 2221 near-miss, February 28 2024 (recent, dramatic, secondary/backup demo)

LeoLabs observed a conjunction at 608 km altitude between a derelict Russian satellite (Cosmos 2221) and an operational NASA satellite. Miss distance was under 20 meters — only the seventh time in two years two intact, non-maneuverable objects had come this close. Combined hard-body radius ~11m produced a **Pc of 3.4%** — dramatically higher than the typical 10⁻⁴–10⁻⁶ range, the third-highest LeoLabs had recorded in LEO since January 2022.

**Use this as a secondary/backup demo scenario** — both objects were non-maneuverable, so it's a good "AI helps understand risk even when no action is possible" framing, and the high Pc number is a punchy, attention-grabbing figure for a demo.

---

## 5. Where AI Actually Adds Value (be precise about this — it's the core of the pitch)

Do **not** position the LLM as doing orbital mechanics or "predicting" collisions — that's the physics pipeline's job, and claiming otherwise will undermine credibility with technical judges. The AI's job is:

1. **Explaining risk in plain language** — translating "Pc = 4.2×10⁻⁴, miss distance 140m, combined hard-body radius 8m" into an operator-readable risk narrative.
2. **Tradeoff articulation** — given pre/post-maneuver Pc, fuel cost proxy, and schedule impact, generate a clear comparison ("Option A reduces risk by 95% but costs X; Option B is cheaper but only reduces risk by 60%").
3. **Recommendation with reasoning** — a final plain-language recommendation with the "why," not just a number.
4. **Optional stretch: natural-language query interface** — let an operator ask "what's our riskiest conjunction this week and why" and have the system query the pipeline's output and respond conversationally.

This framing — "AI turns data-heavy into insight-driven" — is literally the brief's own language, so lean on it directly in your pitch.

---

## 6. Tech Stack

### Physics / backend

- **Python** — orbital mechanics ecosystem is Python-first
- **`sgp4`** (Brandon Rhodes' package, Numba-accelerated) — orbit propagation
- **`skyfield`** (built on `sgp4`) — reference frame handling, time systems, higher-level astro utilities
- **`astropy`** — backup/cross-check for frame transforms and time handling if needed
- **`numpy` / `scipy`** — linear algebra, Gaussian integration, numerical minimization (for TCA refinement)
- **FastAPI** — backend API serving propagation results, Pc calculations, and maneuver analysis to the frontend
- **Data source**: CelesTrak API (live TLEs, free, no auth) as primary; Space-Track.org as a secondary/more complete catalog source if needed

### AI layer

- LLM API (your choice — Claude via Anthropic API fits your existing familiarity) for the explanation/tradeoff/recommendation layer described in Section 5
- Structured prompting: feed the LLM structured JSON (Pc, miss distance, covariance summary, maneuver options with deltas) rather than raw numbers, and have it return structured + narrative output

### Frontend / visualization

- **React** (your existing stack)
- **CesiumJS** or **Three.js** — 3D Earth globe with real-time/replayed satellite and debris positions, orbit paths, and highlighted conjunction events
- Timeline/countdown UI component for the "T-minus to TCA" demo narrative
- Dashboard panels: risk summary, Pc trend over time, maneuver option comparison, AI-generated recommendation

### Validation / testing

- `pytest` unit tests using the Alfano synthetic test case (Section 4.1) as a hard-coded regression test
- A small script to replay the Envisat/Zenith-2 event (Section 4.2) end-to-end as an integration test and demo data source

---

## 7. Suggested 4-Week Build Plan

**Week 1 — Data + propagation pipeline**

- Pull live TLEs from CelesTrak; get `sgp4`/`skyfield` propagation working
- Implement and validate frame transforms (TEME → ECI → ECEF) against a known reference (e.g., ISS position vs. a public tracker)
- Stand up basic FastAPI scaffolding

**Week 2 — Collision probability**

- Implement conjunction screening (coarse filter + fine propagation) for a scoped candidate set
- Implement TCA refinement
- Implement Pc calculation (2D/encounter-plane method) following JSpOC's stated assumptions
- **Validate against the Alfano test case (Section 4.1) before moving on**
- Replay the Envisat/Zenith-2 event (Section 4.2) and confirm your numbers are in the right ballpark

**Week 3 — Decision support + AI layer**

- Implement simple delta-V maneuver modeling (pre/post-maneuver Pc comparison)
- Build the structured-data → LLM explanation/tradeoff/recommendation pipeline (Section 5)
- Start frontend: dashboard skeleton + basic 3D globe with real TLE data plotted

**Week 4 — Visualization polish + demo prep**

- Full 3D globe with orbit paths, conjunction highlighting, and the T-minus countdown UI
- Wire up both demo scenarios (Envisat primary, Cosmos 2221 backup) end-to-end
- Rehearse the live demo; prepare a recorded fallback in case live computation/API calls misbehave
- Write up the physics simplifications explicitly and honestly (Sections 3.4, 3.7) for the judging writeup

---

## 8. Demo Script (target: ~2-3 min live walkthrough)

1. Open on the 3D globe with real, live TLE-tracked objects
2. Trigger the Envisat/Zenith-2 replay — show the T-minus countdown across the four historical prediction days, with Pc updating and clearly crossing ESA's risk threshold
3. Show the system flag the conjunction and present 2-3 maneuver options with pre/post Pc and plain-language tradeoffs from the AI layer
4. Show the final recommendation with reasoning
5. (If time) Quick cut to Cosmos 2221 as a "here's a dramatically higher-risk real event, and here both satellites were non-maneuverable" contrast
6. Close on the honesty point: "the physics computes the risk; the AI makes the risk usable" — ties directly back to the brief's own framing

---

## 9. Risks & Honest Framing for Judges

- **Physics correctness is the main risk** — mitigated by validating against the Alfano test case and cross-checking against real published numbers from the Envisat and Cosmos 2221 events. Be ready to explain your validation approach if asked.
- **Scope reductions to be upfront about**: no full-catalog screening (scoped to a candidate set), simplified delta-V maneuver modeling (not full thruster/fuel dynamics), 2D/encounter-plane Pc method (industry-standard simplification, not a shortcut unique to us).
- **AI reliability**: keep the LLM's role bounded to explanation/recommendation on top of already-computed, validated numbers — never let it generate or alter the underlying physics output. This is both more robust and a stronger pitch.

---

## 10. Key Sources / References

- ESA Anomaly Dataset / OPS-SAT (if extending to spacecraft telemetry later): `github.com/esa/anomaly-dataset`, Zenodo OPSSAT-AD
- CelesTrak: live TLE data — `celestrak.org`
- Space-Track.org: full catalog access (registration required)
- `sgp4` Python package (Brandon Rhodes)
- `skyfield` Python package
- JSpOC "How the JSpOC Calculates Probability of Collision" (Space-Track.org documents)
- Alfano conjunction test cases (NASA CARA / AAS literature on Pc validation)
- ESA SDC4 proceedings paper: "Collision Avoidance for Operational ESA Satellites" (Envisat/Zenith-2 case)
- Space Connect Online: "A Close Shave" (Cosmos 2221 / LeoLabs writeup)
