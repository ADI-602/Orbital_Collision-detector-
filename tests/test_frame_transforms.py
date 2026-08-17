"""
test_frame_transforms.py — Phase 2 gate test.

Validates that the TEME → ECEF → Geodetic transform chain produces physically
plausible results for the ISS.

Strategy:
  - Use a hardcoded ISS TLE (epoch: 2024-01-01) + a fixed UTC timestamp so
    the test is deterministic and requires no network access.
  - Propagate with SGP4 via skyfield (propagation.py).
  - Convert to geodetic lat/lon/alt (frames.py).
  - Assert the result is physically consistent with known ISS orbital parameters:
      * Altitude: ISS operates at ~400–430 km; allow 380–460 km to cover
        natural decay and epoch drift without being overly tight.
      * Latitude: bounded by orbital inclination of 51.6° → assert |lat| ≤ 52°.
      * Longitude: any value is valid (orbit can be anywhere).
      * |r| (geocentric distance): ~6771–6831 km (Earth radius ~6371 km + alt range).

This test deliberately does NOT assert tight numerical equality — it is a
sanity check that the rotation math is in the right ballpark, not a floating-
point regression. A pass here means: "the transforms are not wildly wrong"
(e.g., not off by 90°, not returning metres instead of km, not sign-flipped).

Per CLAUDE.md §1.2 and implementation-checklist.md Phase 2 gate:
  "Frame transform validation test must pass before Phase 3 starts."
"""

import math

import numpy as np
import pytest
from skyfield.api import load

# Ensure backend/ is importable when running pytest from the repo root.
# conftest.py (or pytest.ini) should add the repo root to sys.path —
# but we use an absolute import path that works once backend/ has __init__.py.
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.physics.propagation import propagate
from backend.physics.frames import teme_to_ecef, ecef_to_geodetic, teme_to_geodetic


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Hardcoded ISS TLE, epoch 2024-01-01 (NORAD 25544).
# Source: CelesTrak archive / Space-Track historical data.
# Using a recent-ish epoch minimises SGP4 extrapolation error for the test.
_ISS_TLE_NAME = "ISS (ZARYA)"
_ISS_TLE_LINE1 = "1 25544U 98067A   24001.50000000  .00002182  00000-0  40268-4 0  9992"
_ISS_TLE_LINE2 = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815100429478"

# Test epoch: 2024-01-01 12:00:00 UTC — within the TLE's validity window.
_TEST_UTC = (2024, 1, 1, 12, 0, 0)


@pytest.fixture(scope="module")
def iss_satellite():
    """skyfield EarthSatellite for the hardcoded ISS TLE."""
    from skyfield.api import EarthSatellite
    ts = load.timescale()
    return EarthSatellite(_ISS_TLE_LINE1, _ISS_TLE_LINE2, _ISS_TLE_NAME, ts)


@pytest.fixture(scope="module")
def test_time():
    """skyfield Time object for the fixed test epoch."""
    ts = load.timescale()
    return ts.utc(*_TEST_UTC)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPropagation:
    """Smoke-check that SGP4 propagation runs and returns plausible magnitudes."""

    def test_propagate_returns_state_vector(self, iss_satellite, test_time):
        state = propagate(iss_satellite, test_time)
        assert state.pos_teme_km is not None
        assert state.vel_teme_km_s is not None
        assert state.pos_teme_km.shape == (3,)
        assert state.vel_teme_km_s.shape == (3,)

    def test_propagate_position_magnitude_km(self, iss_satellite, test_time):
        """ISS geocentric distance should be ~6771–6831 km."""
        state = propagate(iss_satellite, test_time)
        r_km = np.linalg.norm(state.pos_teme_km)
        assert 6700 < r_km < 6900, (
            f"Unexpected ISS geocentric distance: {r_km:.1f} km. "
            "Expected ~6771–6831 km. Possible unit error (m instead of km?)."
        )

    def test_propagate_velocity_magnitude_km_s(self, iss_satellite, test_time):
        """ISS orbital speed should be ~7.66 km/s (LEO circular ~7.5–7.8)."""
        state = propagate(iss_satellite, test_time)
        v_km_s = np.linalg.norm(state.vel_teme_km_s)
        assert 7.0 < v_km_s < 8.5, (
            f"Unexpected ISS orbital speed: {v_km_s:.4f} km/s. "
            "Expected ~7.5–7.8 km/s."
        )


class TestFrameTransforms:
    """Validate TEME → ECEF → Geodetic transform chain for the ISS."""

    def test_teme_to_ecef_preserves_magnitude(self, iss_satellite, test_time):
        """
        Frame rotation must preserve |r|.
        TEME and ECEF are both Earth-centred; only the orientation differs.
        """
        state_teme = propagate(iss_satellite, test_time)
        state_ecef = teme_to_ecef(state_teme, iss_satellite)

        r_teme = np.linalg.norm(state_teme.pos_teme_km)
        r_ecef = np.linalg.norm(state_ecef.pos_ecef_km)

        assert abs(r_teme - r_ecef) < 1.0, (
            f"TEME→ECEF rotation changed |r| by {abs(r_teme - r_ecef):.4f} km. "
            "A pure rotation should preserve magnitude to float precision."
        )

    def test_geodetic_altitude_range_km(self, iss_satellite, test_time):
        """
        ISS altitude should be in the range 380–460 km.
        This catches: wrong units (m vs km), order-of-magnitude errors,
        and large rotation mistakes that would map to wrong altitudes.
        """
        state_teme = propagate(iss_satellite, test_time)
        geo = teme_to_geodetic(state_teme, iss_satellite)

        assert 380 < geo.alt_km < 460, (
            f"ISS altitude out of expected range: {geo.alt_km:.2f} km. "
            "Expected 380–460 km. Check unit conventions and WGS-84 ellipsoid usage."
        )

    def test_geodetic_latitude_bounded_by_inclination(self, iss_satellite, test_time):
        """
        ISS orbital inclination is 51.6°, so sub-satellite latitude must
        always be |lat| ≤ 52°. A large rotation error would break this.
        """
        state_teme = propagate(iss_satellite, test_time)
        geo = teme_to_geodetic(state_teme, iss_satellite)

        assert abs(geo.lat_deg) <= 52.0, (
            f"ISS latitude {geo.lat_deg:.4f}° exceeds inclination bound of ±51.6°. "
            "This indicates a frame rotation error."
        )

    def test_geodetic_longitude_valid_range(self, iss_satellite, test_time):
        """Longitude must be in [-180, 180]. Any value within that is valid."""
        state_teme = propagate(iss_satellite, test_time)
        geo = teme_to_geodetic(state_teme, iss_satellite)

        assert -180.0 <= geo.lon_deg <= 180.0, (
            f"ISS longitude {geo.lon_deg:.4f}° is outside valid range [-180, 180]."
        )

    def test_ecef_to_geodetic_roundtrip_altitude(self, iss_satellite, test_time):
        """
        ECEF and geodetic altitude should be consistent: |r_ecef| ≈ R_earth + alt_km.
        Earth radius (equatorial) ≈ 6378.137 km (WGS-84).
        Allow ±30 km for the polar flattening effect on |r| vs. ellipsoid altitude.
        """
        state_teme = propagate(iss_satellite, test_time)
        state_ecef = teme_to_ecef(state_teme, iss_satellite)
        geo = ecef_to_geodetic(state_ecef, iss_satellite)

        R_earth_km = 6378.137
        r_ecef_km = np.linalg.norm(state_ecef.pos_ecef_km)
        implied_alt_km = r_ecef_km - R_earth_km

        # Geodetic altitude differs from spherical altitude due to flattening —
        # at ISS inclinations the difference is up to ~20 km.
        assert abs(geo.alt_km - implied_alt_km) < 30.0, (
            f"Geodetic alt ({geo.alt_km:.2f} km) vs spherical estimate "
            f"({implied_alt_km:.2f} km) differ by more than 30 km. "
            "Possible ellipsoid or unit error."
        )


class TestMultipleEpochs:
    """Sanity-check that propagation over multiple epochs is self-consistent."""

    def test_propagate_sequence_altitude_stays_in_range(self, iss_satellite):
        """
        Propagate the ISS at 10 evenly-spaced epochs over one orbital period
        (~92 min). All altitudes should remain in the 380–460 km band.
        """
        ts = load.timescale()
        # One orbital period: ~92 minutes = 5520 seconds
        epochs = [
            ts.utc(2024, 1, 1, 12, m, 0)
            for m in range(0, 92, 10)
        ]
        for t in epochs:
            state_teme = propagate(iss_satellite, t)
            geo = teme_to_geodetic(state_teme, iss_satellite)
            assert 380 < geo.alt_km < 460, (
                f"Altitude out of range at {t.utc_iso()}: {geo.alt_km:.2f} km"
            )

    def test_latitude_stays_bounded_over_orbit(self, iss_satellite):
        """
        Over a full orbit, the maximum |latitude| must not exceed 52°.
        """
        ts = load.timescale()
        epochs = [
            ts.utc(2024, 1, 1, 12, m, 0)
            for m in range(0, 92, 5)
        ]
        for t in epochs:
            state_teme = propagate(iss_satellite, t)
            geo = teme_to_geodetic(state_teme, iss_satellite)
            assert abs(geo.lat_deg) <= 52.0, (
                f"Latitude {geo.lat_deg:.4f}° exceeds 52° at {t.utc_iso()}"
            )
