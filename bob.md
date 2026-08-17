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
**Data source:** CelesTrak API (live TLEs, no auth) primary; Space-Track.org secondary
**AI layer:** Claude API (Anthropic), structured JSON in/out
**Frontend:** React, CesiumJS or Three.js (3D globe), dashboard panels
**Testing:** `pytest`, with the Alfano case as a hardcoded regression test

Don't introduce a different orbital mechanics library, a different frontend framework, or swap the LLM provider without discussing it — these are pitch-relevant decisions, not incidental ones.

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
- `backend/ai/` — the Claude API explanation/recommendation layer; only consumes physics output as structured JSON
- `backend/api/` — FastAPI routes tying physics + AI together for the frontend
- `tests/` — pytest suite, including the Alfano regression test and Envisat replay validation (must pass before demo)
- `frontend/` — React app (globe, countdown, dashboard, AI advisor panel)
- `demo/` — recorded fallback video + pre-demo checklist, kept current with the live pipeline

Within `backend/physics/`, keep pipeline stages in separate files matching Section 3 of `docs/project-doc.md` (TLE ingest, propagation, frame transforms, screening, TCA, collision probability, maneuver) rather than one large module — this keeps the physics/AI boundary and each validated stage easy to point to.

A short `docs/validation-notes.md` ("here's how we know our numbers are right") is worth writing early and keeping current — it's the single artifact most likely to earn credibility with a technical judge without them having to ask.
