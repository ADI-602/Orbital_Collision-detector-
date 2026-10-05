"""
Regenerate the server's committed offline tracked set.

The result is a file of real element sets the backend falls back to when both
live feeds are unavailable (`backend/api/tracked_set.py`). It is the difference
between a demo that survives a blocked IP or venue wifi and one that does not.

    python scripts/refresh_tracked_set.py                       # Space-Track
    python scripts/refresh_tracked_set.py --provider celestrak  # needs an unblocked IP
    python scripts/refresh_tracked_set.py --groups cosmos-2251-debris --limit 300

Space-Track (the default, since CelesTrak blocks this project's IP) reads
SPACETRACK_USERNAME / SPACETRACK_PASSWORD from .env and uses one login and one
query per group. Do not run it in a loop: the account is rate-limited.

WHAT THIS MAY AND MAY NOT DO

It seeds INPUTS, never outputs. It writes raw, unmodified TLEs exactly as
CelesTrak served them, and records where and when they came from. It must never
select objects because they produce a conjunction, and it does not look at
screening results at all — the subset it keeps is simply the first N of each
group. Curating a set to guarantee a red event would be seeding an OUTPUT, which
CLAUDE.md §5.2 forbids outright: the screening that runs on this data has to be
free to find nothing.

Consequently a smaller subset means FEWER detections, not more. If the event
list comes back thin, raise --limit rather than hand-picking objects.

WHY IT IS CAPPED

CLAUDE.md asks that large data dumps stay out of git. Screening is also O(N^2),
so the whole 1,500-object debris set costs far more per pass than it adds to a
demo. A few hundred objects is a real catalogue subset, a ~60 KB file, and a
pass that finishes in reasonable time.
"""

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

from backend.api.spacetrack import SpaceTrackClient, SpaceTrackError  # noqa: E402
from backend.physics.tle_ingest import InvalidTLEError, parse_tle_pair  # noqa: E402

CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle"
OUT_PATH = REPO_ROOT / "backend" / "data" / "offline_tracked_set.json"

# Keep in step with TRACKED_GROUPS in backend/api/main.py.
DEFAULT_GROUPS = ["stations", "cosmos-2251-debris", "iridium-33-debris"]
DEFAULT_LIMIT = 400
FETCH_TIMEOUT_S = 30


def fetch(group: str) -> str:
    req = urllib.request.Request(
        CELESTRAK_URL.format(group=group),
        headers={"User-Agent": "OrbitalRiskAdvisor/1.0"},
    )
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:
        return resp.read().decode("utf-8")


def blocks(text: str):
    """Yield (name, line1, line2) triples from CelesTrak's 3-line format."""
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    for i in range(0, len(lines) - 2, 3):
        yield lines[i].strip(), lines[i + 1], lines[i + 2]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--groups", nargs="+", default=DEFAULT_GROUPS)
    ap.add_argument(
        "--limit", type=int, default=DEFAULT_LIMIT,
        help="max objects to keep PER GROUP (0 = keep all)",
    )
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    ap.add_argument(
        "--provider", choices=["space-track", "celestrak"], default="space-track",
    )
    args = ap.parse_args()

    kept, seen, rejected = [], set(), []

    if args.provider == "space-track":
        load_dotenv(REPO_ROOT / ".env")
        print(f"fetching {', '.join(args.groups)} from Space-Track (one session) ...", flush=True)
        try:
            texts = SpaceTrackClient().fetch_groups(args.groups)
        except SpaceTrackError as exc:
            print(f"  FAILED: {exc}", file=sys.stderr)
            return 1
        missing = [g for g in args.groups if g not in texts]
        if missing:
            print(f"  no data for: {', '.join(missing)}", file=sys.stderr)
            return 1
    else:
        texts = {}

    for group in args.groups:
        if args.provider == "space-track":
            text = texts[group]
        else:
            print(f"fetching {group} ...", flush=True)
            try:
                text = fetch(group)
            except Exception as exc:
                print(f"  FAILED: {exc}", file=sys.stderr)
                print(
                    "  (if this times out with no HTTP status, the IP is likely "
                    "blocked rather than rate-limited — try another network)",
                    file=sys.stderr,
                )
                return 1

        group_kept = 0
        for name, line1, line2 in blocks(text):
            if args.limit and group_kept >= args.limit:
                break
            # Validate through the same parser the pipeline uses, so a bad
            # element set is caught here rather than at screening time.
            try:
                sat = parse_tle_pair(line1, line2, name)
            except InvalidTLEError as exc:
                rejected.append({"name": name, "reason": str(exc)})
                continue

            norad = str(sat.model.satnum)
            if norad in seen:
                continue
            seen.add(norad)
            kept.append((name, line1, line2))
            group_kept += 1

        print(f"  {group}: kept {group_kept} object(s)")

    if not kept:
        print("nothing usable fetched; refusing to write", file=sys.stderr)
        return 1

    payload = {
        "_comment": [
            "Offline fallback for the server's tracked set. REAL, UNMODIFIED TLEs",
            f"as served by {args.provider} at the capture time below.",
            "Regenerate with: python scripts/refresh_tracked_set.py",
            "Objects are the first N of each group -- an arbitrary subset, NOT",
            "chosen for producing conjunctions. Screening on this data is free",
            "to find nothing.",
        ],
        "captured_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "captured_at_unix": time.time(),
        "provider": args.provider,
        "groups": list(args.groups),
        "object_count": len(kept),
        "rejected": rejected,
        "tle_text": "\n".join(f"{n}\n{a}\n{b}" for n, a, b in kept),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    size_kb = args.out.stat().st_size / 1024
    print(f"\nwrote {len(kept)} objects to {args.out} ({size_kb:.0f} KB)")
    if rejected:
        print(f"{len(rejected)} element set(s) rejected and left out")
    if size_kb > 500:
        print("WARNING: this file is large for git; consider a lower --limit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
