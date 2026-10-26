# Architecture — Orbital Risk Advisor

## 1. Physics / AI boundary

The system has two strictly separated halves. The **physics pipeline** (Python) is deterministic and independently testable: it ingests TLEs, propagates orbits with SGP4, transforms reference frames, screens for conjunctions, refines time of closest approach, computes collision probability (Pc), and models simplified maneuvers — all with no LLM involvement. The **AI layer** (Google Gemini) receives only the already-computed, already-validated output of that pipeline as structured JSON, and its sole job is to explain, compare tradeoffs, and recommend in plain language — it never computes, estimates, or alters a physics number. See CLAUDE.md Section 0 for the full statement of this boundary; it is the project's core credibility claim and should not be blurred by any implementation shortcut.

---

## 2. Key decisions

| Decision                                   | Choice                                                                                                                               | Reasoning                                                                                                                                                                                                                                                                                                                                  | Status                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 3D visualization library                   | **Cesium (via Cesium Ion)**                                                                                                          | Realistic Earth terrain/imagery out of the box, faster path to a visually strong demo globe than hand-building rendering in Three.js                                                                                                                                                                                                       | **DECIDED**                                              |
| Cesium Ion token scope                     | `assets:read` (+ `geocode` only if search is used) — all private/write scopes off                                                    | Least-privilege; token may end up referenced in frontend code, so it should be safe to leak in the worst case                                                                                                                                                                                                                              | **DECIDED**                                              |
| Primary conjunction object + candidate set | **Envisat** (NORAD ID 27386), screened against a scoped candidate set including the Zenith-2 debris fragment for the Oct 2004 replay | Section 3.4 of project-doc.md requires scoping down from the full ~40,000-object catalog to one object + a reasonable candidate set. Envisat is also the main demo scenario (Section 4.2, project-doc.md), so using it as the primary object keeps the pipeline and the demo aligned rather than screening one object but demoing another. | **DECIDED**                                              |
| LLM provider and model for the AI layer | **Google Gemini**, `gemini-3.5-flash`, then `gemini-flash-lite-latest`, then `gemini-3.5-flash-lite` tried in order (`GEMINI_MODEL` overrides) | Kept over switching to Claude (decision recorded in CLAUDE.md §2, 2026-08-31); the default moved off `gemini-2.5-flash` when that model closed to new API keys. The AI contract (structured JSON in and out, numbers narrated verbatim) is provider-independent, and a deterministic rule-based fallback keeps the dashboard usable when the call fails. | **DECIDED** |
| Frontend framework/tooling | **Vite + React 19**, plain per-component CSS, vitest, oxlint | Confirmed by the Phase 1 scaffold. Standard, fast dev server, no unnecessary framework weight for a hackathon timeline | **DECIDED** |
| Team role split                            | —                                                                                                                                    | Not yet discussed in this conversation                                                                                                                                                                                                                                                                                                     | **PENDING (optional — fill in if useful for your team)** |

---

## 3. Data flow

```
CelesTrak / Space-Track (TLE source)
        │
        ▼
tle_ingest.py  →  raw TLE data
        │
        ▼
propagation.py (SGP4 via skyfield)  →  position/velocity, TEME frame
        │
        ▼
frames.py (TEME → ECI → ECEF)  →  frame-labeled position/velocity
        │
        ▼
screening.py (coarse filter + fine propagation, scoped candidate set)
        │
        ▼
tca.py (time of closest approach refinement)
        │
        ▼
collision_probability.py (2D/encounter-plane Pc method)
        │
        ▼
maneuver.py (delta-V modeling, pre/post-Pc comparison)
        │
        ▼
════════════ PHYSICS / AI BOUNDARY ════════════
        │
        ▼   (structured JSON only: Pc, miss distance,
        │    hard-body radius, covariance summary,
        │    maneuver deltas — no raw state vectors)
        ▼
backend/ai/advisor.py (Google Gemini — explanation, tradeoffs, recommendation; rule-based fallback)
        │
        ▼
backend/api/ (FastAPI routes)
        │
        ▼
frontend/ (Cesium globe, countdown UI, risk dashboard, AI advisor panel)
```

The boundary line above is the single most important line in this diagram — nothing crosses it except the structured JSON payload defined in `backend/ai/schema.py`, and nothing on the AI side of it is trusted to alter or originate a physics number.

---

## 3b. Runtime services around the pipeline

The diagram above is the per-request path. Around it the API process runs three more things, none of
which involves the AI layer:

- **Tracked set** (`backend/api/tracked_set.py`, `spacetrack.py`) — the server owns the catalogue the
  console tracks (~700 objects): CelesTrak first, Space-Track for any group CelesTrak cannot serve, the
  committed offline set as the floor. The feed that served it is reported (`providers`) and shown in the UI.
- **Screening monitor** (`backend/api/monitoring.py`) — the physics screening pipeline on a timer, in a
  spawned worker process so a pass never starves API requests. Each completed pass is saved to
  `backend/.cache/last_screening_pass.json` and served again, marked `restored`, after a restart.
- **Validation report** (`backend/api/validation.py`) — re-runs the Alfano case and the four Envisat
  days on first request and serves the result to the console's "Validated" badge.

Routes and fields for all of these are in `docs/api_contract.md` §8–§9.

---

## 4. External services & credentials

| Service                | Purpose                                    | Free tier                                                               | Env var                                                                                          |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| CelesTrak              | Primary live TLE source                    | Free, no auth. Blocked this project's IP on 2026-09-06 (see CLAUDE.md §2); tried first for every group, never hammered | — (no key needed) |
| Space-Track.org        | Live source while CelesTrak is blocked     | Free, registration required. **Hard rate limits**: one login and one query per group per refresh, 6 h cache, 30 min backoff, tests never reach it | `SPACETRACK_USERNAME`, `SPACETRACK_PASSWORD` |
| Google Gemini API      | AI explanation/recommendation layer        | Google AI Studio key; the dashboard works without it (rule-based fallback, labelled OFFLINE ADVISOR) | `GEMINI_API_KEY` (optional `GEMINI_MODEL`) |
| Cesium Ion             | Terrain/imagery streaming for the 3D globe | Free tier, generous enough for hackathon use                            | `CESIUM_ION_TOKEN` — scoped to `assets:read` (+ `geocode` if used) only, no private/write scopes |

All credentials live in `.env`, which is gitignored; `.env.example` documents required vars with placeholder values only. Never reference a secret directly in frontend source — load Cesium's token the same way as any other env-configured value, not hardcoded in a component.

---

## 5. Known simplifications

This project makes three deliberate scope reductions, stated openly rather than hidden — see **CLAUDE.md Section 1.4** for the full statement:

- Conjunction screening is scoped to a candidate set, not the full catalog
- Maneuver modeling is instantaneous delta-V only, not full thruster/fuel dynamics
- Collision probability uses the industry-standard 2D/encounter-plane method, not a full 3D integral

---

## Open decisions — needs human input

- [x] **LLM provider and model** — resolved: Gemini (2026-08-31), models `gemini-3.5-flash`, then `gemini-flash-lite-latest`, then `gemini-3.5-flash-lite` in order (2026-10-27)
- [ ] **Team role split** — optional, fill in if useful for coordination

These correspond to open items in `implementation-checklist.md` Phase 0 — resolve there and here together so they don't drift out of sync.
