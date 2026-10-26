"""
validation.py — the live correctness checks behind the console's header badge.

The badge must never be a hardcoded tick. This module actually RUNS the two
known-answer cases through the pipeline when asked, and compares the results
against the same fixtures and the same tolerances the regression tests gate
on — so the badge and `pytest` cannot disagree, and a broken pipeline turns the
badge red instead of leaving a stale green.

  Alfano (2005) synthetic case   compute_pc against Pc = 0.10034 +/- 0.001,
                                 exactly as tests/test_alfano_case.py does.
  Envisat / Zenith-2, Oct 2004   all four archived prediction days, screened
                                 and assessed through the same path the replay
                                 view shows (screen_candidates, then
                                 assess_conjunction), checked against the range
                                 tests/test_envisat_replay.py asserts.

Fixtures are imported from tests/fixtures, as backend/api/main.py already does
for the replay data: one copy of the inputs and bounds, shared with the tests.

Never raises. A check that cannot run reports itself failed, with the reason.
The report is computed once per process and cached; the inputs are fixed
historical and synthetic data, so the answer cannot change while it runs.
"""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from skyfield.api import load

from backend.api.assessment import assess_conjunction
from backend.physics.collision_probability import compute_pc
from backend.physics.frames import StateVectorECI
from backend.physics.screening import screen_candidates
from backend.physics.tle_ingest import parse_tle_pair
from tests.fixtures import alfano_case
from tests.fixtures.envisat_tles import (
    ENVISAT_TLES,
    MISS_DISTANCE_MAX_M,
    MISS_DISTANCE_MIN_M,
    PC_MAX,
    PC_MIN,
    ZENITH2_TLES,
)

logger = logging.getLogger(__name__)

# The replay view's screening request (frontend/src/lib/replay.js and
# useEnvisatReplay.js), so the badge checks the numbers that view shows.
_REPLAY_START_UTC = datetime(2004, 10, 22, 0, 0, 0, tzinfo=timezone.utc)
_REPLAY_WINDOW_HOURS = 12.0
_REPLAY_THRESHOLD_KM = 50.0  # the endpoint's default, which the replay uses

_PREDICTION_DAYS = ("oct_19", "oct_20", "oct_21", "oct_22")

# Klinkrad et al. 2005 (ESA SDC4-paper49) §6, for display alongside the result.
_PUBLISHED = {
    "miss_distance_m": [81.0, 316.0],
    "pc": [1.4e-4, 5.5e-4],
    "tca_utc_iso": "2004-10-22T05:10:35Z",
}

_lock = threading.Lock()
_cached: Optional[Dict[str, Any]] = None


def check_alfano() -> Dict[str, Any]:
    """compute_pc on the Alfano synthetic case, judged as the regression test judges it."""
    result: Dict[str, Any] = {
        "id": "alfano",
        "name": "Alfano (2005) synthetic case",
        "expected_pc": alfano_case.EXPECTED_PC,
        "tolerance": alfano_case.PC_TOLERANCE,
        "test": "tests/test_alfano_case.py",
    }
    try:
        epoch = load.timescale().utc(2000, 1, 1, 12, 0, 0)  # irrelevant to Pc
        state1 = StateVectorECI(
            epoch=epoch,
            pos_eci_km=alfano_case.POS1_ECI_KM.copy(),
            vel_eci_km_s=alfano_case.VEL1_ECI_KM_S.copy(),
            satellite_name="Alfano_Object1",
        )
        state2 = StateVectorECI(
            epoch=epoch,
            pos_eci_km=alfano_case.POS2_ECI_KM.copy(),
            vel_eci_km_s=alfano_case.VEL2_ECI_KM_S.copy(),
            satellite_name="Alfano_Object2",
        )
        pc = compute_pc(
            state1, state2,
            alfano_case.COV1_ECI_KM2, alfano_case.COV2_ECI_KM2,
            alfano_case.HARD_BODY_RADIUS_KM,
        )
        result["computed_pc"] = float(pc)
        result["passed"] = abs(pc - alfano_case.EXPECTED_PC) < alfano_case.PC_TOLERANCE
    except Exception as exc:  # reported, never raised
        logger.exception("validation: Alfano check could not run")
        result["passed"] = False
        result["error"] = str(exc)
    return result


def _envisat_day(day: str, ts) -> Dict[str, Any]:
    outcome: Dict[str, Any] = {"day": day}
    try:
        primary = parse_tle_pair(*ENVISAT_TLES[day], "ENVISAT")
        secondary = parse_tle_pair(*ZENITH2_TLES[day], "ZENITH-2 DEBRIS")
        start = ts.from_datetime(_REPLAY_START_UTC)
        end = ts.from_datetime(_REPLAY_START_UTC + timedelta(hours=_REPLAY_WINDOW_HOURS))
        flagged = screen_candidates(
            primary=primary,
            candidates=[secondary],
            start_time=start,
            end_time=end,
            threshold_km=_REPLAY_THRESHOLD_KM,
            skip_coarse_filter=True,
        )
        records = [assess_conjunction(c, ts) for c in flagged]
        record = next((r for r in records if r and not r.get("unassessable")), None)
        if record is None:
            outcome["passed"] = False
            outcome["error"] = "the pipeline reported no conjunction"
            return outcome
        miss = float(record["miss_distance_m"])
        pc = float(record["pc"])
        outcome.update(
            miss_distance_m=miss,
            pc=pc,
            tca_utc_iso=record["tca_utc_iso"],
            passed=(MISS_DISTANCE_MIN_M <= miss <= MISS_DISTANCE_MAX_M) and (PC_MIN <= pc <= PC_MAX),
        )
    except Exception as exc:  # reported, never raised
        logger.exception("validation: Envisat %s could not run", day)
        outcome["passed"] = False
        outcome["error"] = str(exc)
    return outcome


def check_envisat() -> Dict[str, Any]:
    """All four archived prediction days, judged by the regression test's bounds."""
    ts = load.timescale()
    days = [_envisat_day(day, ts) for day in _PREDICTION_DAYS]
    return {
        "id": "envisat",
        "name": "Envisat / Zenith-2, October 2004",
        "days": days,
        "asserted": {
            "miss_distance_m": [MISS_DISTANCE_MIN_M, MISS_DISTANCE_MAX_M],
            "pc": [PC_MIN, PC_MAX],
        },
        "published": _PUBLISHED,
        "passed": len(days) == len(_PREDICTION_DAYS) and all(d.get("passed") for d in days),
        "test": "tests/test_envisat_replay.py",
    }


def run_validation() -> Dict[str, Any]:
    """Run both checks now. Never raises."""
    started = time.time()
    checks = [check_alfano(), check_envisat()]
    return {
        "passed": all(c.get("passed") for c in checks),
        "checks": checks,
        "ran_at_unix": started,
        "duration_s": time.time() - started,
        "notes": "docs/validation-notes.md",
    }


def get_validation_report(force: bool = False) -> Dict[str, Any]:
    """The cached report, running the checks on first use (or when forced)."""
    global _cached
    with _lock:
        if _cached is None or force:
            _cached = run_validation()
            logger.info(
                "validation: %s in %.1fs",
                "passed" if _cached["passed"] else "FAILED",
                _cached["duration_s"],
            )
        return _cached
