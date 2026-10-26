"""
spacetrack.py — Space-Track.org as a second live source of element sets.

WHY THIS EXISTS. CelesTrak blocked this project's IP on 2026-09-06 (CLAUDE.md
§2), and CelesTrak has no accounts, so nothing on our side can undo it. The
server fell back to a committed offline set, which is real data but ages by the
day. Space-Track is the 18th Space Defense Squadron's own catalogue — the
source CelesTrak itself republishes — and it authenticates per account rather
than per IP, so it is reachable from here.

SAME GROUPS, SAME FORMAT. Each CelesTrak group the server tracks is mapped to
an equivalent Space-Track `gp` query below, and the response is normalised to
CelesTrak's 3-line text so everything downstream (parsing, validation,
screening) is unchanged. The mapping is by international designator — the
launch that produced the debris — which is exactly how CelesTrak defines these
groups.

RATE LIMITS ARE A HARD CONSTRAINT, not a courtesy. Space-Track's usage policy
caps accounts at 30 requests/minute and 300/hour, asks that `gp` data be pulled
no more than about once an hour, and suspends accounts that poll harder. So:

  * one login, one query per group, one logout — per refresh;
  * the caller (tracked_set.py) only refreshes when its 6 h cache is stale;
  * after a failure, no retry for `FAIL_BACKOFF_S` (30 min);
  * after a REJECTED LOGIN, no retry at all until restart — repeated failed
    logins are how accounts get locked.

Credentials come from SPACETRACK_USERNAME / SPACETRACK_PASSWORD (.env). They
are never logged.

DATA USE. Space-Track's user agreement restricts redistributing its data to
third parties. Serving it to this console's own users is ordinary use; check
the agreement before exposing the console publicly.
"""

import http.cookiejar
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

_BASE = "https://www.space-track.org"
_LOGIN_URL = f"{_BASE}/ajaxauth/login"
_LOGOUT_URL = f"{_BASE}/ajaxauth/logout"
_QUERY_URL = f"{_BASE}/basicspacedata/query/class/gp/{{filters}}/orderby/NORAD_CAT_ID/format/3le"

# Objects whose newest element set is older than this are left out, matching
# CelesTrak's own practice: an object the network has not updated in a month
# is probably lost or decayed, and propagating its elements would draw a
# marker where nothing is.
_MAX_EPOCH_AGE_DAYS = 30

_COMMON = f"DECAY_DATE/null-val/EPOCH/%3Enow-{_MAX_EPOCH_AGE_DAYS}"

# CelesTrak group name -> Space-Track gp filters. Debris groups are defined by
# the international designator of the event that created them.
GROUP_QUERIES: Dict[str, str] = {
    # Cosmos 2251, destroyed in the 2009 collision with Iridium 33.
    "cosmos-2251-debris": f"OBJECT_ID/~~1993-036/OBJECT_TYPE/DEBRIS/{_COMMON}",
    # Iridium 33, the other half of that collision.
    "iridium-33-debris": f"OBJECT_ID/~~1997-051/OBJECT_TYPE/DEBRIS/{_COMMON}",
    # Fengyun-1C, destroyed by the 2007 anti-satellite test.
    "fengyun-1c-debris": f"OBJECT_ID/~~1999-025/OBJECT_TYPE/DEBRIS/{_COMMON}",
    # Crewed stations, by catalogue number: ISS (Zarya), and the Chinese
    # station's Tianhe, Wentian and Mengtian modules.
    "stations": f"NORAD_CAT_ID/25544,48274,53239,54216/{_COMMON}",
}

_REQUEST_TIMEOUT_S = 45
FAIL_BACKOFF_S = 30 * 60


class SpaceTrackError(Exception):
    """A Space-Track fetch failed. The message never contains credentials."""


class SpaceTrackAuthError(SpaceTrackError):
    """The login was rejected. Retrying would risk locking the account."""


def credentials() -> Optional[tuple[str, str]]:
    """(username, password) from the environment, or None if not configured."""
    user = os.environ.get("SPACETRACK_USERNAME", "").strip()
    password = os.environ.get("SPACETRACK_PASSWORD", "")
    if not user or not password or user == "your-email@example.com":
        return None
    return user, password


def normalise_3le(text: str) -> str:
    """
    Space-Track's 3le puts a "0 " in front of each name line; CelesTrak's 3-line
    format does not. Strip it so one parser handles both.
    """
    out: List[str] = []
    for line in text.splitlines():
        if line.startswith("0 "):
            out.append(line[2:].strip())
        elif line.strip():
            out.append(line.rstrip())
    return "\n".join(out) + ("\n" if out else "")


class SpaceTrackClient:
    """Fetches tracked groups from Space-Track, within its rate limits."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._failed_at: Optional[float] = None
        self._auth_rejected = False

    def unavailable_reason(self) -> Optional[str]:
        """Why a fetch would not be attempted right now, or None if it would."""
        if credentials() is None:
            return "Space-Track credentials not configured"
        if self._auth_rejected:
            return "Space-Track login was rejected; not retrying until restart"
        if self._failed_at is not None and time.time() - self._failed_at < FAIL_BACKOFF_S:
            wait_min = (FAIL_BACKOFF_S - (time.time() - self._failed_at)) / 60
            return f"Space-Track backing off after a failure ({wait_min:.0f} min left)"
        return None

    def fetch_groups(self, groups: List[str]) -> Dict[str, str]:
        """
        Fetch every supported group in ONE authenticated session.

        Returns {group: CelesTrak-format 3-line text}. Groups with no
        Space-Track mapping are omitted, not guessed at. Raises SpaceTrackError
        if nothing could be fetched.
        """
        reason = self.unavailable_reason()
        if reason:
            raise SpaceTrackError(reason)

        supported = [g for g in groups if g in GROUP_QUERIES]
        if not supported:
            raise SpaceTrackError(f"no Space-Track mapping for groups {groups}")

        with self._lock:
            try:
                result = self._session_fetch(supported)
            except SpaceTrackAuthError:
                self._auth_rejected = True
                raise
            except SpaceTrackError:
                self._failed_at = time.time()
                raise
            self._failed_at = None
            return result

    def _session_fetch(self, groups: List[str]) -> Dict[str, str]:
        creds = credentials()
        assert creds is not None  # checked by unavailable_reason
        user, password = creds

        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        opener.addheaders = [("User-Agent", "OrbitalRiskAdvisor/1.0")]

        body = urllib.parse.urlencode({"identity": user, "password": password}).encode()
        try:
            with opener.open(_LOGIN_URL, data=body, timeout=_REQUEST_TIMEOUT_S) as resp:
                login_text = resp.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise SpaceTrackError(f"Space-Track login request failed: {exc}") from None

        # A rejected login still answers 200, with this message in the body.
        if "Failed" in login_text:
            raise SpaceTrackAuthError("Space-Track rejected the login (check SPACETRACK_* in .env)")

        out: Dict[str, str] = {}
        errors: List[str] = []
        try:
            for group in groups:
                url = _QUERY_URL.format(filters=GROUP_QUERIES[group])
                try:
                    with opener.open(url, timeout=_REQUEST_TIMEOUT_S) as resp:
                        text = resp.read().decode("utf-8")
                except (urllib.error.URLError, TimeoutError, OSError) as exc:
                    errors.append(f"{group}: {exc}")
                    continue
                out[group] = normalise_3le(text)
        finally:
            try:
                opener.open(_LOGOUT_URL, timeout=15).close()
            except (urllib.error.URLError, TimeoutError, OSError):
                pass  # the session expires on its own

        if not out:
            raise SpaceTrackError("Space-Track returned nothing: " + "; ".join(errors))
        if errors:
            logger.warning("spacetrack: some groups failed: %s", "; ".join(errors))
        return out
