"""
test_envisat_replay.py — Phase 3 gate test.

Replays the historical Envisat/Zenith-2 conjunction event of October 2004
across four prediction days and validates that our pipeline's computed
miss distances and collision probabilities fall within the ranges published
by ESA in the SDC4 proceedings paper (Klinkrad et al. 2005).

This test MUST pass (all 4 days) before Phase 4 starts, per:
  - implementation-checklist.md Phase 3 gate
  - phase-3-plan.md Sub-phase 3D validation contract
  - bob.md §1.2: "Envisat/Zenith-2 replay must reproduce published
    historical numbers in the right ballpark"

If this test fails:
  - Do NOT adjust the assertion ranges.
  - Do NOT adjust the demo narrative to hide the discrepancy.
  - Debug the pipeline stage by stage (check intermediate values:
    miss distance, TCA time, covariance projection).
  - See docs/validation-notes.md §4 for the published ground truth.

Test is self-contained: uses hardcoded historical TLEs from
tests/fixtures/envisat_tles.py (no network access required).
"""

import sys
import os

import numpy as np
import pytest
from skyfield.api import EarthSatellite, load

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.physics.collision_probability import (
    compute_pc,
    _tle_covariance_rtn,
    covariance_rtn_to_eci,
)
from backend.physics.screening import screen_pair, _orbital_elements_from_tle
from backend.physics.tca import refine_tca
from tests.fixtures.envisat_tles import (
    ENVISAT_TLES,
    ZENITH2_TLES,
    HARD_BODY_RADIUS_KM,
    EXPECTED_TCA_UTC,
    MISS_DISTANCE_MIN_M,
    MISS_DISTANCE_MAX_M,
    PC_MIN,
    PC_MAX,
    PREDICTION_DAYS,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def ts():
    """Shared skyfield timescale."""
    return load.timescale()


@pytest.fixture(scope="module")
def expected_tca_time(ts):
    """The expected TCA as a skyfield Time object."""
    return ts.utc(*EXPECTED_TCA_UTC)


# ---------------------------------------------------------------------------
# Parametrized gate test
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("day_label", PREDICTION_DAYS)
class TestEnvisatReplay:
    """
    Phase 3 gate: Envisat/Zenith-2 Oct 2004 replay.

    For each of the four prediction days, run the full pipeline:
      ingest → screen → TCA → covariance → Pc
    and assert that miss distance and Pc fall within the published range.
    """

    def test_miss_distance_in_range(self, day_label, ts, expected_tca_time):
        """Miss distance at refined TCA must be in [50 m, 400 m]."""
        tca_result = self._run_pipeline(day_label, ts, expected_tca_time)

        miss_m = tca_result.miss_distance_km * 1000.0

        print(
            f"\n[ENVISAT REPLAY {day_label}] miss_distance = {miss_m:.1f} m  "
            f"(range: {MISS_DISTANCE_MIN_M}–{MISS_DISTANCE_MAX_M} m)"
        )

        assert MISS_DISTANCE_MIN_M <= miss_m <= MISS_DISTANCE_MAX_M, (
            f"Envisat replay {day_label}: miss distance {miss_m:.1f} m "
            f"is outside [{MISS_DISTANCE_MIN_M}, {MISS_DISTANCE_MAX_M}] m. "
            f"This is a stop-and-debug event — do not widen the range. "
            f"See docs/validation-notes.md §4."
        )

    def test_pc_in_range(self, day_label, ts, expected_tca_time):
        """Collision probability must be in [5×10⁻⁵, 1×10⁻³]."""
        tca_result = self._run_pipeline(day_label, ts, expected_tca_time)

        # Build covariance matrices for both objects at TCA.
        Pc = self._compute_pc(day_label, tca_result, ts)

        print(
            f"\n[ENVISAT REPLAY {day_label}] Pc = {Pc:.4e}  "
            f"(range: {PC_MIN:.1e}–{PC_MAX:.1e})"
        )

        assert PC_MIN <= Pc <= PC_MAX, (
            f"Envisat replay {day_label}: Pc = {Pc:.4e} "
            f"is outside [{PC_MIN:.1e}, {PC_MAX:.1e}]. "
            f"This is a stop-and-debug event — do not widen the range. "
            f"See docs/validation-notes.md §4."
        )

    # -------------------------------------------------------------------
    # Internal helpers (shared across tests for the same day_label)
    # -------------------------------------------------------------------

    _tca_cache: dict = {}  # class-level cache to avoid redundant computation

    def _run_pipeline(self, day_label, ts, expected_tca_time):
        """Run screening + TCA refinement for one prediction day."""
        cache_key = day_label
        if cache_key in self._tca_cache:
            return self._tca_cache[cache_key]

        # Load TLEs for this prediction day.
        env_line1, env_line2 = ENVISAT_TLES[day_label]
        zen_line1, zen_line2 = ZENITH2_TLES[day_label]

        envisat = EarthSatellite(env_line1, env_line2, "Envisat", ts)
        zenith2 = EarthSatellite(zen_line1, zen_line2, "Zenith-2 (92-093EE)", ts)

        # Screening window: ±30 minutes around expected TCA (isolates target encounter pass).
        tca_tt = float(expected_tca_time.tt)
        window_days = 0.02  # ±28.8 minutes
        start_time = ts.tt_jd(tca_tt - window_days)
        end_time = ts.tt_jd(tca_tt + window_days)

        # Fine screening — skip coarse filter (we know this pair).
        candidate = screen_pair(
            envisat, zenith2,
            start_time, end_time,
            timestep_s=10.0,       # 10s for fine resolution near TCA
            threshold_km=100.0,    # generous — TLE-quality miss distances are km-scale
            window_margin_s=300.0,  # ±5 min window for TCA refinement (unimodal region)
        )

        assert candidate is not None, (
            f"Envisat replay {day_label}: screening did not find a conjunction "
            f"within ±12h of expected TCA. This is a pipeline bug — the known "
            f"event should always be detected."
        )

        print(
            f"\n[ENVISAT REPLAY {day_label}] Screening: min_sep = "
            f"{candidate.min_separation_km * 1000:.1f} m at "
            f"{candidate.min_separation_time.utc_iso()}"
        )

        # TCA refinement.
        tca_result = refine_tca(candidate, xtol_s=0.001)

        print(
            f"[ENVISAT REPLAY {day_label}] TCA refined: "
            f"{tca_result.tca_time.utc_iso()}, "
            f"miss = {tca_result.miss_distance_km * 1000:.1f} m, "
            f"rel_v = {tca_result.rel_velocity_km_s:.4f} km/s"
        )

        self._tca_cache[cache_key] = tca_result
        return tca_result

    def _compute_pc(self, day_label, tca_result, ts):
        """Compute Pc at the refined TCA using SDC4 Table 1 covariance."""
        # Get orbital elements for covariance lookup.
        env_line1, env_line2 = ENVISAT_TLES[day_label]
        zen_line1, zen_line2 = ZENITH2_TLES[day_label]

        envisat = EarthSatellite(env_line1, env_line2, "Envisat", ts)
        zenith2 = EarthSatellite(zen_line1, zen_line2, "Zenith-2 (92-093EE)", ts)

        env_elems = _orbital_elements_from_tle(envisat)
        zen_elems = _orbital_elements_from_tle(zenith2)

        # Get RTN covariance from SDC4 Table 1 lookup.
        cov1_rtn = _tle_covariance_rtn(
            env_elems["inclination_deg"],
            env_elems["perigee_alt_km"],
            env_elems["eccentricity"],
        )
        cov2_rtn = _tle_covariance_rtn(
            zen_elems["inclination_deg"],
            zen_elems["perigee_alt_km"],
            zen_elems["eccentricity"],
        )

        # Rotate RTN → ECI using each object's ECI state at TCA.
        cov1_eci = covariance_rtn_to_eci(
            cov1_rtn,
            tca_result.state1_eci.pos_eci_km,
            tca_result.state1_eci.vel_eci_km_s,
        )
        cov2_eci = covariance_rtn_to_eci(
            cov2_rtn,
            tca_result.state2_eci.pos_eci_km,
            tca_result.state2_eci.vel_eci_km_s,
        )

        cov1_diag_m = (np.sqrt(np.diag(cov1_rtn)) * 1000).tolist()
        cov2_diag_m = (np.sqrt(np.diag(cov2_rtn)) * 1000).tolist()
        print(
            f"[ENVISAT REPLAY {day_label}] Covariance: "
            f"Envisat RTN 1-sigma = [{cov1_diag_m[0]:.1f}, {cov1_diag_m[1]:.1f}, {cov1_diag_m[2]:.1f}] m, "
            f"Zenith-2 RTN 1-sigma = [{cov2_diag_m[0]:.1f}, {cov2_diag_m[1]:.1f}, {cov2_diag_m[2]:.1f}] m"
        )

        # Compute Pc.
        Pc = compute_pc(
            tca_result.state1_eci,
            tca_result.state2_eci,
            cov1_eci,
            cov2_eci,
            HARD_BODY_RADIUS_KM,
        )

        return Pc
