"""
tle_ingest.py — CelesTrak TLE fetch and parsing.

Fetches TLEs for Envisat (primary object) and a scoped candidate set of
LEO objects in similar orbital regimes, using CelesTrak's free GP endpoint.
No auth required.

Scope reduction (per CLAUDE.md §1.4): we do NOT attempt full-catalog
all-vs-all screening. We fetch one primary object plus a bounded candidate
set from CelesTrak's pre-filtered LEO debris group.

Caching: raw TLE text is written to a local .tle_cache/ directory
(gitignored) so CelesTrak is hit at most once per session. Pass
force_refresh=True to bypass the cache.
"""

import os
import time
import urllib.request
from pathlib import Path
from typing import Optional

from skyfield.api import EarthSatellite, Loader, load

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# CelesTrak GP endpoint — stable pattern, no auth required.
_CELESTRAK_BASE = "https://celestrak.org/SATCAT/ELEM/?CATNR={norad_id}&FORMAT=tle"

# CelesTrak pre-filtered group for active LEO objects (good candidate pool).
# Using the "stations" group for quick cross-check; the main candidate set
# for Envisat conjunction screening is LEO debris in ~800 km SSO regime.
_CELESTRAK_LEO_DEBRIS_URL = (
    "https://celestrak.org/SATCAT/ELEM/?GROUP=debris-sso&FORMAT=tle"
)

# Fallback group URL if we need a broader set.
_CELESTRAK_LEO_GROUP_URL = (
    "https://celestrak.org/SATCAT/ELEM/?GROUP=active&FORMAT=tle"
)

# Envisat: NORAD ID 27386 (ESA Earth Observation satellite, ~800 km SSO).
ENVISAT_NORAD_ID = 27386

# ISS: NORAD ID 25544 — used for frame-transform validation only.
ISS_NORAD_ID = 25544

# Cache directory (gitignored).
_CACHE_DIR = Path(__file__).parent.parent.parent / ".tle_cache"

# Max age before a cached TLE is considered stale (4 hours in seconds).
_CACHE_MAX_AGE_S = 4 * 3600


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _cache_path(key: str) -> Path:
    """Return the cache file path for a given key (e.g. norad ID or group name)."""
    _CACHE_DIR.mkdir(exist_ok=True)
    return _CACHE_DIR / f"{key}.tle"


def _is_cache_fresh(path: Path) -> bool:
    """True if the cache file exists and is younger than _CACHE_MAX_AGE_S."""
    if not path.exists():
        return False
    age_s = time.time() - path.stat().st_mtime
    return age_s < _CACHE_MAX_AGE_S


def _fetch_url(url: str) -> str:
    """Fetch a URL and return the response body as a string."""
    req = urllib.request.Request(url, headers={"User-Agent": "OrbitalRiskAdvisor/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8")


def _fetch_tle_text(url: str, cache_key: str, force_refresh: bool = False) -> str:
    """
    Fetch TLE text from *url*, using a local cache keyed by *cache_key*.
    Bypasses cache when force_refresh=True or the cache is stale.
    """
    path = _cache_path(cache_key)
    if not force_refresh and _is_cache_fresh(path):
        return path.read_text(encoding="utf-8")

    text = _fetch_url(url)
    path.write_text(text, encoding="utf-8")
    return text


def _parse_tle_text(raw: str, ts) -> list[EarthSatellite]:
    """
    Parse a block of TLE text (name / line1 / line2 triplets) into a list of
    skyfield EarthSatellite objects.  Ignores blank lines and comment lines.
    """
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    satellites: list[EarthSatellite] = []

    i = 0
    while i < len(lines):
        # TLE format: optional name line, then two numbered lines starting with "1 " / "2 "
        if lines[i].startswith("1 ") and i + 1 < len(lines) and lines[i + 1].startswith("2 "):
            # No name line — use NORAD ID from line 1 as the name.
            line1, line2 = lines[i], lines[i + 1]
            name = line1[2:7].strip()  # NORAD catalog number field
            satellites.append(EarthSatellite(line1, line2, name, ts))
            i += 2
        elif not lines[i].startswith("2 ") and i + 2 < len(lines) and lines[i + 1].startswith("1 ") and lines[i + 2].startswith("2 "):
            # Name line present.
            name, line1, line2 = lines[i], lines[i + 1], lines[i + 2]
            satellites.append(EarthSatellite(line1, line2, name, ts))
            i += 3
        else:
            i += 1

    return satellites


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_satellite(norad_id: int, force_refresh: bool = False) -> EarthSatellite:
    """
    Fetch a single satellite by NORAD catalog ID from CelesTrak.
    Returns a skyfield EarthSatellite object.

    Args:
        norad_id: NORAD catalog number (e.g. 27386 for Envisat).
        force_refresh: if True, bypass the local TLE cache.

    Raises:
        ValueError: if no satellite with that ID is found in the response.
    """
    ts = load.timescale()
    url = _CELESTRAK_BASE.format(norad_id=norad_id)
    raw = _fetch_tle_text(url, cache_key=str(norad_id), force_refresh=force_refresh)
    sats = _parse_tle_text(raw, ts)
    if not sats:
        raise ValueError(
            f"No TLE data returned for NORAD ID {norad_id}. "
            f"The object may not be in the public catalog."
        )
    return sats[0]


def fetch_candidate_set(
    group_url: str = _CELESTRAK_LEO_DEBRIS_URL,
    cache_key: str = "candidate_set",
    force_refresh: bool = False,
) -> list[EarthSatellite]:
    """
    Fetch a group of satellites/debris objects from CelesTrak for use as the
    conjunction screening candidate set.

    Default group: SSO debris (~800 km sun-synchronous orbits, same regime
    as Envisat).  Override group_url for a different population.

    Args:
        group_url: CelesTrak group URL to fetch.
        cache_key: filename key for the local cache.
        force_refresh: if True, bypass the local TLE cache.

    Returns:
        List of skyfield EarthSatellite objects.
    """
    ts = load.timescale()
    raw = _fetch_tle_text(group_url, cache_key=cache_key, force_refresh=force_refresh)
    return _parse_tle_text(raw, ts)


def fetch_iss(force_refresh: bool = False) -> EarthSatellite:
    """
    Convenience wrapper: fetch the ISS by NORAD ID 25544.
    Used for frame-transform validation in tests/test_frame_transforms.py.
    """
    return fetch_satellite(ISS_NORAD_ID, force_refresh=force_refresh)


def fetch_envisat(force_refresh: bool = False) -> EarthSatellite:
    """
    Convenience wrapper: fetch Envisat by NORAD ID 27386.
    Primary object for the demo conjunction scenario.
    """
    return fetch_satellite(ENVISAT_NORAD_ID, force_refresh=force_refresh)


class InvalidTLEError(ValueError):
    """A TLE that cannot be trusted to describe a real object."""


def parse_tle_pair(line1: str, line2: str, name: str = "SATELLITE") -> EarthSatellite:
    """
    Parse a pair of TLE lines into a skyfield EarthSatellite object.

    VALIDATES, rather than trusting the propagator to complain. Neither
    skyfield nor sgp4 rejects malformed input here: handed the string
    "nonsense" for both lines, they return a perfectly usable EarthSatellite
    with catalogue number 0 and an epoch of 1999-12-31. That object propagates,
    reports positions, and will happily produce conjunctions with real
    satellites. A phantom object is far worse than a parse error, because
    nothing downstream can tell it apart from a real one — which is precisely
    the "silent fallback" CLAUDE.md 1.5 forbids.

    So the obvious structural facts are checked, and anything that fails raises
    rather than returning a plausible-looking object.

    Checksums are deliberately NOT verified. Real catalogue feeds occasionally
    carry lines with bad or stripped checksum digits that are otherwise
    perfectly valid, and rejecting those would discard real objects to catch a
    class of error the checks below already cover.

    Args:
        line1: TLE line 1.
        line2: TLE line 2.
        name:  display name for the object.

    Returns:
        A skyfield EarthSatellite.

    Raises:
        InvalidTLEError: the lines are not a usable element set.
    """
    if not isinstance(line1, str) or not isinstance(line2, str):
        raise InvalidTLEError(f"{name}: TLE lines must be strings")

    l1, l2 = line1.rstrip(), line2.rstrip()

    if not l1.startswith("1 ") or not l2.startswith("2 "):
        raise InvalidTLEError(
            f"{name}: TLE lines must begin with '1 ' and '2 ' "
            f"(got {l1[:2]!r} and {l2[:2]!r})"
        )

    # Columns 3-7 carry the catalogue number on both lines.
    if len(l1) < 69 or len(l2) < 69:
        raise InvalidTLEError(
            f"{name}: TLE lines are too short to be complete "
            f"({len(l1)} and {len(l2)} characters, expected 69)"
        )

    try:
        satnum1 = int(l1[2:7])
        satnum2 = int(l2[2:7])
    except ValueError as exc:
        raise InvalidTLEError(f"{name}: catalogue number is not numeric") from exc

    if satnum1 != satnum2:
        raise InvalidTLEError(
            f"{name}: line 1 and line 2 describe different objects "
            f"({satnum1} vs {satnum2})"
        )
    if satnum1 == 0:
        raise InvalidTLEError(f"{name}: catalogue number 0 is not a real object")

    ts = load.timescale()
    try:
        sat = EarthSatellite(l1, l2, name, ts)
    except Exception as exc:
        raise InvalidTLEError(f"{name}: element set rejected: {exc}") from exc

    # sgp4 reports an unusable element set through a nonzero error code rather
    # than by raising.
    error = getattr(sat.model, "error", 0)
    if error:
        raise InvalidTLEError(
            f"{name}: sgp4 rejected the element set (error code {error})"
        )

    return sat

