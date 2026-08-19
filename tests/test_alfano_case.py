"""
test_alfano_case.py — Phase 3B gate test.

Validates that collision_probability.compute_pc() reproduces the Alfano (2005)
synthetic test case result of Pc = 0.10034 (±0.001).

This test MUST pass before sub-phase 3C starts, per:
  - implementation-checklist.md Phase 3 gate
  - phase-3-plan.md Sub-phase 3B validation contract
  - bob.md §1.2: "Alfano synthetic test case is a hard pytest regression test"

The test is self-contained: no network access, no TLE fetching, no real
satellite data. It is a pure unit test of the Pc math.

If this test fails:
  - Do NOT adjust the tolerance or the expected value.
  - Debug compute_pc() — the math is wrong, not the benchmark.
"""

import sys
import os

import numpy as np
import pytest
from skyfield.api import load

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.physics.collision_probability import compute_pc
from backend.physics.frames import StateVectorECI
from tests.fixtures.alfano_case import (
    POS1_ECI_KM, VEL1_ECI_KM_S,
    POS2_ECI_KM, VEL2_ECI_KM_S,
    COV1_ECI_KM2, COV2_ECI_KM2,
    HARD_BODY_RADIUS_KM,
    EXPECTED_PC,
    PC_TOLERANCE,
)


# ---------------------------------------------------------------------------
# Fixture: build StateVectorECI objects from the hardcoded arrays
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def alfano_states():
    """Return (state1, state2) StateVectorECI for the Alfano synthetic case."""
    ts = load.timescale()
    t = ts.utc(2000, 1, 1, 12, 0, 0)   # arbitrary epoch — irrelevant for Pc

    state1 = StateVectorECI(
        epoch=t,
        pos_eci_km=POS1_ECI_KM.copy(),
        vel_eci_km_s=VEL1_ECI_KM_S.copy(),
        satellite_name="Alfano_Object1",
    )
    state2 = StateVectorECI(
        epoch=t,
        pos_eci_km=POS2_ECI_KM.copy(),
        vel_eci_km_s=VEL2_ECI_KM_S.copy(),
        satellite_name="Alfano_Object2",
    )
    return state1, state2


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestAlfanoCase:
    """Regression tests for the Alfano Pc = 0.10034 synthetic case."""

    def test_pc_matches_alfano_benchmark(self, alfano_states):
        """
        Core gate test: compute_pc() must reproduce Pc = 0.10034 ± 0.001.

        This is the primary numerical validation for collision_probability.py.
        A failure here means the B-plane projection or Gaussian integration
        is wrong — do not adjust the tolerance; fix the implementation.
        """
        state1, state2 = alfano_states
        Pc = compute_pc(
            state1, state2,
            COV1_ECI_KM2, COV2_ECI_KM2,
            HARD_BODY_RADIUS_KM,
        )
        assert abs(Pc - EXPECTED_PC) < PC_TOLERANCE, (
            f"Alfano case: computed Pc={Pc:.6f}, expected {EXPECTED_PC:.5f} "
            f"(tolerance ±{PC_TOLERANCE}). "
            "The Pc math is wrong — debug compute_pc(), do not widen the tolerance."
        )

    def test_pc_is_valid_probability(self, alfano_states):
        """Pc must be in [0, 1] — basic sanity check."""
        state1, state2 = alfano_states
        Pc = compute_pc(
            state1, state2,
            COV1_ECI_KM2, COV2_ECI_KM2,
            HARD_BODY_RADIUS_KM,
        )
        assert 0.0 <= Pc <= 1.0, f"Pc={Pc} is outside [0, 1]."

    def test_pc_increases_with_larger_hard_body_radius(self, alfano_states):
        """
        Larger R_c = larger collision cross-section = higher Pc.
        Verify monotonicity: Pc(2*R_c) > Pc(R_c).
        """
        state1, state2 = alfano_states
        Pc_base = compute_pc(
            state1, state2,
            COV1_ECI_KM2, COV2_ECI_KM2,
            HARD_BODY_RADIUS_KM,
        )
        Pc_larger = compute_pc(
            state1, state2,
            COV1_ECI_KM2, COV2_ECI_KM2,
            HARD_BODY_RADIUS_KM * 2.0,
        )
        assert Pc_larger > Pc_base, (
            f"Pc did not increase with larger R_c: "
            f"Pc(R_c)={Pc_base:.6f}, Pc(2*R_c)={Pc_larger:.6f}."
        )

    def test_pc_decreases_with_larger_covariance(self, alfano_states):
        """
        Larger positional uncertainty (larger covariance) spreads the Gaussian
        wider, reducing the probability mass inside the hard-body disk for a
        zero-miss geometry: Pc(10*C) < Pc(C).
        """
        state1, state2 = alfano_states
        Pc_base = compute_pc(
            state1, state2,
            COV1_ECI_KM2, COV2_ECI_KM2,
            HARD_BODY_RADIUS_KM,
        )
        Pc_wider = compute_pc(
            state1, state2,
            COV1_ECI_KM2 * 10.0, COV2_ECI_KM2 * 10.0,
            HARD_BODY_RADIUS_KM,
        )
        assert Pc_wider < Pc_base, (
            f"Pc did not decrease with wider covariance: "
            f"Pc(C)={Pc_base:.6f}, Pc(10C)={Pc_wider:.6f}."
        )

    def test_zero_hard_body_radius_gives_zero_pc(self, alfano_states):
        """A point-object (R_c -> 0) has zero probability of collision."""
        state1, state2 = alfano_states
        Pc = compute_pc(
            state1, state2,
            COV1_ECI_KM2, COV2_ECI_KM2,
            hard_body_radius_km=1e-9,   # effectively zero
        )
        assert Pc < 1e-6, (
            f"Expected near-zero Pc for R_c -> 0, got Pc={Pc:.2e}."
        )
