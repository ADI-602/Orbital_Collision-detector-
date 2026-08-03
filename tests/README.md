# tests/

pytest suite for the orbital-mechanics pipeline.

Key test files (created in Phase 2/3):
- test_frame_transforms.py  — propagate ISS, convert frames, validate lat/long/alt
- test_alfano_case.py       — hardcoded regression: known inputs → Pc ≈ 0.10034
- test_envisat_replay.py    — integration: Oct 2004 event across four prediction days

A physics test failing is a stop-everything event — do not patch around it.
