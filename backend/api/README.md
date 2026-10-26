# backend/api/

FastAPI routes tying the physics pipeline and AI layer together for the frontend. Every route and field
is documented in `docs/api_contract.md`.

Modules:
- main.py        — application entry point and route definitions
- assessment.py  — turns a flagged screening candidate into a reportable event (TCA, covariance, Pc,
                   threat level, hard-body radius); shared by the screening endpoint and the monitor
- tracked_set.py — the server-owned catalogue the console tracks and screens (~700 objects); CelesTrak
                   first, Space-Track fallback, committed offline set as the floor
- spacetrack.py  — Space-Track.org as a second live source (hard rate limits; tests never reach it)
- monitoring.py  — scheduled screening in a worker process, with the last completed pass saved to
                   `backend/.cache/` and restored after a restart
- validation.py  — re-runs the Alfano and Envisat known-answer checks for the console's "Validated" badge

No module here calls the AI layer except the `/api/ai/advise` route; scheduled screening is the physics
pipeline on a timer.
