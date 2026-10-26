"""
Space-Track as the second live source of the tracked set.

CelesTrak blocked this project's IP, so Space-Track is what keeps the console
on current element sets. Pinned here:

  1. A group CelesTrak cannot serve is fetched from Space-Track, and the
     snapshot is `live` with provider `space-track` — never mislabelled.
  2. A group CelesTrak CAN serve never touches Space-Track (rate limits).
  3. When both fail, the offline/cached fallbacks behave exactly as before.
  4. Space-Track's 3le format normalises to CelesTrak's 3-line format.
  5. Rejected logins and failures back off instead of hammering the account.
"""

import time

import pytest

from backend.api import spacetrack as st
from backend.api.spacetrack import SpaceTrackClient, SpaceTrackError, normalise_3le
from backend.api.tracked_set import TrackedSet

ISS_3LE = (
    "0 ISS (ZARYA)\n"
    "1 25544U 98067A   26278.04655461  .00004924  00000-0  98343-4 0  9996\n"
    "2 25544  51.6316 116.4131 0006856 223.9771 136.0673 15.48738655588781\n"
)
ISS_CELESTRAK = normalise_3le(ISS_3LE)


class FakeSpaceTrack:
    def __init__(self, texts=None, error=None):
        self.texts = texts or {}
        self.error = error
        self.calls = []

    def fetch_groups(self, groups):
        self.calls.append(list(groups))
        if self.error:
            raise self.error
        return {g: self.texts[g] for g in groups if g in self.texts}


def _blocked(self, group, timeout_s=None):
    raise TimeoutError("celestrak unreachable")


def test_normalise_3le_strips_the_name_prefix():
    assert ISS_CELESTRAK.splitlines()[0] == "ISS (ZARYA)"
    assert ISS_CELESTRAK.splitlines()[1].startswith("1 25544U")
    assert len(ISS_CELESTRAK.splitlines()) == 3


def test_blocked_celestrak_falls_through_to_spacetrack(monkeypatch):
    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)
    fake = FakeSpaceTrack({"stations": ISS_CELESTRAK})

    snap = TrackedSet(["stations"], spacetrack=fake).load()

    assert snap.count == 1
    assert snap.source == "live", "a fresh Space-Track fetch is live data"
    assert snap.providers == ("space-track",)
    assert fake.calls == [["stations"]]


def test_reachable_celestrak_never_calls_spacetrack(monkeypatch):
    monkeypatch.setattr(TrackedSet, "_fetch_group", lambda self, g, t=None: ISS_CELESTRAK)
    fake = FakeSpaceTrack({"stations": ISS_CELESTRAK})

    snap = TrackedSet(["stations"], spacetrack=fake).load()

    assert snap.providers == ("celestrak",)
    assert fake.calls == [], "Space-Track must not be polled when it is not needed"


def test_only_the_missing_groups_go_to_spacetrack(monkeypatch):
    def partial(self, group, timeout_s=None):
        if group == "stations":
            return ISS_CELESTRAK
        raise TimeoutError("blocked")

    monkeypatch.setattr(TrackedSet, "_fetch_group", partial)
    fake = FakeSpaceTrack({})

    TrackedSet(["stations", "cosmos-2251-debris"], spacetrack=fake).load()

    assert fake.calls == [["cosmos-2251-debris"]]


def test_both_sources_down_keeps_the_offline_floor(monkeypatch):
    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)
    fake = FakeSpaceTrack(error=SpaceTrackError("down"))

    snap = TrackedSet(["cosmos-2251-debris"], spacetrack=fake).load()

    # The committed offline set is the floor; it is never labelled live.
    assert snap.source in ("bundled", "none")
    assert snap.source != "live"
    assert "Space-Track: down" in (snap.error or "")


def test_cached_replay_keeps_the_original_provider(monkeypatch):
    monkeypatch.setattr(TrackedSet, "_fetch_group", _blocked)
    fake = FakeSpaceTrack({"stations": ISS_CELESTRAK})
    tracked = TrackedSet(["stations"], spacetrack=fake)
    assert tracked.load().source == "live"

    fake.error = SpaceTrackError("down")
    snap = tracked.load(force_refresh=True)

    assert snap.source == "cached"
    assert snap.providers == ("space-track",)
    assert snap.count == 1


# --- the client's own guard rails ----------------------------------------


# Captured at import, before conftest's autouse guard replaces it per test.
_ORIGINAL_FETCH_GROUPS = SpaceTrackClient.fetch_groups


@pytest.fixture
def real_client(monkeypatch):
    """The real fetch_groups guard logic, with _session_fetch stubbed per test."""
    monkeypatch.setattr(SpaceTrackClient, "fetch_groups", _ORIGINAL_FETCH_GROUPS)
    monkeypatch.setenv("SPACETRACK_USERNAME", "user@example.org")
    monkeypatch.setenv("SPACETRACK_PASSWORD", "pw")
    return SpaceTrackClient()


def test_rejected_login_is_never_retried(real_client, monkeypatch):
    calls = []

    def reject(self, groups):
        calls.append(1)
        raise st.SpaceTrackAuthError("rejected")

    monkeypatch.setattr(SpaceTrackClient, "_session_fetch", reject)

    with pytest.raises(st.SpaceTrackAuthError):
        real_client.fetch_groups(["stations"])
    with pytest.raises(SpaceTrackError, match="not retrying"):
        real_client.fetch_groups(["stations"])
    assert len(calls) == 1, "a second login attempt risks locking the account"


def test_failure_backs_off(real_client, monkeypatch):
    calls = []

    def fail(self, groups):
        calls.append(1)
        raise SpaceTrackError("timeout")

    monkeypatch.setattr(SpaceTrackClient, "_session_fetch", fail)

    with pytest.raises(SpaceTrackError):
        real_client.fetch_groups(["stations"])
    with pytest.raises(SpaceTrackError, match="backing off"):
        real_client.fetch_groups(["stations"])
    assert len(calls) == 1

    real_client._failed_at = time.time() - st.FAIL_BACKOFF_S - 1
    with pytest.raises(SpaceTrackError, match="timeout"):
        real_client.fetch_groups(["stations"])
    assert len(calls) == 2


def test_missing_credentials_are_reported_not_attempted(monkeypatch):
    monkeypatch.delenv("SPACETRACK_USERNAME", raising=False)
    monkeypatch.delenv("SPACETRACK_PASSWORD", raising=False)
    assert "not configured" in SpaceTrackClient().unavailable_reason()


def test_every_default_group_has_a_spacetrack_mapping():
    for group in ("cosmos-2251-debris", "iridium-33-debris", "stations"):
        assert group in st.GROUP_QUERIES
