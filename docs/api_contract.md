# Orbital Risk Advisor — API Contract

**Transcribed from `backend/api/main.py` and `backend/ai/schema.py`, verified against commit `bfe5bd4`.**

This document describes what the backend **actually serves today**, field by
field. Every response example below was captured from a live server, not
written by hand — there are no illustrative or invented numbers in this file.

> **Re-verify this document whenever a route changes.** A previous version of
> this file documented five endpoints (`/api/satellites/live`,
> `/api/conjunctions/screen`, `/api/maneuver/simulate`, `/api/replay/envisat`,
> `/api/ai/narrate`) that never existed in the code, with plausible-looking
> fabricated physics numbers in their examples. If you are unsure whether this
> file is current, `http://localhost:8000/docs` (Swagger UI) is generated from
> the source and cannot drift.

---

## 1. Running the services

| Component | Technology | URL |
|---|---|---|
| Backend API | FastAPI + Uvicorn | `http://localhost:8000` |
| Frontend | React + Vite + CesiumJS | `http://localhost:5173` |

### Starting the backend

**Must be launched from the repo root.** `backend/api/main.py:26` does
`from tests.fixtures.envisat_tles import ...`, so the repo root has to be on
`sys.path` or the app fails at import time.

```powershell
backend\.venv\Scripts\uvicorn backend.api.main:app --reload --port 8000
```

Port 8000 is a convention of this document, not configuration — nothing in
`main.py` pins it.

### Running the tests

```powershell
backend\.venv\Scripts\python -m pytest tests/ -q
```

Use `python -m pytest`, **not** the `pytest.exe` shim. The shim puts
`tests/` on `sys.path` rather than the repo root, so `import backend` fails
with `ModuleNotFoundError: No module named 'backend'`. Expected result:
49 passed.

### CORS

```python
# backend/api/main.py:38-44
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

⚠️ **Clients must not send credentials.** `allow_origins=["*"]` together with
`allow_credentials=True` is an invalid pairing per the CORS spec — Starlette
emits `Access-Control-Allow-Origin: *`, and browsers reject that in
combination with credentialed requests. It works today only because the
frontend sends none. Adding `credentials: 'include'` to a fetch call will
break every request with an opaque CORS error.

Because the origin is open, no dev-server proxy is required.

---

## 2. Conventions

- **Timestamps** — ISO 8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`, second resolution.
  Request-side ISO strings are parsed with
  `datetime.fromisoformat(s.replace("Z", "+00:00"))`, so `Z` and `+00:00`
  both work. Always send `Z`; a naive timestamp parses but yields a
  timezone-naive datetime.
- **Positions** — `[x, y, z]` in **km**, ECI frame, arrays of length 3.
- **Probabilities** — float in `[0.0, 1.0]`.
- **Units are always in the field name** (`_m`, `_km`, `_km_s`, `_cm_s`,
  `_kg`, `_pct`). Trust the suffix, not the surrounding prose.

### Naming drift between the physics and AI layers

These three mismatches are the places a correct number can silently become a
wrong one. The frontend handles them in one place
(`frontend/src/api/adapters.js`); any other client must do the same.

| Physics endpoints | AI schema (`backend/ai/schema.py`) | Note |
|---|---|---|
| `tca_utc_iso` | `tca_iso` | plain rename |
| `maneuver_recommended` | `recommended` | plain rename |
| hard-body radius `0.0145` **km** (hardcoded, `main.py:224`) | `hard_body_radius_m` = `14.5` **m** | km → m, factor 1000 |

---

## 3. Endpoints

Six routes. **No route takes a query parameter** — every input is a JSON body.
There is no "look up by NORAD ID" convenience: the physics endpoints take raw
TLE line pairs.

`TLEInput`, used throughout (`main.py:49-52`) — all three fields required:

```json
{ "name": "ENVISAT", "line1": "1 27386U ...", "line2": "2 27386 ..." }
```

### 3.1 `GET /health`  — `main.py:81-88`

Reachability probe only. All three values are hardcoded literals; a 200 here
says uvicorn is serving, nothing about whether the physics pipeline works.

```json
{ "status": "ok", "service": "Orbital Risk Advisor API", "version": "1.0.0" }
```

### 3.2 `GET /api/conjunctions/envisat` — `main.py:91-133`

Ground-truth TLE set for the historical October 2004 Envisat / Zenith-2
conjunction.

⚠️ **Returns TLEs only.** There is no miss distance and no Pc in this
response, despite the FastAPI docstring at `main.py:95` claiming it includes
them. To get per-day physics numbers, POST each day's pair to
`/api/physics/tca` or `/api/physics/screening`.

```json
{
  "event_name": "Envisat vs Zenith-2 Debris (October 2004)",
  "primary_satellite": "ENVISAT",
  "secondary_object": "ZENITH-2 DEBRIS",
  "primary_norad_id": 27386,
  "secondary_norad_id": 22437,
  "tca_utc": "2004-10-22T05:10:35Z",
  "prediction_days": [
    {
      "day": "oct_19",
      "prediction_date": "2004-10-19",
      "tca_target_iso": "2004-10-22T05:10:35Z",
      "envisat_tle":   { "name": "ENVISAT",         "line1": "...", "line2": "..." },
      "secondary_tle": { "name": "ZENITH-2 DEBRIS", "line1": "...", "line2": "..." }
    }
  ]
}
```

`prediction_days` always has exactly 4 entries, in order `oct_19`, `oct_20`,
`oct_21`, `oct_22`. Note the Oct 19 and Oct 20 **Envisat** TLEs are
byte-identical (`tests/fixtures/envisat_tles.py:32-39`) — those days differ
only in the Zenith-2 TLE, so do not deduplicate on the primary.

### 3.3 `POST /api/physics/tca` — `main.py:136-173`

Refine time of closest approach and miss distance for one pair.

Request (`main.py:55-59`):

| Field | Type | Required | Default |
|---|---|---|---|
| `primary` | `TLEInput` | yes | — |
| `secondary` | `TLEInput` | yes | — |
| `start_utc_iso` | string | yes | — |
| `search_duration_hours` | float | no | `48.0` |

Response — captured live, Oct 22 TLE pair, `start_utc_iso`
`2004-10-22T04:00:00Z`, `search_duration_hours` `2.0`:

```json
{
  "tca_utc_iso": "2004-10-22T05:10:37Z",
  "miss_distance_m": 268.2,
  "miss_distance_km": 0.2682,
  "relative_speed_km_s": 14.775,
  "primary_pos_eci_km": [-5025.06, 683.91, -5067.98],
  "secondary_pos_eci_km": [-5023.43, 668.46, -5071.85]
}
```

**404** — `{"detail": "No close approach found within search duration window."}`
This is a legitimate physics result, not a fault. Render it as an empty
state. See §4 for how to distinguish it from a routing 404.

⚠️ **The search window materially changes the answer — see §5.**

### 3.4 `POST /api/physics/screening` — `main.py:176-246`

Screen candidates against a primary. **Never returns 404**; no threats means
`events: []`.

Request (`main.py:62-67`):

| Field | Type | Required | Default |
|---|---|---|---|
| `primary` | `TLEInput` | yes | — |
| `candidates` | `TLEInput[]` | yes (may be `[]`) | — |
| `start_utc_iso` | string | yes | — |
| `search_duration_hours` | float | no | `48.0` |
| `coarse_threshold_km` | float | no | `50.0` |

`coarse_threshold_km` is forwarded as `threshold_km`, the **fine-scan**
flagging threshold (`main.py:197`), despite the name. The only value
exercised by the test suite is `500.0`
(`tests/test_api_endpoints.py:61-77`).

Response:

```json
{
  "primary_name": "ENVISAT",
  "candidates_screened": 1,
  "events": [
    {
      "secondary_name": "ZENITH-2 DEBRIS",
      "tca_utc_iso": "2004-10-22T05:10:37Z",
      "miss_distance_m": 268.2,
      "pc": 0.000659,
      "relative_speed_km_s": 14.775,
      "threat_level": "RED"
    }
  ]
}
```

`threat_level` (`main.py:233`) is a closed set: **`RED`** at `pc >= 1e-4`,
**`YELLOW`** at `pc >= 1e-5`, **`GREEN`** otherwise.

`events.length` may be **less than** `candidates_screened` — candidates that
do not flag, or whose refined TCA comes back empty, are silently skipped
(`main.py:207-208`). Match results on `secondary_name`, never on array index.
Name uniqueness is the caller's responsibility; the API echoes back whatever
`name` was sent.

Hard-body radius is hardcoded to `0.0145` km (`main.py:224`).

### 3.5 `POST /api/physics/maneuver` — `main.py:249-300`

Simulate an impulsive collision-avoidance burn.

Request (`main.py:70-76`):

| Field | Type | Required | Default |
|---|---|---|---|
| `primary` | `TLEInput` | yes | — |
| `secondary` | `TLEInput` | yes | — |
| `tca_utc_iso` | string | yes | — |
| `delta_v_cm_s` | float | no | `-4.0` (negative = braking) |
| `lead_time_minutes` | float | no | `50.0` |
| `sat_mass_kg` | float | no | `8200.0` |

The endpoint does not trust `tca_utc_iso` exactly — it re-solves TCA within
±2 h of it (`main.py:260-261`).

Response — captured live, Oct 22 pair, defaults as above:

```json
{
  "primary_name": "ENVISAT",
  "secondary_name": "ZENITH-2 DEBRIS",
  "delta_v_cm_s": -4.0,
  "lead_time_minutes": 50.0,
  "pre_burn_miss_distance_m": 268.29,
  "post_burn_miss_distance_m": 563.13,
  "pre_burn_pc": 0.00065905,
  "post_burn_pc": 0.00005691,
  "risk_reduction_pct": 91.36,
  "fuel_consumed_kg": 0.152,
  "maneuver_recommended": true
}
```

**404** — `{"detail": "Could not compute TCA for maneuver simulation."}`

### 3.6 `POST /api/ai/advise` — `main.py:303-309`

The only route with a declared `response_model`, so its response body is
exactly the six fields below.

**This endpoint always returns 200.** There is no raise path: if the model
call fails or no API key is present, it degrades to a deterministic
rule-based advisor (`backend/ai/advisor.py:144-146`). HTTP status tells you
nothing about whether a live model answered — `is_fallback` is the only
signal.

Request — `AIAdvisorRequest` (`schema.py:35-42`):

```json
{
  "conjunction": {
    "primary_name": "ENVISAT",
    "secondary_name": "ZENITH-2 DEBRIS",
    "tca_iso": "2004-10-22T05:10:35Z",
    "miss_distance_m": 268.29,
    "pre_burn_pc": 0.00065905,
    "relative_speed_km_s": 14.775,
    "primary_alt_km": 790.0,
    "hard_body_radius_m": 14.5
  },
  "maneuvers": [
    {
      "delta_v_cm_s": -4.0,
      "lead_time_minutes": 50.0,
      "post_burn_miss_distance_m": 563.13,
      "post_burn_pc": 0.00005691,
      "risk_reduction_pct": 91.36,
      "fuel_consumed_kg": 0.152,
      "recommended": true
    }
  ],
  "query_type": "recommendation"
}
```

- `ConjunctionContext` (`schema.py:12-21`) — required: `primary_name`,
  `secondary_name`, `tca_iso`, `miss_distance_m`, `pre_burn_pc`. Defaulted:
  `relative_speed_km_s` `9.8`, `primary_alt_km` `790.0`,
  `hard_body_radius_m` `14.5`.
- `ManeuverOption` (`schema.py:24-32`) — **all seven fields required**, no
  defaults. It carries no names and no `pre_burn_*` values; those belong to
  the conjunction context.
- `query_type` — free string, defaults to `"recommendation"`. Not validated
  against an enum.

Response — `AIAdvisorResponse` (`schema.py:45-52`):

```json
{
  "executive_summary": "...",
  "risk_assessment": "...",
  "recommended_action": "...",
  "tradeoff_analysis": "...",
  "key_metrics": {},
  "is_fallback": true
}
```

`key_metrics` is `Dict[str, Any]` — untyped on the wire. In fallback mode it
carries exactly `pre_burn_pc`, `post_burn_pc`, `risk_reduction_pct`,
`fuel_consumed_kg`, `recommended_burn_delta_v_cm_s`, `maneuver_required`
(`advisor.py:84-91`). In live mode it is whatever the model returned
(`advisor.py:140`). Never index it blindly.

---

## 4. Errors

| Code | Where | Meaning |
|---|---|---|
| 404 | `/api/physics/tca`, `/api/physics/maneuver` | no close approach found — a normal result |
| 404 | any unrouted path | FastAPI default, `{"detail": "Not Found"}` |
| 422 | any POST | pydantic validation failure |
| 500 | the three physics routes | any other exception, message prefixed per route |

There are no custom exception handlers, so bodies are FastAPI defaults.

### `detail` is polymorphic

```jsonc
{ "detail": "No close approach found within search duration window." }  // 404, 500 — a string
{ "detail": [ { "loc": ["body","primary"], "msg": "Field required", "type": "missing" } ] }  // 422 — an array
```

A reverse proxy may also return non-JSON (HTML 502). A client must handle all
three without letting a `JSON.parse` failure escape.

### ⚠️ The 404 ambiguity

An unrouted path returns `{"detail": "Not Found"}` — the same status as a
legitimate "no close approach". A client that treats every 404 as "no
conjunction" will render a routing typo as a physics conclusion. Discriminate
on the `detail` string. The frontend does this in
`frontend/src/api/physics.js` (`isNoConjunctionFound`).

---

## 5. ⚠️ Known issue: TCA search returns a local, not global, minimum

**Status: open. Affects `/api/physics/tca` and `/api/physics/screening`.**

Over a wide search window these endpoints return the **first** close approach
that clears the threshold, not the closest one in the window. For the Envisat
demo pair this means a wide window misses the actual event:

| `start_utc_iso` | `search_duration_hours` | Returned TCA | Miss distance |
|---|---|---|---|
| `2004-10-22T04:00:00Z` | 2 | `05:10:37Z` | **268.2 m** ✅ the real event |
| `2004-10-22T05:00:00Z` | 1 | `05:10:37Z` | **268.2 m** ✅ |
| `2004-10-22T00:00:00Z` | 6 | `03:30:01Z` | 16 009 m ❌ |
| `2004-10-22T00:00:00Z` | 12 | `03:30:01Z` | 16 009 m ❌ |

With the wide window, `/api/physics/screening` therefore reports
`pc: 0` and `threat_level: "GREEN"` for the headline conjunction.

**Why the test suite does not catch it.**
`tests/test_api_endpoints.py` only asserts `miss_distance_m > 0.0`, and
`tests/test_envisat_replay.py:144-152` builds its window **centered on the
already-known TCA** (`tca_tt ± window_days`, `threshold_km=100.0`) — so the
validated replay never exercises the wide-window path the API uses. All 49
tests pass regardless.

**Consequences for callers.** Until this is fixed, any client that needs the
real Envisat numbers must pass a narrow window bracketing the known TCA.
A UI that screens over a naive multi-hour window will show the flagship
conjunction as GREEN / no risk.

This is recorded rather than worked around, per `CLAUDE.md` §1.2: *"If your
numbers are wildly off, that's a bug — do not adjust the demo narrative to
hide it; fix the pipeline or surface the discrepancy."*

---

## 6. Performance

All handlers are `def`, not `async def`, so FastAPI runs them in the
threadpool: concurrent requests will not block the event loop but will
contend for CPU.

| Endpoint | Cost |
|---|---|
| `/health`, `/api/conjunctions/envisat` | instant — literal dict / static fixture read |
| `/api/physics/maneuver` | one refinement over a fixed ±2 h window — fastest of the physics routes |
| `/api/physics/tca` | one fine scan across `search_duration_hours` |
| `/api/physics/screening` | **slowest.** `skip_coarse_filter=True` (`main.py:198`) bypasses the cheap altitude/inclination pre-filter, so every candidate gets a full 60 s-timestep SGP4 scan over the whole window, then a second TCA refinement, then covariance construction and a scipy B-plane integration. Cost is linear in candidate count **and** in `search_duration_hours`. |

Native `fetch` has no default timeout, so clients must impose their own. The
frontend budgets 5 s for `/health`, 60 s for `/tca` and `/maneuver`, and
180 s for `/screening` (`frontend/src/api/`).

Every physics handler also calls `load.timescale()` per request
(`main.py:142, 187, 255`). Skyfield uses builtin data, so there is no network
fetch, but it is redundant per-request work.

---

## 7. AI layer configuration

The code calls **Google Gemini** (`gemini-2.5-flash`, `advisor.py:121`) and
reads `GEMINI_API_KEY` or `GOOGLE_API_KEY` (`advisor.py:108-111`).

The docstring at `main.py:307` still says `ANTHROPIC_API_KEY`; that is stale.
`.env.example` is correct.

⚠️ **The API server never calls `load_dotenv`.** The only `load_dotenv` in
the project is in `scripts/fetch_envisat_tles.py`. Unless `GEMINI_API_KEY` is
exported into the uvicorn process environment, `/api/ai/advise` returns
`is_fallback: true` in local development regardless of what `.env` contains.

Clients should never assume a provider — trust the response shape and the
`is_fallback` flag only, and render fallback mode visibly rather than
presenting rule-based text as live model output.
