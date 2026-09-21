"""
test_maneuver.py — Unit tests for impulsive maneuver physics module.

Tests:
  - Maneuver calculation on Envisat/Zenith-2 Oct 2004 conjunction event.
  - Verifies -4.0 cm/s along-track braking burn reduces collision probability (Pc) significantly.
  - Verifies post-burn miss distance increases appropriately.
  - Verifies fuel consumption calculation via rocket equation.
  - Verifies zero burn (0.0 cm/s) leaves miss distance and Pc unchanged.
"""

import sys
import os

import numpy as np
import pytest
from skyfield.api import EarthSatellite, load

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.physics.maneuver import simulate_maneuver, ManeuverResult
from backend.physics.screening import screen_pair
from backend.physics.tca import refine_tca
from tests.fixtures.envisat_tles import (
    ENVISAT_TLES,
    ZENITH2_TLES,
    EXPECTED_TCA_UTC,
    HARD_BODY_RADIUS_KM,
)


@pytest.fixture(scope="module")
def ts():
    return load.timescale()


@pytest.fixture(scope="module")
def envisage_tca_result(ts):
    """Run screening + TCA for Oct 20 prediction day to get base TCAResult."""
    env_l1, env_l2 = ENVISAT_TLES["oct_20"]
    zen_l1, zen_l2 = ZENITH2_TLES["oct_20"]

    envisat = EarthSatellite(env_l1, env_l2, "Envisat", ts)
    zenith2 = EarthSatellite(zen_l1, zen_l2, "Zenith-2", ts)

    tca_expected = ts.utc(*EXPECTED_TCA_UTC)
    tca_tt = float(tca_expected.tt)

    start_time = ts.tt_jd(tca_tt - 0.02)
    end_time = ts.tt_jd(tca_tt + 0.02)

    candidate = screen_pair(envisat, zenith2, start_time, end_time, timestep_s=10.0, threshold_km=100.0)
    assert candidate is not None

    tca_result = refine_tca(candidate)
    return envisat, zenith2, tca_result


class TestManeuverSimulation:
    """Test suite for simulate_maneuver physics."""

    def test_braking_burn_reduces_pc(self, envisage_tca_result):
        """A -4.0 cm/s retrograde burn 50 min before TCA should significantly reduce Pc."""
        envisat, zenith2, tca_result = envisage_tca_result

        res = simulate_maneuver(
            primary=envisat,
            secondary=zenith2,
            tca_result=tca_result,
            delta_v_cm_s=-4.0,
            lead_time_minutes=50.0,
            sat_mass_kg=8200.0,
            isp_s=220.0,
            hard_body_radius_km=HARD_BODY_RADIUS_KM,
        )

        assert isinstance(res, ManeuverResult)
        assert res.delta_v_cm_s == -4.0
        assert res.post_burn_pc < res.pre_burn_pc, "Post-burn Pc should be strictly less than pre-burn Pc"
        assert res.risk_reduction_pct > 50.0, "Risk reduction should be > 50%"
        assert res.post_burn_miss_distance_m > res.pre_burn_miss_distance_m, "Post-burn miss distance should increase"
        assert res.fuel_consumed_kg > 0.0, "Fuel consumed should be positive"
        assert res.maneuver_recommended is True

    def test_threshold_is_reported_separately_from_whether_the_burn_helps(self, envisage_tca_result):
        """
        "This burn helps" and "this burn resolves the conjunction" are different.

        Regression: `risk_threshold_pc` was a declared, documented parameter
        that nothing ever evaluated — the docstring claimed the recommendation
        consulted it, and the code set the flag from `post_pc < pre_pc` alone.

        It is now reported as its own field rather than folded into the
        recommendation, because folding it in gets one of these two cases
        wrong whichever way it goes: the -4.0 cm/s burn ESA actually flew left
        Pc above the 1e-4 accepted level of the day and was flown regardless,
        while a 0.5 cm/s nudge improves Pc without coming near resolving it.
        """
        envisat, zenith2, tca_result = envisage_tca_result

        def burn(dv):
            return simulate_maneuver(
                primary=envisat,
                secondary=zenith2,
                tca_result=tca_result,
                delta_v_cm_s=dv,
                lead_time_minutes=50.0,
                sat_mass_kg=8200.0,
                isp_s=220.0,
                hard_body_radius_km=HARD_BODY_RADIUS_KM,
                risk_threshold_pc=1e-4,
            )

        weak = burn(-0.5)
        # It genuinely helps, and that is reported honestly...
        assert weak.post_burn_pc < weak.pre_burn_pc
        assert weak.maneuver_recommended is True
        # ...but it does not resolve the conjunction, and that is reported too.
        assert weak.post_burn_pc > 1e-4
        assert weak.post_burn_below_threshold is False

        # The threshold actually in force is echoed back, so a caller never has
        # to assume which value the verdict was judged against.
        assert weak.risk_threshold_pc == 1e-4

        # A prograde burn makes things worse and is not recommended at all.
        bad = burn(4.0)
        assert bad.post_burn_pc > bad.pre_burn_pc
        assert bad.maneuver_recommended is False
        assert bad.post_burn_below_threshold is False

        # A large enough retrograde burn clears the threshold outright.
        strong = burn(-8.0)
        assert strong.maneuver_recommended is True
        assert strong.post_burn_below_threshold is True

    def test_prograde_burn_increases_miss_distance(self, envisage_tca_result):
        """A +4.0 cm/s boosting burn should also alter trajectory and change miss distance."""
        envisat, zenith2, tca_result = envisage_tca_result

        res = simulate_maneuver(
            primary=envisat,
            secondary=zenith2,
            tca_result=tca_result,
            delta_v_cm_s=4.0,
            lead_time_minutes=50.0,
            sat_mass_kg=8200.0,
            isp_s=220.0,
            hard_body_radius_km=HARD_BODY_RADIUS_KM,
        )

        assert res.delta_v_cm_s == 4.0
        assert res.post_burn_miss_distance_m != res.pre_burn_miss_distance_m

    def test_zero_burn_leaves_state_unchanged(self, envisage_tca_result):
        """A 0.0 cm/s burn should leave miss distance and Pc unchanged."""
        envisat, zenith2, tca_result = envisage_tca_result

        res = simulate_maneuver(
            primary=envisat,
            secondary=zenith2,
            tca_result=tca_result,
            delta_v_cm_s=0.0,
            lead_time_minutes=50.0,
            sat_mass_kg=8200.0,
            isp_s=220.0,
            hard_body_radius_km=HARD_BODY_RADIUS_KM,
        )

        np.testing.assert_allclose(res.post_burn_miss_distance_m, res.pre_burn_miss_distance_m, rtol=1e-5)
        np.testing.assert_allclose(res.post_burn_pc, res.pre_burn_pc, rtol=1e-5)
        assert res.fuel_consumed_kg == 0.0
        assert res.risk_reduction_pct == 0.0

    def test_fuel_consumption_rocket_equation(self, envisage_tca_result):
        """Verify rocket equation fuel consumption math."""
        envisat, zenith2, tca_result = envisage_tca_result

        # For -4.0 cm/s (0.04 m/s) burn on 8200 kg sat with Isp=220s:
        # dv = 0.04 m/s
        # g0 * Isp = 9.80665 * 220 = 2157.463 m/s
        # fraction = 1 - exp(-0.04 / 2157.463) ≈ 1.854e-5
        # fuel = 8200 * 1.854e-5 ≈ 0.152 kg (~152 grams)
        res = simulate_maneuver(
            primary=envisat,
            secondary=zenith2,
            tca_result=tca_result,
            delta_v_cm_s=-4.0,
            lead_time_minutes=50.0,
            sat_mass_kg=8200.0,
            isp_s=220.0,
        )

        assert 0.10 <= res.fuel_consumed_kg <= 0.25, f"Expected ~0.15 kg fuel, got {res.fuel_consumed_kg:.4f} kg"


class TestPostBurnClosestApproach:
    """
    The post-burn closest approach is not at the pre-burn TCA.

    maneuver.py evaluates the Clohessy-Wiltshire displacement once, at the
    pre-burn TCA. An along-track burn moves the primary mostly along its own
    velocity, so the separation measured at that instant sits off to one side
    of the new minimum and reads high. These tests pin the relationship
    between the two numbers, and pin the fact that Pc is untouched by it.
    """

    def test_min_distance_is_never_greater_than_at_tca_separation(self, envisage_tca_result):
        envisat, zenith2, tca = envisage_tca_result
        for dv in (-8.0, -4.0, -0.5, 4.0):
            res = simulate_maneuver(envisat, zenith2, tca, delta_v_cm_s=dv,
                                    lead_time_minutes=50.0)
            assert res.post_burn_min_distance_m <= res.post_burn_miss_distance_m + 1e-6, (
                f"ΔV={dv}: the true minimum cannot exceed the separation at an "
                f"arbitrary other instant on the same relative path"
            )

    def test_the_gap_is_large_enough_to_matter(self, envisage_tca_result):
        """
        Not a rounding error: at the burn ESA flew, reporting the at-TCA
        separation overstates what the burn achieved by >100 m. If this ever
        shrinks to nothing, the two numbers have stopped being distinct and
        something upstream has changed.
        """
        envisat, zenith2, tca = envisage_tca_result
        res = simulate_maneuver(envisat, zenith2, tca, delta_v_cm_s=-4.0,
                                lead_time_minutes=50.0)
        overstatement_m = res.post_burn_miss_distance_m - res.post_burn_min_distance_m
        assert 50.0 < overstatement_m < 400.0, overstatement_m

    def test_closest_approach_is_within_a_second_of_the_original_tca(self, envisage_tca_result):
        """
        A small burn shifts the encounter by milliseconds, not minutes. A large
        offset would mean the straight-line refinement had been applied to a
        geometry it does not describe.
        """
        envisat, zenith2, tca = envisage_tca_result
        res = simulate_maneuver(envisat, zenith2, tca, delta_v_cm_s=-4.0,
                                lead_time_minutes=50.0)
        assert abs(res.post_burn_tca_offset_s) < 1.0

    def test_zero_burn_leaves_both_distances_at_the_unmaneuvered_miss(self, envisage_tca_result):
        """
        With no burn there is no displacement, so the pre-burn TCA already IS
        the closest approach and both readings must collapse onto it.
        """
        envisat, zenith2, tca = envisage_tca_result
        res = simulate_maneuver(envisat, zenith2, tca, delta_v_cm_s=0.0,
                                lead_time_minutes=50.0)
        assert res.post_burn_miss_distance_m == pytest.approx(
            res.pre_burn_miss_distance_m, abs=1e-6)
        assert res.post_burn_min_distance_m == pytest.approx(
            res.pre_burn_miss_distance_m, rel=1e-3)

    def test_pc_does_not_depend_on_which_instant_the_encounter_is_measured_at(
        self, envisage_tca_result, ts
    ):
        """
        The reason no correction is applied to Pc.

        compute_pc projects onto the B-plane with P = I - v_hat v_hat^T, which
        removes exactly the along-relative-velocity component that a fixed TCA
        instant gets wrong. Sliding both objects along their own velocities to
        the true minimum must therefore leave Pc unchanged.
        """
        from backend.physics.collision_probability import (
            compute_pc, _tle_covariance_rtn, covariance_rtn_to_eci)
        from backend.physics.frames import StateVectorECI
        from backend.physics.screening import _orbital_elements_from_tle

        envisat, zenith2, tca = envisage_tca_result
        s1, s2 = tca.state1_eci, tca.state2_eci

        el1 = _orbital_elements_from_tle(envisat)
        el2 = _orbital_elements_from_tle(zenith2)
        c1 = covariance_rtn_to_eci(
            _tle_covariance_rtn(el1["inclination_deg"], el1["perigee_alt_km"], el1["eccentricity"]),
            s1.pos_eci_km, s1.vel_eci_km_s)
        c2 = covariance_rtn_to_eci(
            _tle_covariance_rtn(el2["inclination_deg"], el2["perigee_alt_km"], el2["eccentricity"]),
            s2.pos_eci_km, s2.vel_eci_km_s)

        rel_r = s2.pos_eci_km - s1.pos_eci_km
        rel_v = s2.vel_eci_km_s - s1.vel_eci_km_s
        t_star = -float(rel_r @ rel_v) / float(rel_v @ rel_v)

        at_tca = compute_pc(s1, s2, c1, c2, HARD_BODY_RADIUS_KM)
        slid = compute_pc(
            StateVectorECI(s1.epoch, s1.pos_eci_km + s1.vel_eci_km_s * t_star,
                           s1.vel_eci_km_s, s1.satellite_name),
            StateVectorECI(s2.epoch, s2.pos_eci_km + s2.vel_eci_km_s * t_star,
                           s2.vel_eci_km_s, s2.satellite_name),
            c1, c2, HARD_BODY_RADIUS_KM)

        assert slid == pytest.approx(at_tca, rel=1e-9)
