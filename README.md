# Orbital Risk Advisor

**Real physics computes the risk. AI makes the risk understandable and actionable.**

A debris collision-risk decision-support platform. It ingests real two-line element
sets, propagates them with SGP4, screens for close approaches, refines time of
closest approach, computes collision probability with a published closed-form
method, and models an avoidance burn — then hands those finished numbers to a
language model that explains them in operational language.

The separation between those two halves is the point of the project, so it is
worth being precise about it.

---

## The split, and how it is enforced

| | Physics pipeline | AI layer |
|---|---|---|
| Lives in | `backend/physics/` | `backend/ai/` |
| Language | Python — `sgp4`, `skyfield`, `numpy`/`scipy` | Google Gemini (`gemini-2.5-flash`) |
| Input | TLEs | structured JSON: Pc, miss distance, covariance summary, maneuver deltas |
| Output | numbers | prose |
| Needs network/API key | **no** | yes (degrades to a rule-based fallback without one) |

**The AI never computes, estimates, overrides, or "sanity-checks" a physics
number.** It narrates numbers it is handed. Three properties make that checkable
rather than merely claimed:

1. **No LLM call exists anywhere under `backend/physics/`.** The pipeline runs,
   is tested, and produces every number it produces with no API key and no
   network access to any model provider.
2. **The AI layer's input is structured JSON only** — never raw state vectors,
   never an invitation to estimate. See `backend/ai/schema.py`.
3. **Missing data surfaces as missing data.** When propagation fails or a pair
   has no encounter plane, the pipeline raises rather than returning a
   plausible-looking default, and the UI renders an explicit error state. There
   is no path by which the model fills a gap with a number that looks right.

If the AI layer is down, the physics dashboard stays fully usable. That is a
demo-safety property as much as an architectural one.

---

## Quickstart

Python 3.12+ is required (`numpy==2.5.1` will not build below it).

```bash
# 1. Backend
python3 -m venv backend/.venv
source backend/.venv/bin/activate          # Windows: backend\.venv\Scripts\activate
pip install -r backend/requirements.txt

# 2. Run the API — FROM THE REPO ROOT.
#    backend/api/main.py imports tests.fixtures, so a different cwd breaks it.
python -m uvicorn backend.api.main:app --reload --port 8000

# 3. Frontend, in a second terminal
cd frontend
npm install
npm run dev                                 # http://localhost:5173
```

Nothing above needs an API key. Optional keys go in `.env` (repo root, for the
backend) and `frontend/.env.local` (for the client) — copy the two `.env.example`
files and read the notes in them; Vite only exposes `VITE_`-prefixed variables,
which is why the client has its own file. `.env` is gitignored; confirm that
before your first commit.

**Verify it all works:**

```bash
pytest                       # 63 tests, from the repo root
cd frontend && npm test      # 157 tests
npm run check:api            # live probe against a running backend
```

---

## What is actually validated

Physics correctness is the project's highest-scrutiny area, so "it ran without
crashing" is not treated as evidence. Each claim below is pinned by a test.

**Collision probability — the Alfano synthetic case.** Known inputs must
reproduce Pc = 0.10034 ± 0.001. Hard regression test, not optional:
`tests/test_alfano_case.py`.

**Frame transforms.** TEME → ECI → ECEF → geodetic is checked against physical
invariants and real ISS geometry — magnitude preservation, altitude band,
latitude bounded by inclination: `tests/test_frame_transforms.py`.

**The Envisat / Zenith-2 conjunction of October 2004**, which has published
results (Klinkrad et al. 2005, SDC4-paper49 §6). Four days of real 2004 element
sets are screened by the same code path the live console uses — each day from
its own 00:00 UTC through the end of October 22, with no hint as to where the
encounter lies:

| Prediction day | Miss distance | Pc | vs. published |
|---|---|---|---|
| Oct 19 | 329.1 m | 2.74×10⁻⁴ | Pc within 1.4–5.5×10⁻⁴; miss outside 81–316 m |
| Oct 20 | 234.1 m | 1.11×10⁻³ | miss within; Pc outside |
| Oct 21 | 151.8 m | 1.93×10⁻³ | miss within; Pc outside |
| Oct 22 | 268.9 m | 6.59×10⁻⁴ | miss within; Pc outside |

Computed TCA 2004-10-22T05:10:37Z against a published 05:10:35Z.

**The disagreements are shown in the UI, not smoothed away.** Three of four Pc
values fall outside the published band, and the replay panel labels each one
*outside* with the documented reason: we apply TLE-derived covariance to both
objects where ESA used Envisat's operational orbit determination for the
primary. That is conservative and biases Pc upward. Writing the demo narrative
around the discrepancy rather than hiding it is deliberate.

Full working: `docs/validation-notes.md`. Stage-by-stage reference and the bug
classes each stage is prone to: `docs/physics-notes.md`.

---

## Honest scope

These reductions are real and are stated in the UI as well as here.

- **Screening** runs a scoped candidate set, not the full ~40,000-object catalog.
- **Maneuver modelling** is an instantaneous along-track ΔV via the
  Clohessy-Wiltshire linearisation — no thruster dynamics, burn duration, or
  attitude control. Propellant is a Tsiolkovsky estimate from ΔV magnitude, not
  a modelled consumption.
- **Pc** uses the 2D/encounter-plane method (Foster/Chan/Alfano — industry
  standard), not a full 3D integral.
- **Covariance** is derived from TLE-class lookup tables, not from operational
  orbit determination, which nobody outside an operator has access to.

One consequence is worth calling out because it is easy to misread. The burn's
displacement is evaluated at the **pre-burn** TCA, so the separation measured at
that instant overstates what the burn achieves — by 118–365 m (20–44%) across
the Envisat days. Both numbers are returned, and the UI leads with the one the
burn actually achieves. **Pc is unaffected**: the encounter-plane method projects
out exactly the component a fixed TCA instant gets wrong. See
`docs/validation-notes.md` §4.5.

---

## Layout

```
backend/physics/   deterministic orbital mechanics — no LLM call anywhere in this tree
backend/ai/        the explanation layer — consumes physics output as structured JSON
backend/api/       FastAPI routes tying the two together
tests/             pytest suite: Alfano regression, Envisat replay, frame transforms
frontend/          React + CesiumJS console, Envisat replay, maneuver planner
docs/              spec, pitch script, validation write-up, physics notes
demo/              pre-demo checklist and recorded fallback
```

Pipeline stages are one file each under `backend/physics/` — `tle_ingest`,
`propagation`, `frames`, `screening`, `tca`, `collision_probability`, `maneuver`
— so each validated stage is easy to point at.

---

## The two views

**Live console** — tracks real objects from CelesTrak, propagated client-side
with `satellite.js`, and screens them for conjunctions. It states which of three
data sources it is on (`live` / `cached` / `snapshot`) and why, because a globe
full of moving satellites looks identical whether the feed is live or two weeks
stale. An INJECTED toggle switches to a constructed encounter — labelled as
synthetic everywhere it appears, in a colour reserved for provenance and never
used for risk — so the detect → assess → advise chain can be shown end to end
even when nothing real is close.

**Envisat replay** — the correctness proof above, run start to finish with no
manual step.

Both work with no Cesium Ion token, falling back to the Natural Earth II tiles
bundled in the `cesium` package. A demo on bad conference wifi still renders.
