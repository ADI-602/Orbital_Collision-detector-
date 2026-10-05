"""
Suite-wide guards.

No test may reach Space-Track. Importing backend.api.main loads .env, so real
credentials are present during the run, and a test that stubs out CelesTrak
would otherwise fall through to a live, rate-limited, account-scoped service —
slow, flaky, and a way to get the account throttled. Tests that exercise the
Space-Track path inject their own fake client.
"""

import pytest

from backend.api.spacetrack import SpaceTrackClient, SpaceTrackError


@pytest.fixture(autouse=True)
def _no_live_spacetrack(monkeypatch):
    def refuse(self, groups):
        raise SpaceTrackError("Space-Track disabled in tests")

    monkeypatch.setattr(SpaceTrackClient, "fetch_groups", refuse)
