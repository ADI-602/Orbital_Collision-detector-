"""
The tracked-set read path must not block an HTTP request on CelesTrak.

This pins a real failure seen in the console: with CelesTrak unreachable,
`GET /api/tracking/objects` blocked for `len(groups) * _FETCH_TIMEOUT_S`, which
exceeded the browser's own 30 s timeout, so the frontend gave up and fell back
to its bundled snapshot. Every subsequent request re-paid the same cost, because
a failed load leaves the snapshot marked "cached"/"none" and the freshness check
only short-circuits on "live".

The physics is not involved here — this is about the API staying responsive when
a third party is down, which is a demo-survival property (CLAUDE.md §1.6).
"""

import threading
import time

import pytest

from backend.api import tracked_set as ts_module
from backend.api.tracked_set import TrackedSet


REAL_TLE = (
    "ISS (ZARYA)\n"
    "1 25544U 98067A   24215.50000000  .00016717  00000+0  30777-3 0  9005\n"
    "2 25544  51.6400 208.9163 0004604 306.2934  53.7629 15.49309620 10000\n"
)


def _slow_failing_fetch(delay_s):
    """A fetch that hangs like an unreachable host, then fails."""
    def fetch(self, group, timeout_s=None):
        time.sleep(delay_s)
        raise TimeoutError(f"{group}: pretend the network is down")
    return fetch


def test_request_path_does_not_wait_on_a_fetch_already_running(monkeypatch):
    """A request arriving mid-refresh reports what we have, it does not queue."""
    tracked = TrackedSet(["group-a", "group-b"])
    monkeypatch.setattr(TrackedSet, "_fetch_group", _slow_failing_fetch(0.6))

    # The monitor thread starts a refresh and holds the lock.
    refresher = threading.Thread(target=tracked.load, daemon=True)
    refresher.start()
    time.sleep(0.1)

    started = time.time()
    snap = tracked.load_for_request()
    elapsed = time.time() - started

    # Must return promptly rather than waiting out the in-flight fetch. What it
    # returns is whatever floor is already in place (the committed offline set,
    # seeded at construction) — the point is that it does not queue.
    assert elapsed < 0.3, f"request path blocked for {elapsed:.2f}s behind a running fetch"
    assert snap.source in ("bundled", "none"), (
        "a request during a cold fetch must not claim live or cached data"
    )
    refresher.join(timeout=5)


def test_repeated_failures_are_backed_off(monkeypatch):
    """A second call after a failure returns immediately instead of re-fetching."""
    tracked = TrackedSet(["group-a", "group-b"])
    calls = []

    def fetch(self, group, timeout_s=None):
        calls.append(group)
        raise TimeoutError("network down")

    monkeypatch.setattr(TrackedSet, "_fetch_group", fetch)

    tracked.load()
    first_round = len(calls)
    assert first_round == 2, "expected one attempt per group"

    tracked.load()
    assert len(calls) == first_round, (
        "a failed fetch was retried immediately; an unreachable CelesTrak would "
        "make every request pay the full timeout"
    )


def test_backoff_expires(monkeypatch):
    """The backoff is a pause, not a permanent giving-up."""
    tracked = TrackedSet(["group-a"])
    calls = []

    def fetch(self, group, timeout_s=None):
        calls.append(group)
        raise TimeoutError("network down")

    monkeypatch.setattr(TrackedSet, "_fetch_group", fetch)
    monkeypatch.setattr(ts_module, "_FAIL_BACKOFF_S", 0.05)

    tracked.load()
    time.sleep(0.1)
    tracked.load()

    assert len(calls) == 2, "the set must retry once the backoff window passes"


def test_force_refresh_ignores_the_backoff(monkeypatch):
    """An explicit refresh is a deliberate act and must not be swallowed."""
    tracked = TrackedSet(["group-a"])
    calls = []

    def fetch(self, group, timeout_s=None):
        calls.append(group)
        raise TimeoutError("network down")

    monkeypatch.setattr(TrackedSet, "_fetch_group", fetch)

    tracked.load()
    tracked.load(force_refresh=True)
    assert len(calls) == 2


def test_a_populated_set_is_served_without_fetching(monkeypatch):
    """Once we have objects, the request path never touches the network."""
    tracked = TrackedSet(["group-a"])
    monkeypatch.setattr(TrackedSet, "_fetch_group", lambda self, group, timeout_s=None: REAL_TLE)

    assert tracked.load().count == 1

    def explode(self, group, timeout_s=None):
        raise AssertionError("request path must not fetch when a set already exists")

    monkeypatch.setattr(TrackedSet, "_fetch_group", explode)
    assert tracked.load_for_request().count == 1


def test_a_failed_fetch_never_empties_an_existing_set(monkeypatch):
    """An empty globe is indistinguishable from 'nothing is up there'."""
    tracked = TrackedSet(["group-a"])
    monkeypatch.setattr(TrackedSet, "_fetch_group", lambda self, group, timeout_s=None: REAL_TLE)
    tracked.load()

    def fetch(self, group, timeout_s=None):
        raise TimeoutError("network down")

    monkeypatch.setattr(TrackedSet, "_fetch_group", fetch)
    snap = tracked.load(force_refresh=True)

    assert snap.count == 1, "the previous set must survive a failed refresh"
    assert snap.source == "cached", "stale data must never be reported as live"
    assert snap.error, "the reason it is stale must be stated"


@pytest.mark.parametrize("group_count", [1, 2, 4])
def test_cold_fetch_budget_stays_under_the_client_timeout(group_count):
    """
    The worst-case cold fetch must fit inside the frontend's 30 s timeout.

    This is the arithmetic that actually broke: two groups at 20 s each is 40 s,
    and the browser had already given up.
    """
    worst_case_s = min(
        group_count * ts_module._FETCH_TIMEOUT_S,
        ts_module._TOTAL_FETCH_BUDGET_S,
    )
    assert worst_case_s < 30, (
        f"{group_count} groups x {ts_module._FETCH_TIMEOUT_S}s capped at "
        f"{ts_module._TOTAL_FETCH_BUDGET_S}s = {worst_case_s}s, which exceeds "
        "the frontend's 30 s timeout on /api/tracking/objects"
    )


def test_the_budget_is_what_bounds_a_many_group_load():
    """The guarantee must survive someone adding tracked groups."""
    # Per-group timeouts alone multiply; the total budget is the real bound.
    assert ts_module._TOTAL_FETCH_BUDGET_S < 30


def test_replayed_cached_text_is_not_reported_as_live(monkeypatch):
    """Serving cached bytes and calling them "live" is a source-honesty break."""
    tracked = TrackedSet(["group-a"])
    monkeypatch.setattr(TrackedSet, "_fetch_group", lambda self, g, t=None: REAL_TLE)
    assert tracked.load().source == "live"

    def fetch(self, group, timeout_s=None):
        raise TimeoutError("network down")

    monkeypatch.setattr(TrackedSet, "_fetch_group", fetch)
    snap = tracked.load(force_refresh=True)

    assert snap.count == 1, "the cached element sets should still be served"
    assert snap.source == "cached", (
        "replayed cached text was labelled live — the UI would show stale "
        "element sets as a live feed"
    )
