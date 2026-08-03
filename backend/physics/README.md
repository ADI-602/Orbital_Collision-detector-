# backend/physics/

Deterministic orbital-mechanics pipeline. No LLM calls anywhere in this tree.

Pipeline stages (each in its own module):
- tle_ingest.py     — CelesTrak/Space-Track fetch + TLE parsing
- propagation.py    — SGP4 wrapper via skyfield/sgp4
- frames.py         — TEME → ECI → ECEF reference frame transforms
- screening.py      — coarse filter + fine propagation, scoped candidate set
- tca.py            — time of closest approach refinement
- collision_probability.py — 2D/encounter-plane Pc method (Foster/Chan/Alfano)
- maneuver.py       — instantaneous delta-V modeling, pre/post-Pc comparison
