"""
scripts/smoke_test.py — Phase 1 gate verification

Fetches one live TLE for the ISS (NORAD ID 25544) from CelesTrak,
propagates it to the current time using sgp4/skyfield, and prints
the resulting TEME position with explicit units and frame label.

This is a one-time verification tool, not part of the production pipeline.
Run it once to confirm the toolchain works end-to-end before Phase 2.

Usage (from repo root, with backend venv active):
    python scripts/smoke_test.py
"""

import math
import urllib.request
from datetime import datetime, timezone

from skyfield.api import EarthSatellite, load

# CelesTrak GP TLE text endpoint (confirmed working 2025-07)
# CATNR=25544 is the ISS (ZARYA). FORMAT=TLE returns 3-line TLE text.
# Docs: https://celestrak.org/NORAD/documentation/gp-data-formats.php
CELESTRAK_TLE_URL = (
    "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"
)


def fetch_iss_tle() -> tuple[str, str, str]:
    """Fetch the current ISS TLE from CelesTrak's GP TLE endpoint.

    Returns (name, line1, line2) as strings.
    Raises on any network or parse error — no silent fallbacks.
    """
    print("Fetching ISS TLE from CelesTrak...")
    print(f"  URL: {CELESTRAK_TLE_URL}")

    req = urllib.request.Request(
        CELESTRAK_TLE_URL,
        headers={"User-Agent": "orbital-risk-advisor/0.1 smoke-test"},
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        raw = response.read().decode("utf-8", errors="replace")

    # TLE text format: three lines per object (name, line1, line2)
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    if len(lines) < 3:
        raise RuntimeError(
            f"Expected at least 3 TLE lines, got {len(lines)}. "
            f"Raw response:\n{raw[:200]}"
        )

    name = lines[0]
    line1 = lines[1]
    line2 = lines[2]

    print(f"  Object: {name}")
    print(f"  TLE line 1: {line1}")
    print(f"  TLE line 2: {line2}")

    # Basic format sanity: line 1 starts with "1 ", line 2 with "2 "
    if not line1.startswith("1 ") or not line2.startswith("2 "):
        raise RuntimeError(
            f"TLE lines don't match expected format.\n"
            f"  line1: {line1!r}\n  line2: {line2!r}"
        )

    return name, line1, line2


def propagate_to_now(name: str, line1: str, line2: str) -> None:
    """Propagate the given TLE to the current UTC time and print TEME position.

    Units: km (position), km/s (velocity).
    Frame: TEME (True Equator Mean Equinox) — the native SGP4 output frame.
    """
    ts = load.timescale()
    satellite = EarthSatellite(line1, line2, name, ts)

    now_utc = datetime.now(timezone.utc)
    t = ts.from_datetime(now_utc)

    # Access the raw SGP4 result for TEME-frame output.
    # sgp4() returns (error_code, position_km, velocity_km_s) in TEME frame.
    e, r_teme_km, v_teme_km_s = satellite.model.sgp4(t.whole, t.tt_fraction)

    if e != 0:
        raise RuntimeError(
            f"SGP4 propagation error code {e} — "
            "check that TLE epoch is recent (should be within days of now)"
        )

    print(f"\nPropagation time (UTC): {now_utc.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print(
        f"TEME position (km):   "
        f"x={r_teme_km[0]:+.3f}  y={r_teme_km[1]:+.3f}  z={r_teme_km[2]:+.3f}"
    )
    print(
        f"TEME velocity (km/s): "
        f"vx={v_teme_km_s[0]:+.6f}  vy={v_teme_km_s[1]:+.6f}  vz={v_teme_km_s[2]:+.6f}"
    )

    # Sanity check: ISS altitude should be ~400–430 km above Earth's surface.
    # Earth's mean radius ≈ 6371 km.
    r_mag_km = math.sqrt(sum(x**2 for x in r_teme_km))
    altitude_km = r_mag_km - 6371.0
    print(f"\nSanity check:")
    print(f"  |r| (km):          {r_mag_km:.3f}")
    print(f"  Altitude est (km): {altitude_km:.1f}  (expected ~400–430 km for ISS)")

    if not (350 < altitude_km < 500):
        raise RuntimeError(
            f"ISS altitude {altitude_km:.1f} km is outside expected range 350–500 km — "
            "check TLE freshness or propagation logic"
        )

    print("\nSMOKE TEST PASSED -- toolchain works end-to-end.")


def main() -> None:
    name, line1, line2 = fetch_iss_tle()
    propagate_to_now(name, line1, line2)


if __name__ == "__main__":
    main()
