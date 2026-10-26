# Orbital Risk Advisor — API Contract

**Transcribed from `backend/api/main.py` and `backend/ai/schema.py`. Brought up to date 2026-10-26 against the running server (build `7fa3ef1`).**

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

**Must be launched from the repo root.** `backend/api/main.py` does
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
with `ModuleNotFoundError: No module named 'backend'`. Expected result: every test green (139 passed on 2026-10-26).

### CORS

```python
# backend/api/main.py (CORSMiddleware)
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
| hard-body radius `0.0145` **km** (hardcoded as `HARD_BODY_RADIUS_KM` in `assessment.py`) | `hard_body_radius_m` = `14.5` **m** | km → m, factor 1000 |

---

## 3. Endpoints

Six routes are described in this section; tracking and monitoring are in §8 and the validation check is in §9 — twelve in all. **No route takes a query parameter** — every input is a JSON body.
There is no "look up by NORAD ID" convenience: the physics endpoints take raw
TLE line pairs.

`TLEInput`, used throughout — all three fields required:

```json
{ "name": "ENVISAT", "line1": "1 27386U ...", "line2": "2 27386 ..." }
```

### 3.1 `GET /health`

Reachability probe only. All three values are hardcoded literals; a 200 here
says uvicorn is serving, nothing about whether the physics pipeline works.

```json
{ "status": "ok", "service": "Orbital Risk Advisor API", "version": "1.0.0" }
```

### 3.2 `GET /api/conjunctions/envisat`

Ground-truth TLE set for the historical October 2004 Envisat / Zenith-2
conjunction.

⚠️ **Returns TLEs only.** There is no miss distance and no Pc in this
response, despite the route's docstring claiming it includes
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

### 3.3 `POST /api/physics/tca`

Refine time of closest approach and miss distance for one pair.

Request (`TCAPhysicsRequest`):

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

The search window is scanned de-aliased, so widening it cannot hide a
close approach — see §5.

### 3.4 `POST /api/physics/screening`

Screen candidates against a primary. **Never returns 404**; no threats means
`events: []`.

Request (`ScreeningPhysicsRequest`):

| Field | Type | Required | Default |
|---|---|---|---|
| `primary` | `TLEInput` | yes | — |
| `candidates` | `TLEInput[]` | yes (may be `[]`) | — |
| `start_utc_iso` | string | yes | — |
| `search_duration_hours` | float | no | `48.0` |
| `coarse_threshold_km` | float | no | `50.0` |

`coarse_threshold_km` is forwarded as `threshold_km`, the **fine-scan**
flagging threshold, despite the name. The only value
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
      "miss_distance_m": 268.9,
      "pc": 0.000659,
      "relative_speed_km_s": 14.778,
      "threat_level": "RED",
      "hard_body_radius_m": 14.5
    }
  ],
  "rejected_candidates": []
}
```

`threat_level` (`threat_level()` in `backend/api/assessment.py`) is a closed set: **`RED`** at `pc >= 1e-4`,
**`YELLOW`** at `pc >= 1e-5`, **`GREEN`** otherwise.

`events.length` may be **less than** `candidates_screened` — candidates that
do not flag, or whose refined TCA comes back empty, are silently skipped. Match results on `secondary_name`, never on array index.
Name uniqueness is the caller's responsibility; the API echoes back whatever
`name` was sent.

Hard-body radius is one constant for every pair, `HARD_BODY_RADIUS_KM = 0.0145` (14.5 m, the value the
Envisat validation was run against), in `backend/api/assessment.py`. Each assessed event echoes it as
`hard_body_radius_m: 14.5` so a client can state the assumption next to the Pc instead of leaving it implicit.
It is not a per-object size.

### 3.5 `POST /api/physics/maneuver`

Simulate an impulsive collision-avoidance burn.

Request (`ManeuverPhysicsRequest`):

| Field | Type | Required | Default |
|---|---|---|---|
| `primary` | `TLEInput` | yes | — |
| `secondary` | `TLEInput` | yes | — |
| `tca_utc_iso` | string | yes | — |
| `delta_v_cm_s` | float | no | `-4.0` (negative = braking) |
| `lead_time_minutes` | float | no | `50.0` |
| `sat_mass_kg` | float | no | `8200.0` |

The endpoint does not trust `tca_utc_iso` exactly — it re-solves TCA within
±2 h of it.

Response — captured live, Oct 22 pair, defaults as above:

```json
{
  "primary_name": "ENVISAT",
  "secondary_name": "ZENITH-2 DEBRIS",
  "delta_v_cm_s": -4.0,
  "lead_time_minutes": 50.0,
  "pre_burn_miss_distance_m": 268.91,
  "post_burn_miss_distance_m": 569.76,
  "pre_burn_pc": 0.00065905,
  "post_burn_pc": 0.00005691,
  "risk_reduction_pct": 91.37,
  "fuel_consumed_kg": 0.152,
  "maneuver_recommended": true,
  "tracks": { ... }
}
```

**404** — `{"detail": "Could not compute TCA for maneuver simulation."}`

#### `tracks` — the flown and unflown trajectories

Added so the post-burn orbit can be drawn without the frontend reconstructing
one. Deriving a manoeuvred trajectory in JavaScript would be orbital mechanics
outside the validated pipeline (CLAUDE.md §1.1, §1.3, §5.2), and two lines
computed by two different codebases would not be comparable to each other.
One TCA solution, one Clohessy-Wiltshire displacement, both outputs.

| Field | Type | Meaning |
|---|---|---|
| `frame` | string | `"ecef"` (ITRS). Stated, not assumed. |
| `units` | string | `"km"` |
| `sample_utc_iso` | string[] | 241 instants, ~16 s apart |
| `pre_burn_pos_ecef_km` | `[x,y,z][]` | primary, coasting |
| `post_burn_pos_ecef_km` | `[x,y,z][]` | primary, with the burn |
| `secondary_pos_ecef_km` | `[x,y,z][]` | the other object |
| `burn_utc_iso`, `burn_sample_index` | string, int | before this the two tracks are identical to the bit |
| `tca_utc_iso` | string | as refined by the pipeline |
| `separation_at_tca_m` | float | how far the burn moved the primary. **Not** the miss distance |
| `max_separation_m` | float | largest pre/post gap in the window |
| `sample_step_s` | float | grid spacing |
| `tca_pre_burn_pos_ecef_km` | `[x,y,z]` | primary at TCA, exact |
| `tca_post_burn_pos_ecef_km` | `[x,y,z]` | perturbed primary at TCA, exact |
| `tca_secondary_pos_ecef_km` | `[x,y,z]` | secondary at TCA, exact |
| `truncated`, `note` | bool, string\|null | window clipped at the CW validity horizon |

Payload is ~50 KB.

**Do not measure a miss distance off the sampled arcs.** They span an hour of
flight at a ~16 s step, and the objects close at ~15 km/s, so the nearest
sampled approach is kilometres away from the true one and moves with the grid
— 7.9 km sampled against a true 268 m, on the Envisat case. Resolving a 268 m
encounter on a uniform grid would need a millisecond step across the whole
hour. The arcs show where the trajectories run and where they part; the
encounter is carried exactly by the three `tca_*` positions, and the
separations between those reproduce `pre_burn_miss_distance_m` and
`post_burn_miss_distance_m` to floating-point equality.

`truncated` is the same kind of claim as `stats.truncated` on a screening pass:
the CW linearisation holds for about one orbit after the burn, and past that
the along-track term grows without bound, so the window is clipped and says so
rather than extrapolating a trajectory the model cannot assert.

### 3.6 `POST /api/ai/advise`

The only route with a declared `response_model`, so its response body is
exactly the six fields below.

**This endpoint always returns 200.** There is no raise path: if the model
call fails or no API key is present, it degrades to a deterministic
rule-based advisor (`get_ai_advice` in `backend/ai/advisor.py`). HTTP status tells you
nothing about whether a live model answered — `is_fallback` is the only
signal.

Request — `AIAdvisorRequest` (`schema.py:35-42`):

```json
{
  "conjunction": {
    "primary_name": "ENVISAT",
    "secondary_name": "ZENITH-2 DEBRIS",
    "tca_iso": "2004-10-22T05:10:35Z",
    "miss_distance_m": 268.91,
    "pre_burn_pc": 0.00065905,
    "relative_speed_km_s": 14.775,
    "primary_alt_km": 790.0,
    "hard_body_radius_m": 14.5
  },
  "maneuvers": [
    {
      "delta_v_cm_s": -4.0,
      "lead_time_minutes": 50.0,
      "post_burn_miss_distance_m": 569.76,
      "post_burn_pc": 0.00005691,
      "risk_reduction_pct": 91.37,
      "fuel_consumed_kg": 0.152,
      "recommended": true
    }
  ],
  "query_type": "recommendation"
}
```

`maneuvers` is a list: the frontend sends one entry for a single simulated burn, or all three
(−2 / −4 / −8 cm/s) after "Compare all three", and the advisor weighs them against each other.

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
(`generate_fallback_advice`). In live mode it is whatever the model returned
(`get_ai_advice`). Never index it blindly.

---

## 4. Errors

| Code | Where | Meaning |
|---|---|---|
| 404 | `/api/physics/tca`, `/api/physics/maneuver` | no close approach found — a normal result |
| 400 | `/api/physics/screening` | request could not be prepared — unparseable primary or malformed `start_utc_iso` |
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

## 5. Close-approach search: how the window is scanned

**This section previously recorded an open bug. It is fixed; kept here because
the failure mode is instructive and the guarantee below is worth relying on.**

Screening samples separation on a fixed grid (default 60 s) and then refines.
Naively taking the lowest sample is wrong: Envisat and the Zenith-2 fragment
close at ~14.8 km/s, so one 60 s step moves them ~890 km. A 268 m encounter is
far narrower than the sampling interval — every sample near it lands hundreds
of km up the sides of the V, while a shallower pass elsewhere samples lower and
wins `argmin`.

That is what used to happen. Over `2004-10-22T00:00:00Z` + 12 h the search
returned 16 km at 03:30 and reported the flagship conjunction as `pc: 0`,
`threat_level: "GREEN"`.

**What it does now** (`backend/physics/screening.py`):

1. Coarse scan at `timestep_s`, as before.
2. Take **every local minimum** of the sampled series, not just the lowest —
   each one brackets a true local minimum of the continuous curve.
3. Discard only those that provably cannot dip below the threshold between
   samples. Since `|d/dt separation| <= relative speed`, a sampled minimum of
   value `m` can hide a true minimum no lower than `m - v_max·Δt/2`, so the
   gate is `threshold_km + v_max·Δt/2`. Anything above it is safe to drop;
   anything below it is examined.
4. Re-scan each survivor finely over ±1 coarse step and keep the best.
5. `tca.refine_tca()` polishes the winner to sub-second precision.

**The guarantee:** no close approach below the threshold can be missed because
of sampling, for any timestep, given the relative-speed bound. The timestep is
a performance knob again, not a correctness one.

Verified over a 12 h window at the default 60 s timestep:

| Prediction day | TCA found | Miss distance | Pc | Published |
|---|---|---|---|---|
| Oct 21 (T-1d) | `2004-10-22T05:10:37Z` | 151.8 m | 1.93e-3 | 151.5 m, 0.001930 |
| Oct 22 (T-0d) | `2004-10-22T05:10:37Z` | 268.9 m | 6.59e-4 | 268.0 m, 0.000659 |

Regression coverage is `tests/test_tca_global_minimum.py`, which asserts the
answer does not depend on window framing or timestep. The pre-existing suite
could not catch this: `test_api_endpoints.py` only asserts
`miss_distance_m > 0.0`, and `test_envisat_replay.py` centres its window on the
already-known TCA, so neither ever asks the search to *find* anything.

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
| `/api/physics/screening` | **slowest.** `skip_coarse_filter=True` bypasses the cheap altitude pre-filter, so every candidate gets a full 60 s-timestep SGP4 scan over the whole window, then a second TCA refinement, then covariance construction and a scipy B-plane integration. Cost is linear in candidate count **and** in `search_duration_hours`. |

Native `fetch` has no default timeout, so clients must impose their own. The
frontend budgets 5 s for `/health`, 60 s for `/tca` and `/maneuver`, and
180 s for `/screening` (`frontend/src/api/`).

Every physics handler also calls `load.timescale()` per request
(in each handler). Skyfield uses builtin data, so there is no network
fetch, but it is redundant per-request work.

---

## 7. AI layer configuration

The code calls **Google Gemini** and reads `GEMINI_API_KEY` or `GOOGLE_API_KEY`
(`get_ai_advice` in `backend/ai/advisor.py`). Models are tried in order until one answers — `gemini-3.5-flash`, then `gemini-flash-lite-latest`, then `gemini-3.5-flash-lite` (since 2026-10-27; comma-separated
`GEMINI_MODEL` replaces the list), each capped at 15 s so all three fit the frontend's 60 s budget. The original `gemini-2.5-flash` is retired for new API keys, and
`gemini-3.1-flash-lite`, the default after it (commit `c64b206`), returned 503 "high demand" on every call. `.env.example` documents both variables.

`main.py` calls `load_dotenv` on the repo-root `.env` at import time, with `override=False`, so a variable
already exported into the uvicorn process wins over the file. With no key the endpoint returns
`is_fallback: true` and the rule-based advisor's text.

Clients should never assume a provider — trust the response shape and the
`is_fallback` flag only, and render fallback mode visibly rather than
presenting rule-based text as live model output. The frontend shows **AI: LIVE** or **OFFLINE ADVISOR**
from that flag.

---

## 8. Tracking and continuous monitoring (added 2026-09-01, updated 2026-10-26)

Screening moved from "press a button and wait" to a scheduled background pass,
because a full all-pairs screening over a few hundred objects takes far longer
than any click can. See `backend/api/monitoring.py` for the reasoning.

**The AI does not run these.** Scheduled screening is the physics pipeline on a
timer; the AI layer is handed completed results afterwards. Do not label this
"AI monitoring" anywhere — it inverts the project's core claim.

**Passes run in a spawned worker process**, not a thread: pure-Python SGP4 holds the GIL, and a threaded
pass used to starve every API request for its whole duration. Measured during a pass: ~5 ms per request.
`MONITOR_IN_PROCESS=1` reverts to the thread, for debugging.

### 8.1 `GET /api/tracking/objects`

The catalogue the console tracks, as raw element sets. The server owns this set
so the globe and the event list describe the same objects; the frontend renders
and propagates them, but no longer chooses them. Captured live 2026-10-26 (one object shown):

```json
{
  "objects": [{"id": "25544", "name": "ISS (ZARYA)", "norad_id": "25544",
               "line1": "1 25544U ...", "line2": "2 25544  51.6337 ..."}],
  "count": 698,
  "groups": ["stations", "cosmos-2251-debris", "iridium-33-debris"],
  "source": "live",
  "providers": ["space-track"],
  "fetched_at_unix": 1793015313.99,
  "rejected": [],
  "error": null
}
```

**This route never fetches on the request thread.** It serves whatever set the
server currently holds and returns in milliseconds. Refreshing is the monitor's
job. It falls through to a fetch only on a genuinely cold start with
nothing cached and no fetch already running, and that fetch is bounded by a
total budget (`_TOTAL_FETCH_BUDGET_S`, 20 s) that stays under the frontend's
30 s client timeout regardless of how many groups are tracked.

Two consequences worth knowing:

- **A cold start with every provider unreachable returns `200` with `count: 0`** (or the offline set; see
  below) and the reason in `error`. That is not a successful empty set, and the frontend
  treats it as a failure (`useLiveSatellites.js` throws rather than blanking the
  globe).
- **A failed fetch is backed off for 60 s.** Without it, every request re-ran
  the full multi-group fetch, because a failed load leaves `source` at
  `cached`/`none` and the freshness check only short-circuits on `live`.

`tests/test_tracked_set_request_path.py` pins all of this.

**Providers.** Each group is fetched from CelesTrak first. CelesTrak blocked this project's IP on
2026-09-06, so for any group it cannot serve the server falls back to **Space-Track**
(`backend/api/spacetrack.py`, `gp` queries by international designator). `providers` reports which feed
actually served the set — `celestrak`, `space-track`, or `offline:<provider>` — so `source: "live"` never
hides which live feed it was. Space-Track's limits are hard: one login and one query per group per
refresh, a 6 h cache, a 30 min backoff after a failure, and no retry after a rejected login. Tests never
reach it (`tests/conftest.py` blocks it).

**Offline fallback.** When no live provider can be reached, the server falls
back to a committed set of real element sets
(`backend/data/offline_tracked_set.json`, regenerated by
`scripts/refresh_tracked_set.py`). It is seeded at startup, so the endpoint
never serves an empty set while a doomed fetch runs. Priority is strictly:
live fetch → this session's own earlier fetch → committed offline set → nothing.

The offline set reports `source: "bundled"`, `fetched_at_unix` = its **capture
epoch** (never `now`), and `groups` = the groups the file actually holds (not the
ones the server tried and failed to fetch). It is still the set the server
screens, so events and globe markers correspond — which is what distinguishes it
from the browser-side `snapshot` state, where they do not.

- `source` is `live` | `cached` | `bundled` | `none`. **Must be surfaced in the
  UI** — rendering cached element sets as live is the same class of dishonesty as
  inventing a number.
- `rejected` names element sets that would not parse. They never reached the
  pipeline, so they cannot appear as "no conjunction found".
- Groups come from the `TRACKED_GROUPS` env var (comma-separated CelesTrak
  group names). Default: `stations,cosmos-2251-debris,iridium-33-debris`.

### 8.2 `GET /api/monitoring/status`

Cheap enough to poll (the frontend polls it every 30 s). Reports the pass without its events. Captured
live 2026-10-26:

```json
{
  "state": "ready",
  "started_at_unix": 1793021044.49, "finished_at_unix": 1793021213.08,
  "duration_s": 168.6,
  "window_start_utc_iso": "2026-10-26T13:24:08Z", "window_hours": 24.0,
  "objects_tracked": 698, "event_count": 44, "high_risk_count": 2,
  "stats": {"objects_in": 698, "objects_propagated": 698,
            "pairs_evaluated": 243253, "pairs_gated": 12430,
            "pairs_refined": 300, "truncated": true},
  "interval_s": 900.0,
  "restored": false,
  "error": null
}
```

`state` is `never_run` | `running` | `ready` | `failed`. While a pass is `running`, the timing fields
(`finished_at_unix`, `duration_s`, `window_*`, `event_count`) still describe the **previous completed
pass**, so a client can show "last took 1:23" and keep listing the old events. `started_at_unix` is the
running pass's own start. Pass duration varies with machine load: ~80 s to ~170 s on 2026-10-26.

`restored` is `true` when the pass being served was read back from disk after a backend restart rather
than computed by this process; see §8.6.

⚠️ **`stats.truncated`** means refinement was capped (`MONITOR_MAX_REFINE`), so
the pass is *not* a complete screening of the set. A partial screening is a
different claim from a complete one and the UI must be able to say which it
got.

### 8.3 `GET /api/monitoring/events`

Conjunctions from the last completed pass, served from cache — returns
instantly whatever the pipeline is doing now. Same fields as 8.2 plus `events`; it carries `restored`
too.

Each event is either a full assessment:

```json
{"primary_name": "IRIDIUM 33 DEB", "secondary_name": "IRIDIUM 33 DEB",
 "primary_id": "36011", "secondary_id": "36083",
 "tca_utc_iso": "2026-08-31T21:14:07Z", "miss_distance_m": 1739.8,
 "pc": 3.07e-17, "relative_speed_km_s": 12.4, "threat_level": "GREEN",
 "hard_body_radius_m": 14.5}
```

…or a pair the physics declined to assess, carrying **no numbers at all**:

```json
{"primary_name": "...", "secondary_name": "...",
 "unassessable": true, "reason": "relative velocity at TCA is effectively zero"}
```

`primary_id`/`secondary_id` are tracked-set ids, so a selected event can be
traced back to its two globe markers.

Events are sorted most urgent first: assessed before refused, then threat band,
then Pc descending. Note this is **not** the screening stage's order, which
sorts by minimum separation — a fast, well-separated pass can carry a higher Pc
than a slow close one.

### 8.4 `GET /api/monitoring/alerts`

High-risk events first seen since the last call. **Drains on read**, so each
alert is delivered once rather than re-firing on every pass that still sees the
same event.

```json
{"alerts": [], "count": 0}
```

**The frontend intentionally does not use this route.** A drain-on-read queue hands each alert to
whichever single client polls first. `useConjunctionAlerts` instead decides what is new per browser
(localStorage), matching on pair + TCA within 10 minutes, from the events in 8.3.

### 8.5 `POST /api/monitoring/refresh`

Asks for a pass now. Returns immediately — the pass runs in the monitor's worker process. Poll 8.2 to see
it finish. Never blocks a request, which matters on stage: a click that hangs the UI for minutes is worse
than no button.

```json
{"triggered": true, "state": "ready"}
```

### 8.6 Persistence across restarts

Each completed pass is written to `backend/.cache/last_screening_pass.json` (gitignored; override with
`MONITOR_STATE_PATH`). On startup the monitor serves that pass again, marked `restored: true`, until a
fresh pass replaces it. A saved pass whose screening window has already ended is not restored. Restored
RED events are marked as already alerted, so a restart does not re-fire their alerts. Pinned by
`tests/test_monitor_state.py` (restore, expiry, no re-alert).

### 8.7 Change to `POST /api/physics/screening`

One unusable candidate no longer fails the batch (§3.4 predates this).

- Pairs the physics declines come back inside `events` marked `unassessable`
  with the reason, instead of 500-ing the whole request.
- Unparseable candidates are listed in a new `rejected_candidates` field and
  excluded from `candidates_screened`.
- Request-level failures — unparseable primary, malformed `start_utc_iso` —
  are now **400**, not 500.

### 8.8 Environment

| Variable | Default | Effect |
|---|---|---|
| `TRACKED_GROUPS` | `stations,cosmos-2251-debris,iridium-33-debris` | Groups forming the tracked set |
| `MONITOR_INTERVAL_S` | `900` | Floor on seconds between passes |
| `MONITOR_MAX_REFINE` | `300` | Cap on stage-3 refinements per pass |
| `MONITOR_STATE_PATH` | `backend/.cache/last_screening_pass.json` | Where the last pass is saved and restored from |
| `MONITOR_IN_PROCESS` | unset | `1` runs passes in a thread instead of a worker process |
| `PHYSICS_TRACE` | unset | `1` re-enables per-stage propagation/frame prints |
| `SPACETRACK_USERNAME`, `SPACETRACK_PASSWORD` | unset | Space-Track login for the live fallback (§8.1) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | unset, the three-model list in §7 | AI layer (§7) |

---

## 9. `GET /api/validation/status`

Runs the project's known-answer checks and reports them, so the console can show a live **Validated**
badge instead of asserting correctness. Implemented in `backend/api/validation.py`.

Two checks, judged by the regression tests' own fixtures and bounds (never looser):

- **Alfano (2005) synthetic case** — computed Pc against 0.10034, tolerance 0.001
  (`tests/test_alfano_case.py`).
- **Envisat / Zenith-2, October 2004** — all four prediction days screened over 12 h from
  `2004-10-22T00:00:00Z` at a 50 km threshold, then assessed. Each day is checked against the asserted
  bounds (miss 100–1000 m, Pc 1e-4 – 2.5e-3); the published band (miss 81–316 m, Pc 1.4e-4 – 5.5e-4,
  TCA `05:10:35Z`) is reported alongside (`tests/test_envisat_replay.py`).

Computed by the physics pipeline on first request (~0.6 s), then cached for the life of the process — the
inputs are fixed, so the answer cannot change. **Never an error response:** a check that fails or cannot
run says so in its entry. Shape (abridged, captured live 2026-10-26; the `days` array holds all four days,
one is shown):

```json
{
  "passed": true,
  "checks": [
    {"id": "alfano", "name": "Alfano (2005) synthetic case", "expected_pc": 0.10034,
     "tolerance": 0.001, "computed_pc": 0.10034000000000041, "passed": true,
     "test": "tests/test_alfano_case.py"},
    {"id": "envisat", "name": "Envisat / Zenith-2, October 2004",
     "days": [{"day": "oct_22", "miss_distance_m": 268.91, "pc": 0.000659,
               "tca_utc_iso": "2004-10-22T05:10:37Z", "passed": true}],
     "asserted": {"miss_distance_m": [100.0, 1000.0], "pc": [0.0001, 0.0025]},
     "published": {"miss_distance_m": [81.0, 316.0], "pc": [0.00014, 0.00055],
                   "tca_utc_iso": "2004-10-22T05:10:35Z"},
     "passed": true, "test": "tests/test_envisat_replay.py"}
  ],
  "ran_at_unix": 1793015296.28,
  "duration_s": 0.62,
  "notes": "docs/validation-notes.md"
}
```

`tests/test_validation_endpoint.py` pins it.
