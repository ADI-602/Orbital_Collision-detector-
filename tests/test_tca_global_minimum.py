"""
test_tca_global_minimum.py — the closest approach found must be the closest
approach that exists, not merely the closest one the coarse grid happened to
sample.

WHY THIS TEST EXISTS

The screening scan samples separation on a fixed grid (default 60 s). Envisat
and the Zenith-2 fragment close at ~14.8 km/s, so one 60 s step moves them
~890 km relative to each other. A 268 m encounter is therefore far narrower
than the sampling interval: every grid sample near it lands hundreds of km up
the sides of the V, while some shallower encounter elsewhere in the window can
sample lower and win `argmin`.

Concretely, over 2004-10-22 00:00Z + 12 h the coarse grid's minimum was
26.4 km at 03:30 — a real but unremarkable pass — while the actual event,
268 m at 05:10:37, was invisible to the grid. Screening reported the flagship
conjunction as `pc: 0`, `threat_level: "GREEN"`.

`docs/physics-notes.md` Stage 4 names this failure mode exactly: "too coarse a
timestep and you can miss a close approach that occurs between sample points.
This is a correctness risk, not just a performance knob."

WHY THE EXISTING SUITE MISSED IT

- `tests/test_api_endpoints.py` only asserts `miss_distance_m > 0.0`.
- `tests/test_envisat_replay.py` builds a ±28.8 min window centred on the
  already-known TCA at a 10 s timestep, so it never exercises the wide-window
  path the API actually uses.

Both are reasonable tests. Neither can catch a search that finds the wrong
minimum, because neither ever asks the search to *find* anything — they hand
it the answer's neighbourhood. These tests do not.

Reference: docs/api_contract.md §5, docs/physics-notes.md Stages 4-5.
"""

from datetime import datetime, timedelta, timezone

import pytest
from skyfield.api import load

from backend.physics.tca import compute_tca_from_tles
from backend.physics.tle_ingest import parse_tle_pair
from tests.fixtures.envisat_tles import (
    ENVISAT_TLES,
    EXPECTED_TCA_UTC,
    MISS_DISTANCE_MAX_M,
    MISS_DISTANCE_MIN_M,
    ZENITH2_TLES,
)

# The published event: 2004-10-22 05:10:35 UTC.
EXPECTED_TCA = datetime(*EXPECTED_TCA_UTC, tzinfo=timezone.utc)

# The decoy the coarse grid used to prefer, ~1h40m earlier and ~100x further.
DECOY_TCA_UTC = datetime(2004, 10, 22, 3, 30, 0, tzinfo=timezone.utc)

# TCA is a physical instant; any correct search must land on it regardless of
# how the window was framed. Generous enough to absorb TLE-quality noise.
TCA_TOLERANCE_S = 120.0


@pytest.fixture(scope="module")
def ts():
    return load.timescale()


@pytest.fixture(scope="module")
def envisat_zenith2_pair():
    """The Oct 22 prediction-day TLE pair for the 2004 conjunction."""
    env_l1, env_l2 = ENVISAT_TLES["oct_22"]
    zen_l1, zen_l2 = ZENITH2_TLES["oct_22"]
    return (
        parse_tle_pair(env_l1, env_l2, "ENVISAT"),
        parse_tle_pair(zen_l1, zen_l2, "ZENITH-2 DEBRIS"),
    )


def _tca_from_window(pair, ts, start_utc: datetime, hours: float, **kwargs):
    """Run the same entry point the API uses."""
    primary, secondary = pair
    start = ts.from_datetime(start_utc)
    end = ts.from_datetime(start_utc + timedelta(hours=hours))
    return compute_tca_from_tles(primary, secondary, start, end, **kwargs)


class TestGlobalMinimumOverWideWindow:
    """The realistic case: a wide window with no prior knowledge of the TCA."""

    def test_wide_window_finds_the_real_encounter(self, envisat_zenith2_pair, ts):
        """
        A 12 h window at the default coarse timestep must find the 268 m
        event, not the 26 km decoy that the sampling grid happens to favour.
        """
        result = _tca_from_window(
            envisat_zenith2_pair, ts,
            datetime(2004, 10, 22, 0, 0, 0, tzinfo=timezone.utc),
            hours=12.0,
            threshold_km=500.0,
        )

        assert result is not None, (
            "No conjunction found in a 12 h window that demonstrably contains a "
            "268 m encounter. The search window is wide, not wrong."
        )

        found = result.tca_time.utc_datetime()
        offset_s = abs((found - EXPECTED_TCA).total_seconds())
        miss_m = result.miss_distance_km * 1000.0

        assert offset_s < TCA_TOLERANCE_S, (
            f"TCA landed {offset_s:.0f}s from the published event.\n"
            f"  found:    {found.isoformat()}  ({miss_m:.1f} m)\n"
            f"  expected: {EXPECTED_TCA.isoformat()}\n"
            f"If this is near {DECOY_TCA_UTC.isoformat()}, the coarse grid "
            f"aliased past the real encounter and returned a shallower one."
        )

        assert MISS_DISTANCE_MIN_M < miss_m < MISS_DISTANCE_MAX_M, (
            f"Miss distance {miss_m:.1f} m is outside the published range "
            f"[{MISS_DISTANCE_MIN_M}, {MISS_DISTANCE_MAX_M}] m."
        )

    def test_does_not_return_the_shallower_decoy_encounter(self, envisat_zenith2_pair, ts):
        """
        Named explicitly so a regression reads as 'we are back to the 03:30
        pass' rather than a vague tolerance failure.
        """
        result = _tca_from_window(
            envisat_zenith2_pair, ts,
            datetime(2004, 10, 22, 0, 0, 0, tzinfo=timezone.utc),
            hours=12.0,
            threshold_km=500.0,
        )

        assert result is not None
        found = result.tca_time.utc_datetime()
        decoy_offset_s = abs((found - DECOY_TCA_UTC).total_seconds())

        assert decoy_offset_s > TCA_TOLERANCE_S, (
            f"Returned the {result.miss_distance_km * 1000:.0f} m pass at "
            f"{found.isoformat()} instead of the 268 m encounter at "
            f"{EXPECTED_TCA.isoformat()}."
        )


class TestWindowFramingIndependence:
    """
    TCA is a property of the two orbits, not of how the operator framed the
    search. Any dependence on window width or start time means the search is
    reporting a sampling artefact.
    """

    @pytest.mark.parametrize(
        "start_hour,hours",
        [
            (0, 12),   # wide, TCA in the second half
            (0, 6),    # wide, TCA near the end
            (4, 2),    # narrow, TCA centred
            (5, 1),    # very narrow
        ],
    )
    def test_same_tca_regardless_of_window(self, envisat_zenith2_pair, ts, start_hour, hours):
        result = _tca_from_window(
            envisat_zenith2_pair, ts,
            datetime(2004, 10, 22, start_hour, 0, 0, tzinfo=timezone.utc),
            hours=hours,
            threshold_km=500.0,
        )

        assert result is not None, (
            f"No conjunction found in [{start_hour:02d}:00, +{hours}h), which "
            f"contains the known encounter."
        )

        offset_s = abs((result.tca_time.utc_datetime() - EXPECTED_TCA).total_seconds())
        assert offset_s < TCA_TOLERANCE_S, (
            f"Window [{start_hour:02d}:00, +{hours}h) gave a TCA {offset_s:.0f}s "
            f"from the published event ({result.miss_distance_km * 1000:.1f} m). "
            f"TCA must not depend on window framing."
        )

    def test_coarse_and_fine_timesteps_agree(self, envisat_zenith2_pair, ts):
        """
        The screening timestep is a performance knob. If it changes the
        answer, it has become a correctness knob — which is the bug.
        """
        window = (datetime(2004, 10, 22, 0, 0, 0, tzinfo=timezone.utc), 12.0)

        coarse = _tca_from_window(
            envisat_zenith2_pair, ts, *window,
            coarse_timestep_s=60.0, threshold_km=500.0,
        )
        fine = _tca_from_window(
            envisat_zenith2_pair, ts, *window,
            coarse_timestep_s=10.0, threshold_km=500.0,
        )

        assert coarse is not None and fine is not None

        delta_s = abs(
            (coarse.tca_time.utc_datetime() - fine.tca_time.utc_datetime()).total_seconds()
        )
        assert delta_s < 1.0, (
            f"60 s and 10 s screening timesteps disagree on TCA by {delta_s:.1f}s "
            f"({coarse.miss_distance_km * 1000:.1f} m vs "
            f"{fine.miss_distance_km * 1000:.1f} m)."
        )

        assert coarse.miss_distance_km == pytest.approx(fine.miss_distance_km, rel=0.05), (
            "Screening timestep changed the reported miss distance by more than 5%."
        )
