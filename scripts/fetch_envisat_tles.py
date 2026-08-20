"""
fetch_envisat_tles.py — One-time utility to fetch historical TLEs from Space-Track.

Fetches TLEs for Envisat (NORAD 27386) and Zenith-2 fragment (NORAD 22437)
from Oct 15–23 2004 using Space-Track's gp_history API.

Output is formatted for direct paste into tests/fixtures/envisat_tles.py.

Credentials: reads SPACETRACK_USERNAME and SPACETRACK_PASSWORD from .env
(or environment variables).

Usage:
    cd <repo-root>
    backend\\.venv\\Scripts\\python.exe scripts/fetch_envisat_tles.py
"""

import os
import sys
from datetime import datetime

# Add project root to path for dotenv
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except ImportError:
    pass

from spacetrack import SpaceTrackClient
import spacetrack.operators as op


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ENVISAT_NORAD_ID = 27386
ZENITH2_NORAD_ID = 22437

# Fetch window: Oct 15 – Oct 23, 2004 (covers T-7d to T+1d around TCA)
START_DATE = datetime(2004, 10, 15)
END_DATE = datetime(2004, 10, 23)

# Prediction days we need TLEs closest to:
PREDICTION_DAYS = [
    datetime(2004, 10, 19),  # T-3d
    datetime(2004, 10, 20),  # T-2d
    datetime(2004, 10, 21),  # T-1d
    datetime(2004, 10, 22),  # T-0d (day of TCA)
]


def fetch_tles(norad_id: int, start: datetime, end: datetime) -> str:
    """Fetch TLEs from Space-Track and return raw TLE text."""
    username = os.environ.get("SPACETRACK_USERNAME")
    password = os.environ.get("SPACETRACK_PASSWORD")

    if not username or not password:
        print("ERROR: SPACETRACK_USERNAME and SPACETRACK_PASSWORD must be set.")
        print("Set them in .env or as environment variables.")
        sys.exit(1)

    st = SpaceTrackClient(identity=username, password=password)

    print(f"Fetching TLEs for NORAD {norad_id} from {start.date()} to {end.date()}...")

    data = st.gp_history(
        norad_cat_id=norad_id,
        epoch=op.inclusive_range(start, end),
        format="tle",
        orderby="epoch asc",
    )

    return data


def parse_tle_pairs(raw: str) -> list[tuple[str, str, str]]:
    """Parse raw TLE text into (epoch_str, line1, line2) triples."""
    lines = [ln.strip() for ln in raw.strip().splitlines() if ln.strip()]
    results = []

    i = 0
    while i + 1 < len(lines):
        line1 = lines[i]
        line2 = lines[i + 1]

        if line1.startswith("1 ") and line2.startswith("2 "):
            # Extract epoch from line 1: chars 18-32 (YYDDD.DDDDDDDD)
            epoch_str = line1[18:32].strip()
            results.append((epoch_str, line1, line2))
            i += 2
        else:
            i += 1

    return results


def find_closest_tle(
    tle_list: list[tuple[str, str, str]], target_date: datetime,
) -> tuple[str, str, str]:
    """Find the TLE with epoch closest to target_date."""
    from skyfield.api import load

    ts = load.timescale()
    target_jd = ts.utc(
        target_date.year, target_date.month, target_date.day
    ).whole

    best = None
    best_diff = float("inf")

    for epoch_str, line1, line2 in tle_list:
        # Parse epoch: YYDDD.DDDDDDDD
        yy = int(epoch_str[:2])
        year = 2000 + yy if yy < 57 else 1900 + yy
        doy_frac = float(epoch_str[2:])
        doy = int(doy_frac)
        frac = doy_frac - doy

        from datetime import timedelta
        epoch_date = datetime(year, 1, 1) + timedelta(days=doy - 1 + frac)
        epoch_jd = ts.utc(
            epoch_date.year, epoch_date.month, epoch_date.day,
            epoch_date.hour, epoch_date.minute, epoch_date.second
        ).whole

        diff = abs(epoch_jd - target_jd)
        if diff < best_diff:
            best_diff = diff
            best = (epoch_str, line1, line2)

    return best


def main():
    print("=" * 70)
    print("Fetching historical TLEs for Envisat/Zenith-2 Oct 2004 event")
    print("=" * 70)

    for name, norad_id in [("Envisat", ENVISAT_NORAD_ID),
                            ("Zenith-2 fragment", ZENITH2_NORAD_ID)]:
        print(f"\n--- {name} (NORAD {norad_id}) ---")

        raw = fetch_tles(norad_id, START_DATE, END_DATE)

        if not raw or not raw.strip():
            print(f"  WARNING: No TLE data returned for NORAD {norad_id}!")
            print(f"  The object may not have historical data in Space-Track.")
            continue

        tle_list = parse_tle_pairs(raw)
        print(f"  Found {len(tle_list)} TLEs in range.")

        # Print all TLEs
        print(f"\n  All TLEs:")
        for epoch_str, line1, line2 in tle_list:
            print(f"    epoch={epoch_str}")
            print(f"      {line1}")
            print(f"      {line2}")

        # Find closest to each prediction day
        print(f"\n  Closest TLEs for fixture file:")
        day_labels = ["oct_19", "oct_20", "oct_21", "oct_22"]
        for label, target in zip(day_labels, PREDICTION_DAYS):
            epoch_str, line1, line2 = find_closest_tle(tle_list, target)
            print(f'\n    "{label}": (')
            print(f'        "{line1}",')
            print(f'        "{line2}",')
            print(f'    ),  # epoch={epoch_str}')

    print("\n" + "=" * 70)
    print("Done. Paste the above into tests/fixtures/envisat_tles.py")
    print("=" * 70)


if __name__ == "__main__":
    main()
