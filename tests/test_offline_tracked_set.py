"""
The committed offline tracked set — the console's last line of defence when
CelesTrak cannot be reached.

This exists because CelesTrak blocked this project's IP mid-build. The live feed
is a third party we do not control, and an empty globe during a judged demo is
the failure mode this whole fallback chain exists to prevent.

Two properties matter and are pinned here:

  1. It works with no network at all.
  2. It is never mistaken for live data. The snapshot is labelled `bundled` and
     dated with its CAPTURE epoch, not the moment it was read — stamping old
     element sets with `now` is the same class of dishonesty as inventing a
     number (CLAUDE.md §1.4, §5.2).
"""

import json
import time
from datetime import datetime, timezone

import pytest

from backend.api import tracked_set as ts_module
from backend.api.tracked_set import TrackedSet


def _blocked(self, group, timeout_s=None):
    raise TimeoutError("celestrak unreachable")


REAL_TLE = (
    "ISS (ZARYA)\n"
    "1 25544U 98067A   26242.49847866  .00005671  00000+0  11126-3 0  9990\n"
    "2 25544  51.6316 292.2906 0005027  90.0365 270.1200 15.48938909583274\n"
)


@pytest.fixture
def offline_file(tmp_path, monkeypatch):
    """Point the loader at a throwaway offline set."""
    def write(payload):
        path = tmp_path / "offline.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        monkeypatch.setattr(ts_module, "_OFFLINE_SET_PATH", path)
        return path
    return write


def test_falls_back_to_the_offline_set_with_no_network(offline_file, monkeypatch):
    offline_file({
        "captured_utc": "2026-08-30T00:00:00Z",
        "groups": ["stations"],
        "tle_text": REAL_TLE,
    })
    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)

    snap = TrackedSet(["cosmos-2251-debris"]).load()

    assert snap.count == 1, "the console must still have objects to track"
    assert snap.source == "bundled"
    assert snap.error, "the reason the live feed was not used must be stated"


def test_the_offline_set_is_dated_by_its_capture_epoch(offline_file, monkeypatch):
    """Old element sets must not be stamped with the time they were read."""
    offline_file({
        "captured_utc": "2026-08-30T00:00:00Z",
        "groups": ["stations"],
        "tle_text": REAL_TLE,
    })
    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)

    snap = TrackedSet(["g"]).load()

    expected = datetime(2026, 8, 30, tzinfo=timezone.utc).timestamp()
    assert snap.fetched_at == pytest.approx(expected), (
        "fetched_at should be the capture epoch declared in the file"
    )
    assert time.time() - snap.fetched_at > 3600, (
        "a bundled set dated 'now' would render as a fresh fetch in the UI"
    )


def test_the_reported_groups_describe_the_objects_actually_served(
    offline_file, monkeypatch,
):
    """
    The groups field must name what is on the globe, not what we tried to fetch.

    Reporting the configured groups on a fallback labelled a 4-object `stations`
    set as `cosmos-2251-debris, iridium-33-debris` — a debris cloud that was not
    being tracked at all.
    """
    offline_file({
        "captured_utc": "2026-08-30T00:00:00Z",
        "groups": ["stations"],
        "tle_text": REAL_TLE,
    })
    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)

    tracked = TrackedSet(["cosmos-2251-debris", "iridium-33-debris"])
    assert tracked.load().groups == ["stations"]
    # And it must survive a later failed refresh, which is where it broke.
    assert tracked.load(force_refresh=True).groups == ["stations"]


def test_the_offline_set_is_never_labelled_live_or_cached(offline_file, monkeypatch):
    offline_file({
        "captured_utc": "2026-08-30T00:00:00Z", "groups": [], "tle_text": REAL_TLE,
    })
    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)

    assert TrackedSet(["g"]).load().source not in ("live", "cached")


def test_a_live_fetch_always_wins(offline_file, monkeypatch):
    """The fallback is a floor, not a substitute."""
    offline_file({
        "captured_utc": "2026-08-30T00:00:00Z", "groups": [], "tle_text": REAL_TLE,
    })
    monkeypatch.setattr(
        TrackedSet, "_fetch_group", lambda self, g, timeout_s=None: REAL_TLE,
    )

    snap = TrackedSet(["g"]).load()
    assert snap.source == "live"


def test_an_in_memory_set_is_preferred_over_the_bundled_one(offline_file, monkeypatch):
    """A set we actually fetched this session is fresher than a committed file."""
    offline_file({
        "captured_utc": "2020-01-01T00:00:00Z", "groups": [], "tle_text": REAL_TLE,
    })
    tracked = TrackedSet(["g"])
    monkeypatch.setattr(
        TrackedSet, "_fetch_group", lambda self, g, timeout_s=None: REAL_TLE,
    )
    assert tracked.load().source == "live"

    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)
    snap = tracked.load(force_refresh=True)
    assert snap.source == "cached", "the live set from this session should be kept"


def test_a_missing_offline_file_is_not_an_error(tmp_path, monkeypatch):
    """The fallback is optional; absent simply means no floor."""
    monkeypatch.setattr(ts_module, "_OFFLINE_SET_PATH", tmp_path / "nope.json")
    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)

    snap = TrackedSet(["g"]).load()
    assert snap.count == 0
    assert snap.source == "none"


def test_a_corrupt_offline_file_does_not_crash_the_server(offline_file, monkeypatch):
    path = offline_file({"captured_utc": "2026-08-30T00:00:00Z", "tle_text": REAL_TLE})
    path.write_text("{ this is not json", encoding="utf-8")
    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)

    snap = TrackedSet(["g"]).load()
    assert snap.source == "none", "a bad file must degrade, not raise"


def test_an_unreadable_epoch_does_not_become_now(offline_file, monkeypatch):
    offline_file({
        "captured_utc": "not a date", "groups": [], "tle_text": REAL_TLE,
    })
    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)

    snap = TrackedSet(["g"]).load()
    assert snap.fetched_at == 0.0, (
        "an unparseable epoch must not fall back to the current time"
    )


# --- the committed file itself ------------------------------------------------

def test_the_committed_offline_set_is_usable():
    """
    Guards the real file against a bad regeneration.

    scripts/refresh_tracked_set.py rewrites this; if it ever writes something
    the pipeline cannot parse, the failure must surface here rather than on
    stage with the network already down.
    """
    path = ts_module._OFFLINE_SET_PATH
    assert path.exists(), f"the committed offline set is missing: {path}"

    raw = json.loads(path.read_text(encoding="utf-8"))
    objects, rejected = ts_module._parse_tle_text(raw["tle_text"], "committed")

    assert objects, "the committed offline set holds no usable element sets"
    assert not rejected, f"the committed file contains unparseable TLEs: {rejected}"
    assert raw.get("captured_utc"), "the capture epoch must be recorded"
    assert len(objects) == raw.get("object_count"), (
        "declared object_count does not match the element sets present"
    )


def test_the_committed_offline_set_stays_small():
    """CLAUDE.md asks that large data dumps stay out of git."""
    size_kb = ts_module._OFFLINE_SET_PATH.stat().st_size / 1024
    assert size_kb < 600, (
        f"offline set is {size_kb:.0f} KB; lower --limit in "
        "scripts/refresh_tracked_set.py"
    )
