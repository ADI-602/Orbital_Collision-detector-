"""
test_screening_batch_isolation.py — one bad candidate must not fail the batch.

THE BUG THIS PINS. /api/physics/screening used to wrap its whole body in one
try/except that turned any exception into a 500. compute_pc correctly refuses a
pair whose relative velocity at TCA is effectively zero — a co-located pair has
no encounter plane, so the 2D method is undefined and refusing is the honest
answer. But that refusal escaped the loop and became a 500 for the entire
request.

CelesTrak's `stations` group always contains co-located objects (ISS with
docked Progress/Soyuz, modules sharing an element set), so in practice the
batch form of this endpoint returned 500 every single time and no candidate was
ever assessed. The frontend worked around it by issuing one HTTP request per
candidate, which costs a full round trip and a fresh timescale load each time.

These tests exist so that regression cannot come back quietly. A batch
containing a pair the physics declines must still return every other
candidate's real result, and must say — in the pipeline's own words — why the
declined one has no number.
"""

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.api.main import app  # noqa: E402
from backend.api.assessment import HARD_BODY_RADIUS_KM  # noqa: E402
from tests.fixtures.envisat_tles import ENVISAT_TLES, ZENITH2_TLES  # noqa: E402


client = TestClient(app)

# The known-good pair: a real conjunction with a published answer.
_ENVISAT = {
    "name": "ENVISAT",
    "line1": ENVISAT_TLES["oct_22"][0],
    "line2": ENVISAT_TLES["oct_22"][1],
}
_ZENITH2 = {
    "name": "ZENITH-2 DEBRIS",
    "line1": ZENITH2_TLES["oct_22"][0],
    "line2": ZENITH2_TLES["oct_22"][1],
}

def _renumber(line1: str, line2: str, satnum: int) -> tuple[str, str]:
    """Re-catalogue an element set under a different object number.

    Needed because screen_candidates skips a pair sharing a catalogue number
    as a self-pair (screening.py), which is correct — so Envisat's own TLE
    under a new *name* is not a co-located pair, it is Envisat. Changing the
    number in columns 3-7 of both lines makes it a genuinely distinct object
    flying the identical orbit, which is what a docked module looks like to
    the pipeline.

    The checksum digit is left stale on purpose: parse_tle_pair deliberately
    does not verify checksums (real catalogue feeds carry bad ones), so this
    exercises the same path a real co-located pair would.
    """
    field = f"{satnum:05d}"
    return line1[:2] + field + line1[7:], line2[:2] + field + line2[7:]


# The pathological candidate: Envisat's element set re-catalogued as a
# different object. Screened against Envisat it is a perfectly co-located
# pair, so relative velocity at TCA is zero and Pc is undefined — the exact
# condition that used to 500 the whole request.
_CO_LOCATED_L1, _CO_LOCATED_L2 = _renumber(
    ENVISAT_TLES["oct_22"][0], ENVISAT_TLES["oct_22"][1], 99001,
)
_CO_LOCATED = {
    "name": "CO-LOCATED COPY",
    "line1": _CO_LOCATED_L1,
    "line2": _CO_LOCATED_L2,
}

_WINDOW = {
    "start_utc_iso": "2004-10-22T00:00:00Z",
    "search_duration_hours": 12,
}


def _screen(primary, candidates):
    return client.post(
        "/api/physics/screening",
        json={"primary": primary, "candidates": candidates, **_WINDOW},
    )


class TestBatchIsolation:
    def test_good_pair_alone_still_works(self):
        """Baseline: the validation case in a batch of one."""
        r = _screen(_ENVISAT, [_ZENITH2])
        assert r.status_code == 200

        events = r.json()["events"]
        assert len(events) == 1
        assert events[0]["threat_level"] == "RED"
        # The published miss distance for this prediction day is 268 m
        # (docs/validation-notes.md 4.4). Assert the ballpark, not the digits —
        # this test is about batching, not about reproducing the physics, which
        # test_envisat_replay.py already gates.
        assert 100.0 < events[0]["miss_distance_m"] < 1000.0

    def test_event_states_the_hard_body_radius_it_used(self):
        """The UI shows the collision radius behind each Pc. It must be the
        value compute_pc was actually given, in metres, not a display copy."""
        r = _screen(_ENVISAT, [_ZENITH2])
        assert r.status_code == 200
        event = r.json()["events"][0]
        assert event["hard_body_radius_m"] == pytest.approx(HARD_BODY_RADIUS_KM * 1000.0)

    def test_unassessable_candidate_does_not_500(self):
        """A co-located pair on its own must come back as a result, not an error."""
        r = _screen(_ENVISAT, [_CO_LOCATED])
        assert r.status_code == 200, (
            f"co-located pair produced HTTP {r.status_code} — the batch-failure "
            f"regression is back: {r.text[:300]}"
        )

    def test_unassessable_candidate_does_not_erase_the_others(self):
        """THE REGRESSION. Both candidates in one request: the good one must
        still be assessed, and the refused one must be reported as refused."""
        r = _screen(_ENVISAT, [_CO_LOCATED, _ZENITH2])
        assert r.status_code == 200, (
            f"batch containing one unassessable pair returned HTTP "
            f"{r.status_code} — every candidate's result was lost: {r.text[:300]}"
        )

        events = r.json()["events"]
        by_name = {e["secondary_name"]: e for e in events}

        assert "ZENITH-2 DEBRIS" in by_name, (
            "the assessable candidate was dropped because another candidate "
            "in the same batch could not be assessed"
        )
        good = by_name["ZENITH-2 DEBRIS"]
        assert good.get("unassessable") is not True
        assert good["threat_level"] == "RED"
        assert good["pc"] > 0.0

    def test_refusal_carries_the_reason_and_no_numbers(self):
        """A declined pair must say why, in the physics' own words, and must
        not carry a Pc or a miss distance. Substituting a plausible number for
        one the pipeline refused to produce is the failure mode this whole
        project exists to avoid."""
        r = _screen(_ENVISAT, [_CO_LOCATED, _ZENITH2])
        assert r.status_code == 200

        refused = [e for e in r.json()["events"] if e.get("unassessable")]
        assert len(refused) == 1, (
            "expected the co-located pair to be reported as unassessable, got "
            f"{[e['secondary_name'] for e in r.json()['events']]}"
        )

        entry = refused[0]
        assert entry["secondary_name"] == "CO-LOCATED COPY"
        assert isinstance(entry.get("reason"), str) and entry["reason"]

        for numeric_field in ("pc", "miss_distance_m", "threat_level",
                              "relative_speed_km_s", "hard_body_radius_m"):
            assert numeric_field not in entry, (
                f"refused pair carries a {numeric_field} — no value may stand "
                "in for one the physics declined to compute"
            )

    def test_batch_of_many_reports_every_candidate_once(self):
        """Scale check: a batch mixing good and refused candidates returns one
        record per flagged candidate, with none silently merged or lost."""
        zl1, zl2 = _renumber(ZENITH2_TLES["oct_22"][0], ZENITH2_TLES["oct_22"][1], 99002)
        candidates = [
            _ZENITH2,
            _CO_LOCATED,
            {"name": "ZENITH-2 COPY", "line1": zl1, "line2": zl2},
        ]
        r = _screen(_ENVISAT, candidates)
        assert r.status_code == 200

        body = r.json()
        assert body["candidates_screened"] == 3

        names = [e["secondary_name"] for e in body["events"]]
        assert len(names) == len(set(names)), f"a candidate was duplicated: {names}"
        assert "CO-LOCATED COPY" in names, (
            "the refused candidate vanished instead of being reported"
        )
        assert "ZENITH-2 DEBRIS" in names
        assert "ZENITH-2 COPY" in names


class TestRequestLevelFailuresStillError:
    """Isolating candidate failures must not swallow real request errors."""

    def test_unparseable_primary_is_a_client_error(self):
        r = _screen({"name": "BAD", "line1": "not a tle", "line2": "also not"},
                    [_ZENITH2])
        assert r.status_code == 400

    def test_malformed_window_is_a_client_error(self):
        r = client.post(
            "/api/physics/screening",
            json={
                "primary": _ENVISAT,
                "candidates": [_ZENITH2],
                "start_utc_iso": "not-a-timestamp",
                "search_duration_hours": 12,
            },
        )
        assert r.status_code == 400

    def test_unparseable_candidate_is_named_not_hidden(self):
        """A candidate whose TLE will not parse never reaches the pipeline, so
        it cannot appear as 'no conjunction found'. It must be listed."""
        r = _screen(_ENVISAT, [
            _ZENITH2,
            {"name": "GARBAGE", "line1": "nonsense", "line2": "nonsense"},
        ])
        assert r.status_code == 200

        body = r.json()
        rejected = {x["name"] for x in body.get("rejected_candidates", [])}
        assert "GARBAGE" in rejected
        assert body["candidates_screened"] == 1
        assert any(e["secondary_name"] == "ZENITH-2 DEBRIS" for e in body["events"])
