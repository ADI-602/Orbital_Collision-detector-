# Orbital Risk Advisor

**A debris collision-risk decision-support platform.** Real orbital mechanics computes the risk; an AI
layer explains it in plain language and compares the options for avoiding it.

> **Real physics computes the risk. AI makes the risk understandable and actionable.**

Built for a space-exploration hackathon (theme: space-debris tracking, collision avoidance and
decision-support systems). The physics is validated against published results; the AI never computes,
estimates or changes a number.

---

## 1. The problem

Tens of thousands of objects orbit the Earth, closing on each other at ~15 km/s. Several times a day an
operator has to decide whether a predicted close approach is dangerous enough to spend fuel on a
collision-avoidance burn. The inputs to that decision (a probability, a miss distance, an uncertainty) are
accurate but hard to read, and the choice between burn options is a trade-off between risk and propellant.

## 2. What the system does

1. **Tracks ~700 real objects** (stations, plus the debris clouds of the Cosmos 2251 / Iridium 33 collision)
   from public orbital data, and draws them on a 3D globe.
2. **Screens them against each other on a timer** with the physics pipeline, and lists the real
   close approaches it finds, ranked by risk.
3. **For each event reports** the time of closest approach (TCA), miss distance, relative speed and
   collision probability (Pc), with a RED / YELLOW / GREEN threat level.
4. **Simulates avoidance burns** (−2, −4, −8 cm/s) and shows the new miss distance, new Pc and propellant cost.
5. **Explains it**: an AI advisor is handed those finished figures and writes the explanation,
   the trade-off between burns, and a recommendation. It quotes the numbers; it never produces them.
6. **Proves it is right**: a header badge re-runs two known-answer checks (Alfano's synthetic test case and
   ESA's 2004 Envisat near-miss) every time the backend starts, and a separate *Envisat replay* tab re-runs
   that real event from archived data.

## 3. Architecture

```
 public TLEs: CelesTrak -> Space-Track (fallback) -> committed offline set
                              |
                    +---------v----------+      PHYSICS PIPELINE (Python, deterministic,
                    |  tracked set (API) |      no AI anywhere in this box)
                    +---------+----------+
                              |
     TLE parsing -> SGP4 propagation -> frame transforms (TEME -> ECEF)
        -> all-pairs screening -> TCA refinement -> collision probability (Pc)
        -> burn model (delta-V) -> pre/post-burn miss distance, Pc, fuel
                              |
   ===========  structured JSON of finished numbers only  ===========
                              |
                    AI ADVISOR (Google Gemini)  -- narrates, compares, recommends
                    (rule-based offline fallback if the AI is unavailable)
                              |
                    FastAPI  ---->  React + CesiumJS console
```

The line in the middle is the project's central design rule. The AI receives only structured results; it is
told to use the numbers verbatim; and if it fails, a deterministic rule-based advisor answers with the same
figures, labelled **OFFLINE ADVISOR**. The physics runs with no API key and no network call to any LLM.

### Physics pipeline (`backend/physics/`)

| Stage | Module | Method |
|---|---|---|
| TLE ingest | `tle_ingest.py` | Parses and validates two-line element sets; rejects garbage |
| Propagation | `propagation.py` | SGP4 via the `sgp4` package (not hand-written) |
| Frames | `frames.py` | TEME to ECI to ECEF via `skyfield`, validated against the ISS |
| Screening | `screening.py` | Altitude pre-filter, one ephemeris per object, vectorised gate with a rigorous lower bound, then a de-aliased refinement. Every reported separation comes from the final stage |
| TCA | `tca.py` | Finds the true minimum of the separation, not the lowest sample |
| Collision probability | `collision_probability.py` | Foster / Chan / Alfano 2D encounter-plane method, with TLE-class covariance from ESA's SDC4 paper |
| Maneuver | `maneuver.py` | Instantaneous along-track delta-V (Clohessy-Wiltshire relative motion), with the flown and unflown trajectories returned for drawing |

Library algorithms (SGP4, frame transforms) are used, not re-implemented; Pc follows a published formula.

### AI layer (`backend/ai/`)

Gemini (`gemini-3.5-flash`, falling back to two other Gemini models if it is overloaded) receives a structured JSON request (Pc, miss distance, hard-body
radius, burn options) and returns an executive summary, risk assessment, recommended action and trade-off
analysis. Prompts and schema are version-controlled. Every response carries an `is_fallback` flag, and the
UI shows **AI: LIVE** or **OFFLINE ADVISOR** accordingly.

## 4. How we know the numbers are right

| Check | Reference | Result |
|---|---|---|
| Alfano (2005) synthetic case | Pc = 0.10034 | reproduced to < 1e-15 (hard regression test) |
| Frame transforms | ISS altitude, latitude, geodetic consistency | pass |
| Envisat / Zenith-2, 22 Oct 2004 | Published TCA 05:10:35 UTC | computed 05:10:37 UTC (2 s) |
| Envisat, four prediction days | Published miss 81-316 m, Pc 1.4e-4 to 5.5e-4 | miss 329 / 234 / 152 / 269 m, Pc 2.74e-4 / 1.11e-3 / 1.93e-3 / 6.59e-4 |
| ESA's real burn (-4 cm/s, 50 min before) | Pc reduced by the burn | 269 m to 570 m, Pc 6.59e-4 to 5.69e-5 |

Our Envisat Pc sits above ESA's published range because we use public TLEs (about 556 m of along-track
uncertainty) where ESA had Envisat's own orbit determination (about 3 m): same order of magnitude, same decision
(all four days exceed ESA's 1e-4 acceptance level). Details: [`docs/validation-notes.md`](docs/validation-notes.md).

## 5. The dashboard

Two tabs, both over a full-screen 3D globe. Designed for a 16" laptop at 1536x960, full screen (F11).

**Live console**
- Globe with ~700 tracked objects (shape shows payload / debris / rocket body; colour is reserved for risk),
  and the selected pair's orbit rings with a *Closest approach (TCA)* marker.
- Event list: the last scheduled screening pass, ranked by threat, filterable, with a live schedule line
  ("Pass running..." / "Next pass in...").
- Conjunction risk panel, maneuver planning with a three-burn comparison, AI advisor, object search,
  non-blocking alerts for new RED / YELLOW events, hover definitions for the jargon.
- Header badge **Validated - Alfano - Envisat** (click it for the figures).

**Envisat replay**
- The 2004 near-miss re-run through the same code from archived data: four prediction days, the TCA computed
  versus published, ESA's burn re-flown, a to-scale encounter diagram, and a timeline scrubber with keys
  (Space, R, left/right arrows, B for the burn, T for TCA).

Presenting it: [`demo/presentation_guide.md`](demo/presentation_guide.md) (every feature, the flow with
timings, judge Q&A) and [`demo/demo_checklist.md`](demo/demo_checklist.md) (pre-flight and failure table).

## 6. Run it

### Prerequisites
- **Python 3.14** (the pinned dependency versions in `backend/requirements.txt` were resolved for it)
- **Node.js 22** and npm
- A modern browser; full screen at 1536x960 is the intended view

### Configure (optional)
Everything works without keys; each key adds one capability.

```bash
cp .env.example .env                       # repo root
cp frontend/.env.example frontend/.env.local
```

| Variable | File | Effect if missing |
|---|---|---|
| `GEMINI_API_KEY` | `.env` | AI advisor falls back to the rule-based advisor (**OFFLINE ADVISOR**) |
| `SPACETRACK_USERNAME`, `SPACETRACK_PASSWORD` | `.env` | Live tracked set uses CelesTrak, then the committed offline set |
| `VITE_CESIUM_ION_TOKEN` | `frontend/.env.local` | Globe uses bundled Natural Earth imagery |
| `VITE_API_BASE_URL` | `frontend/.env.local` | Defaults to `http://localhost:8000` |

Never commit `.env` or `.env.local` (both are gitignored).

### Backend (terminal 1, from the repo root)

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\activate
pip install -r backend\requirements.txt
uvicorn backend.api.main:app --port 8000
```

macOS / Linux: `source backend/.venv/bin/activate` instead of the `Scripts\activate` line.

Check it: <http://localhost:8000/health> returns `{"status":"ok",...}`, and the interactive API docs are at
<http://localhost:8000/docs>. Run it **from the repo root**; the app imports the repo's `tests/fixtures`.

On startup the server loads the tracked set (about a minute if it must use Space-Track) and begins its first
screening pass (about 80-170 s). Until then the console shows the offline set or the injected 2004 case.
Restart the backend once, not repeatedly: each start logs in to Space-Track, whose rate limits are strict.

### Frontend (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. If the console shows "offline set", reload once the backend log reports the live feed.
Production build: `npm run build`.

### Tests

```bash
python -m pytest tests/ -q     # backend, repo root, venv active  (139 tests)
cd frontend && npm test        # frontend (267 tests)
npm run lint                   # frontend lint
```

Use `python -m pytest`, not the bare `pytest` command. The suite never contacts Space-Track or any LLM. The
Alfano and Envisat tests are the regression gate: if either fails, do not trust the numbers.

## 7. Repository layout

| Path | What is in it |
|---|---|
| `backend/physics/` | The deterministic orbital-mechanics pipeline (no LLM calls in this tree) |
| `backend/ai/` | The Gemini advisor, its prompts, schema and offline fallback |
| `backend/api/` | FastAPI routes, tracked set, Space-Track source, scheduled screening, validation endpoint |
| `frontend/` | React 19 + Vite + CesiumJS console |
| `tests/` | pytest suite, including the Alfano and Envisat regression tests and their fixtures |
| `docs/` | `api_contract.md`, `architecture.md`, `physics-notes.md`, `validation-notes.md`, spec and references |
| `demo/` | Presentation guide, demo checklist, Envisat runbook |
| `scripts/` | Pipeline runner, TLE fetch and refresh tools |

Other reading: [`docs/architecture.md`](docs/architecture.md), [`docs/api_contract.md`](docs/api_contract.md),
[`docs/physics-notes.md`](docs/physics-notes.md), [`implementation-checklist.md`](implementation-checklist.md)
(phase-by-phase progress with evidence), [`CLAUDE.md`](CLAUDE.md) (the project's engineering rules).

## 8. Scope and honest limits

- Screens **~700 tracked objects**, not the full ~40,000 catalogue; each pass refines the 300 closest candidate
  pairs, and the list says when a pass was capped.
- One **14.5 m hard-body radius** for every pair (the Envisat validation value), shown with each event; not a per-object size.
- Burns are **instantaneous along-track delta-V**, not thruster physics; propellant assumes Envisat's 8,200 kg.
- Debris cannot manoeuvre, yet a debris-only event still offers a burn on screen.
- Pc uses the **2D encounter-plane** method with a class-based TLE covariance, not a full 3D integral.
- Not built yet: the Cosmos 2221 secondary scenario, a pre-recorded fallback video.

## 9. Data and references

- Orbital data: CelesTrak and Space-Track.org (public TLEs); a committed offline set is the floor.
  Large catalogue dumps are not committed.
- Klinkrad, Alarcon & Sanchez, "Collision Avoidance for Operational ESA Satellites", 4th European Conference
  on Space Debris (ESA SP-587), 2005 - `docs/references/SDC4-paper49.pdf`.
- Foster / Chan / Alfano encounter-plane collision probability; Hoots, Crawford & Roehrich (1984) for the
  apogee / perigee pre-filter.
