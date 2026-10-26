# tests/

pytest suite for the orbital-mechanics pipeline and the API around it. Run from the repo root with
`python -m pytest tests/ -q` (139 passed on 2026-10-26). `conftest.py` blocks Space-Track suite-wide, so
no test can reach it.

Validation tests (a failing one is a stop-everything event — do not patch around it):
- test_frame_transforms.py  — propagate ISS, convert frames, validate lat/long/alt
- test_alfano_case.py       — hardcoded regression: known inputs → Pc ≈ 0.10034
- test_envisat_replay.py    — integration: Oct 2004 event across four prediction days
- test_tca_global_minimum.py — the close-approach search finds the true minimum, whatever the window

Pipeline and API:
- test_maneuver.py, test_maneuver_tracks.py — burn modelling and the returned trajectories
- test_screening_smoke.py, test_screen_all_pairs.py, test_screening_batch_isolation.py — screening,
  all-pairs gating, per-candidate failure isolation
- test_api_endpoints.py, test_validation_endpoint.py — the HTTP routes
- test_ai_advisor.py        — the AI contract and the offline fallback
- test_tracked_set_request_path.py, test_offline_tracked_set.py, test_spacetrack_source.py — the
  tracked set and its sources
- test_monitor_process.py, test_monitor_state.py — scheduled screening, the worker process, and
  restart persistence

Fixtures (real element sets, the Alfano inputs) are in `fixtures/`.
