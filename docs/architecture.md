# Architecture — Orbital Risk Advisor

## 1. Physics / AI boundary

The system has two strictly separated halves. The **physics pipeline** (Python) is deterministic and independently testable: it ingests TLEs, propagates orbits with SGP4, transforms reference frames, screens for conjunctions, refines time of closest approach, computes collision probability (Pc), and models simplified maneuvers — all with no LLM involvement. The **AI layer** (Claude API) receives only the already-computed, already-validated output of that pipeline as structured JSON, and its sole job is to explain, compare tradeoffs, and recommend in plain language — it never computes, estimates, or alters a physics number. See CLAUDE.md Section 0 for the full statement of this boundary; it is the project's core credibility claim and should not be blurred by any implementation shortcut.

---

## 2. Key decisions

| Decision                                   | Choice                                                                                                                               | Reasoning                                                                                                                                                                                                                                                                                                                                  | Status                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 3D visualization library                   | **Cesium (via Cesium Ion)**                                                                                                          | Realistic Earth terrain/imagery out of the box, faster path to a visually strong demo globe than hand-building rendering in Three.js                                                                                                                                                                                                       | **DECIDED**                                              |
| Cesium Ion token scope                     | `assets:read` (+ `geocode` only if search is used) — all private/write scopes off                                                    | Least-privilege; token may end up referenced in frontend code, so it should be safe to leak in the worst case                                                                                                                                                                                                                              | **DECIDED**                                              |
| Primary conjunction object + candidate set | **Envisat** (NORAD ID 27386), screened against a scoped candidate set including the Zenith-2 debris fragment for the Oct 2004 replay | Section 3.4 of project-doc.md requires scoping down from the full ~40,000-object catalog to one object + a reasonable candidate set. Envisat is also the main demo scenario (Section 4.2, project-doc.md), so using it as the primary object keeps the pipeline and the demo aligned rather than screening one object but demoing another. | **DECIDED**                                              |
| Claude model for AI layer                  | —                                                                                                                                    | Cost analysis (see prior discussion) puts Sonnet 5 at roughly $5–15 total for the whole hackathon even with generous dev-loop usage; Haiku 4.5 would be cheaper still. Either is viable for this narrative/explanation task — pick based on desired output quality vs. margin-of-safety on API cost.                                       | **PENDING**                                              |
| Frontend framework/tooling                 | Vite + React (confirm against actual Phase 1 scaffold once run)                                                                      | Standard, fast dev server, no unnecessary framework weight for a hackathon timeline                                                                                                                                                                                                                                                        | **DECIDED (pending Phase 1 confirmation)**               |
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
backend/ai/advisor.py (Claude API — explanation, tradeoffs, recommendation)
        │
        ▼
backend/api/ (FastAPI routes)
        │
        ▼
frontend/ (Cesium globe, countdown UI, risk dashboard, AI advisor panel)
```

The boundary line above is the single most important line in this diagram — nothing crosses it except the structured JSON payload defined in `backend/ai/schema.py`, and nothing on the AI side of it is trusted to alter or originate a physics number.

---

## 4. External services & credentials

| Service                | Purpose                                    | Free tier                                                               | Env var                                                                                          |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| CelesTrak              | Live TLE data                              | Free, no auth (avoid hammering — fetch once, cache locally)             | — (no key needed)                                                                                |
| Space-Track.org        | Secondary/full catalog TLE source          | Free, registration required                                             | `SPACETRACK_USERNAME`, `SPACETRACK_PASSWORD`                                                     |
| Anthropic API (Claude) | AI explanation/recommendation layer        | Paid per-token; est. $5–15 total for this project (see cost discussion) | `ANTHROPIC_API_KEY`                                                                              |
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

- [ ] **Claude model choice** — Sonnet 5 vs. Haiku 4.5 for the AI layer
- [ ] **Team role split** — optional, fill in if useful for coordination

These correspond to open items in `implementation-checklist.md` Phase 0 — resolve there and here together so they don't drift out of sync.
