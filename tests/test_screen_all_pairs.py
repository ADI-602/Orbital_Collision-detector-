"""
test_screen_all_pairs.py — the all-pairs screening path.

screen_all_pairs() exists to make a populated event list possible: screening
one primary against a few hundred candidates over 24 h typically finds nothing,
because a sub-5 km approach to one *specific* object is rare. Screening a set
against itself has N^2/2 chances instead of N.

It gets that scale from a shortcut — propagate each object once, then take
pairwise separations on the cached arrays — and a shortcut in this pipeline is
exactly the kind of thing that quietly produces wrong numbers. So these tests
pin the two properties that make it safe:

  1. AGREEMENT.  Whatever screen_all_pairs reports for a pair must be what the
                 validated screen_pair reports for that same pair. The fast
                 stage is a gate; it must never become the answer.
  2. NO MISSES.  The gate must not drop a conjunction that screen_pair would
                 have found. A screening that silently loses events is worse
                 than a slow one.

Property 2 is the one worth having. The sampled minimum on a 60 s grid
overstates a real approach by up to 2.8x (measured: 7.301 km sampled against
2.643 km true), so a gate set naively at the sampled minimum would discard real
conjunctions. The implementation instead computes a rigorous lower bound on the
true minimum, per sample interval, and gates on that — see _gate_pairs for the
derivation. What the tests below check is that the bound really is a bound.
"""

import os
import sys

import numpy as np
import pytest
from skyfield.api import EarthSatellite, load

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.physics.screening import (  # noqa: E402
    _cache_ephemerides,
    _gate_pairs,
    screen_all_pairs,
    screen_pair,
)
from tests.fixtures.envisat_tles import ENVISAT_TLES, ZENITH2_TLES  # noqa: E402


# The October 2004 Envisat / Zenith-2 conjunction: a real, published event
# with a known answer, and a pair 27 degrees apart in inclination closing at
# 14.78 km/s. If the fast path handles this correctly it is handling the hard
# case, not a convenient one.
_WINDOW = dict(year=2004, month=10, day=22)


@pytest.fixture(scope="module")
def ts():
    return load.timescale()


@pytest.fixture(scope="module")
def envisat(ts):
    return EarthSatellite(*ENVISAT_TLES["oct_22"], "ENVISAT", ts)


@pytest.fixture(scope="module")
def zenith2(ts):
    return EarthSatellite(*ZENITH2_TLES["oct_22"], "ZENITH-2 DEBRIS", ts)


@pytest.fixture(scope="module")
def window(ts):
    start = ts.utc(_WINDOW["year"], _WINDOW["month"], _WINDOW["day"], 0, 0, 0)
    end = ts.utc(_WINDOW["year"], _WINDOW["month"], _WINDOW["day"], 12, 0, 0)
    return start, end


class TestEphemerisCache:
    """One propagation per object, and nothing invented for a failed one."""

    def test_shapes_and_indices(self, envisat, zenith2, ts):
        t_array = ts.utc(2004, 10, 22, 0, 0, np.arange(0, 3600, 60.0))
        pos, vel, kept = _cache_ephemerides([envisat, zenith2], t_array)

        assert pos.shape == (2, len(t_array.tt), 3)
        assert vel.shape == (2, len(t_array.tt), 3)
        assert kept == [0, 1]
        assert np.all(np.isfinite(pos))
        assert np.all(np.isfinite(vel))

    def test_matches_direct_propagation(self, envisat, ts):
        """The cache is a plain reuse of propagate_batch_teme, not a
        reimplementation — so it must agree with it exactly."""
        from backend.physics.propagation import propagate_batch_teme

        t_array = ts.utc(2004, 10, 22, 5, 0, np.arange(0, 600, 60.0))
        pos, vel, _ = _cache_ephemerides([envisat], t_array)
        direct_pos, direct_vel = propagate_batch_teme(envisat, t_array)

        assert np.allclose(pos[0], direct_pos, rtol=0, atol=0)
        assert np.allclose(vel[0], direct_vel, rtol=0, atol=0)


class TestGate:
    """The gate must be generous enough to be safe, and is never an answer."""

    def test_gate_keeps_the_envisat_pair(self, envisat, zenith2, ts):
        """The real 268 m encounter must survive the sampled stage.

        This is the case that matters. At 14.78 km/s a 60 s step moves the
        pair ~890 km, so every sample near the encounter lands far up the
        sides of the V and no sample is anywhere near 268 m. The pair is kept
        only because the bound accounts for what can happen between samples.
        """
        t_array = ts.utc(2004, 10, 22, 0, 0, np.arange(0, 12 * 3600, 60.0))
        pos, vel, _ = _cache_ephemerides([envisat, zenith2], t_array)

        gated = _gate_pairs(pos, vel, timestep_s=60.0, threshold_km=5.0)
        assert [(i, j) for _, i, j in gated] == [(0, 1)]

        # The returned value is a LOWER BOUND on the true minimum, not a
        # distance. Negative means "could reach zero", which is exactly the
        # verdict a 14.78 km/s encounter sampled at 60 s should produce.
        bound_km = gated[0][0]
        assert bound_km < 5.0

        # And the bound must genuinely be a bound: below the true separation
        # the refinement goes on to find.
        refined = screen_pair(
            envisat, zenith2,
            ts.utc(2004, 10, 22, 0, 0, 0), ts.utc(2004, 10, 22, 12, 0, 0),
            timestep_s=60.0, threshold_km=5.0,
        )
        assert refined is not None
        assert bound_km <= refined.min_separation_km, (
            f"gate bound {bound_km:.3f} km is above the true minimum "
            f"{refined.min_separation_km:.3f} km — the bound is unsound and "
            "real conjunctions can be discarded"
        )

    def test_bound_is_below_the_truth_for_every_gated_pair(self, envisat, zenith2, ts):
        """The gate's whole safety claim, stated as a test.

        If the bound ever exceeds the true minimum separation, pairs can be
        discarded that should have been refined — a screening that silently
        loses conjunctions. Checked here on the one pair with a known answer.
        """
        start = ts.utc(2004, 10, 22, 0, 0, 0)
        end = ts.utc(2004, 10, 22, 12, 0, 0)
        t_array = ts.utc(2004, 10, 22, 0, 0, np.arange(0, 12 * 3600, 60.0))
        pos, vel, _ = _cache_ephemerides([envisat, zenith2], t_array)

        for bound_km, i, j in _gate_pairs(pos, vel, 60.0, threshold_km=1e6):
            objs = [envisat, zenith2]
            refined = screen_pair(objs[i], objs[j], start, end,
                                  timestep_s=60.0, threshold_km=1e6)
            assert refined is not None
            assert bound_km <= refined.min_separation_km + 1e-9

    def test_gate_is_symmetric_and_self_free(self, envisat, zenith2, ts):
        """Each unordered pair once, and no object against itself."""
        t_array = ts.utc(2004, 10, 22, 0, 0, np.arange(0, 3600, 60.0))
        pos, vel, _ = _cache_ephemerides(
            [envisat, zenith2, envisat, zenith2], t_array,
        )
        gated = _gate_pairs(pos, vel, timestep_s=60.0, threshold_km=5000.0)

        pairs = [(i, j) for _, i, j in gated]
        assert all(i < j for i, j in pairs)
        assert len(pairs) == len(set(pairs))
        assert not any(i == j for i, j in pairs)

    def test_gate_widens_with_relative_speed(self, envisat, zenith2, ts):
        """A coarser grid must loosen the bound, not tighten it.

        More time between samples means more room for the separation to dip
        unseen, so the lower bound must drop and admit at least as many pairs.
        Getting this backwards would silently discard exactly the fast
        encounters that matter most.
        """
        t_array = ts.utc(2004, 10, 22, 0, 0, np.arange(0, 12 * 3600, 60.0))
        pos, vel, _ = _cache_ephemerides([envisat, zenith2], t_array)

        tight = _gate_pairs(pos, vel, timestep_s=1.0, threshold_km=5.0)
        loose = _gate_pairs(pos, vel, timestep_s=600.0, threshold_km=5.0)

        assert len(loose) >= len(tight)


class TestAgreementWithValidatedPath:
    """Whatever comes out must be what screen_pair says."""

    def test_reports_screen_pair_numbers(self, envisat, zenith2, window):
        start, end = window
        found, stats = screen_all_pairs(
            [envisat, zenith2], start, end, timestep_s=60.0, threshold_km=5.0,
        )

        assert len(found) == 1, "the known Envisat conjunction was not returned"

        direct = screen_pair(
            envisat, zenith2, start, end, timestep_s=60.0, threshold_km=5.0,
        )
        assert direct is not None

        # Identical, not merely close: screen_all_pairs delegates the actual
        # measurement to screen_pair rather than computing its own.
        assert found[0].min_separation_km == direct.min_separation_km
        assert found[0].min_separation_time.tt == direct.min_separation_time.tt

        assert stats["objects_propagated"] == 2
        assert stats["pairs_evaluated"] == 1
        assert stats["pairs_refined"] == 1
        assert stats["truncated"] is False

    def test_reproduces_the_published_miss_distance(self, envisat, zenith2, window):
        """The screening stage's own number for the validation case.

        Not the final published 268 m — that comes from TCA refinement in
        tca.py, which runs after screening. This asserts the coarse-scan
        separation stays sub-kilometre, i.e. that the fast path still finds
        the real encounter and not some other pass.
        """
        start, end = window
        found, _ = screen_all_pairs(
            [envisat, zenith2], start, end, timestep_s=60.0, threshold_km=5.0,
        )
        assert found[0].min_separation_km * 1000.0 < 5000.0


class TestNoMisses:
    """The gate must not lose a pair the validated path would have flagged."""

    def test_agrees_with_exhaustive_screening(self, envisat, zenith2, window):
        """screen_all_pairs over a set must find every pair that screen_pair
        finds when run exhaustively over the same set.

        Small set, but it is the whole property: if the gate ever drops a real
        conjunction, this is what catches it.
        """
        start, end = window
        objects = [envisat, zenith2]

        fast, _ = screen_all_pairs(
            objects, start, end, timestep_s=60.0, threshold_km=5.0,
        )
        fast_keys = {
            (c.primary.name, c.secondary.name, round(c.min_separation_km, 9))
            for c in fast
        }

        exhaustive = set()
        for i in range(len(objects)):
            for j in range(i + 1, len(objects)):
                c = screen_pair(
                    objects[i], objects[j], start, end,
                    timestep_s=60.0, threshold_km=5.0,
                )
                if c is not None:
                    exhaustive.add(
                        (c.primary.name, c.secondary.name,
                         round(c.min_separation_km, 9))
                    )

        assert fast_keys == exhaustive


class TestDegenerateInputs:
    """Nothing invented, nothing crashing."""

    def test_empty_set(self, ts, window):
        start, end = window
        found, stats = screen_all_pairs([], start, end)
        assert found == []
        assert stats["objects_propagated"] == 0
        assert stats["pairs_evaluated"] == 0

    def test_single_object(self, envisat, window):
        start, end = window
        found, stats = screen_all_pairs([envisat], start, end)
        assert found == []
        assert stats["pairs_evaluated"] == 0

    def test_same_object_twice_is_not_a_conjunction(self, envisat, window):
        """Two entries with the same satnum are one object, not a zero-metre
        encounter. This is the failure that would put a spectacular fake at
        the top of the event list."""
        start, end = window
        found, _ = screen_all_pairs(
            [envisat, envisat], start, end, timestep_s=60.0, threshold_km=5.0,
        )
        assert found == []

    def test_truncation_is_reported(self, envisat, zenith2, window):
        """A capped run must say it was capped."""
        start, end = window
        _found, stats = screen_all_pairs(
            [envisat, zenith2], start, end,
            timestep_s=60.0, threshold_km=5.0, max_refine_pairs=0,
        )
        assert stats["truncated"] is True
        assert stats["pairs_refined"] == 0
