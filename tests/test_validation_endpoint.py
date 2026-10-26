"""
The header's "validated" badge.

It must be earned on every run, not printed: GET /api/validation/status runs
the Alfano case and the four Envisat prediction days through the pipeline and
judges them with the regression tests' own fixtures and bounds. Pinned here:

  - it passes on a healthy pipeline, with the figures the replay view shows;
  - its bounds ARE the regression test's bounds, not a softer copy;
  - a broken Pc turns it red rather than raising or staying green.
"""

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.api import validation  # noqa: E402
from backend.api.main import app  # noqa: E402
from tests.fixtures import alfano_case  # noqa: E402
from tests.fixtures.envisat_tles import (  # noqa: E402
    ENVISAT_TLES,
    MISS_DISTANCE_MAX_M,
    MISS_DISTANCE_MIN_M,
    PC_MAX,
    PC_MIN,
    ZENITH2_TLES,
)

client = TestClient(app)


@pytest.fixture(scope="module")
def report():
    r = client.get("/api/validation/status")
    assert r.status_code == 200
    return r.json()


def _check(report, check_id):
    return next(c for c in report["checks"] if c["id"] == check_id)


def test_healthy_pipeline_passes_both_checks(report):
    assert report["passed"] is True
    alfano = _check(report, "alfano")
    assert alfano["passed"] is True
    assert abs(alfano["computed_pc"] - alfano_case.EXPECTED_PC) < alfano_case.PC_TOLERANCE

    envisat = _check(report, "envisat")
    assert envisat["passed"] is True
    assert [d["day"] for d in envisat["days"]] == ["oct_19", "oct_20", "oct_21", "oct_22"]
    assert all(d["passed"] for d in envisat["days"])


def test_bounds_are_the_regression_tests_own(report):
    envisat = _check(report, "envisat")
    assert envisat["asserted"]["miss_distance_m"] == [MISS_DISTANCE_MIN_M, MISS_DISTANCE_MAX_M]
    assert envisat["asserted"]["pc"] == [PC_MIN, PC_MAX]
    assert _check(report, "alfano")["tolerance"] == alfano_case.PC_TOLERANCE


def test_oct_22_matches_what_the_replay_view_is_shown(report):
    """Same request the replay sends, through the public endpoint."""
    oct_22 = next(d for d in _check(report, "envisat")["days"] if d["day"] == "oct_22")
    r = client.post("/api/physics/screening", json={
        "primary": {"name": "ENVISAT", "line1": ENVISAT_TLES["oct_22"][0], "line2": ENVISAT_TLES["oct_22"][1]},
        "candidates": [{
            "name": "ZENITH-2 DEBRIS",
            "line1": ZENITH2_TLES["oct_22"][0],
            "line2": ZENITH2_TLES["oct_22"][1],
        }],
        "start_utc_iso": "2004-10-22T00:00:00Z",
        "search_duration_hours": 12.0,
    })
    assert r.status_code == 200
    shown = r.json()["events"][0]
    assert oct_22["miss_distance_m"] == pytest.approx(shown["miss_distance_m"])
    assert oct_22["pc"] == pytest.approx(shown["pc"])
    assert oct_22["tca_utc_iso"] == shown["tca_utc_iso"]


def test_a_broken_pc_turns_the_badge_red_instead_of_raising(monkeypatch):
    monkeypatch.setattr(validation, "compute_pc", lambda *a, **k: 0.5)
    alfano = validation.check_alfano()
    assert alfano["passed"] is False
    assert alfano["computed_pc"] == 0.5


def test_a_check_that_cannot_run_reports_failure_with_its_reason(monkeypatch):
    def explode(*_a, **_k):
        raise RuntimeError("frame transform unavailable")

    monkeypatch.setattr(validation, "screen_candidates", explode)
    envisat = validation.check_envisat()
    assert envisat["passed"] is False
    assert all(d["passed"] is False and "frame transform unavailable" in d["error"] for d in envisat["days"])
