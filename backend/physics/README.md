# backend/physics/

Deterministic orbital-mechanics pipeline. No LLM calls anywhere in this tree.

Pipeline stages (each in its own module):
- tle_ingest.py     — TLE parsing and validation (fetching lives in `backend/api/tracked_set.py`)
- propagation.py    — SGP4 wrapper via skyfield/sgp4
- frames.py         — TEME → ECI → ECEF reference frame transforms
- screening.py      — scoped candidate set, then three stages for all-pairs: one ephemeris per object,
                      a vectorised gate with a rigorous lower bound, and the de-aliased refinement that
                      every reported separation comes from
- tca.py            — time of closest approach refinement
- collision_probability.py — 2D/encounter-plane Pc method (Foster/Chan/Alfano)
- maneuver.py       — instantaneous delta-V modeling, pre/post-Pc comparison
- trace.py          — per-stage debug prints, off by default (`PHYSICS_TRACE=1` enables them)
