"""
tracked_set.py — the set of objects the console tracks and screens.

ONE SET, SERVER-SIDE, ON PURPOSE. The browser used to fetch TLEs from
CelesTrak itself, purely to draw markers. That was fine while screening was
something the user triggered per-object, and it stops being fine here for two
reasons:

  1. Continuous monitoring runs without a browser open, so the screening set
     cannot live in a page.
  2. If the server screened one fetch and the browser drew another, an event
     could name objects that are not on the globe — and selecting it would
     highlight nothing. The console's whole premise is that the event list and
     the globe describe the same objects.

So the server owns the set, screens it, and hands the same element sets to the
frontend for rendering. The browser keeps propagating them locally with
satellite.js for smooth animation; it just no longer chooses *which* objects
exist.

SOURCE HONESTY carries over from the frontend hook this replaces. The set can
come from a live fetch, a cached one, or a bundled snapshot, and callers are
told which — rendering cached data as live is the same class of dishonesty as
fabricating a number.
"""

import json
import logging
import pathlib
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from skyfield.api import EarthSatellite

from backend.api.spacetrack import SpaceTrackClient, SpaceTrackError
from backend.physics.tle_ingest import InvalidTLEError, parse_tle_pair

logger = logging.getLogger(__name__)

_CELESTRAK_GROUP_URL = (
    "https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle"
)

# CelesTrak asks not to be polled hard, and a demo reloads a lot.
_CACHE_TTL_S = 6 * 3600

# Per-group fetch timeout. This is multiplied by the number of tracked groups
# on a cold start, and the frontend gives up on /api/tracking/objects after
# 30 s (frontend/src/api/tracking.js). Two groups at 20 s exceeded that, so an
# unreachable CelesTrak timed the BROWSER out before the server could answer
# and the console fell back to its bundled snapshot. Keep
# `len(groups) * _FETCH_TIMEOUT_S` comfortably under the client timeout.
_FETCH_TIMEOUT_S = 8

# How long to stop re-attempting after a failed fetch.
#
# Without this, a failure is self-perpetuating: a failed load leaves the
# snapshot marked "cached"/"none", the freshness check below only short-circuits
# on "live", and so EVERY subsequent call re-ran the full multi-group fetch —
# turning an unreachable CelesTrak into a permanently slow endpoint.
_FAIL_BACKOFF_S = 60

# Total wall-clock budget for one cold load, across ALL groups.
#
# A per-group timeout alone does not bound the request: it multiplies by the
# number of groups, so adding a third tracked group would silently push the
# cold-start worst case back over the browser's timeout. The budget is what
# actually holds the guarantee; the per-group timeout just caps any one host.
_TOTAL_FETCH_BUDGET_S = 20

# Committed offline fallback: real element sets the server can screen with no
# network at all. Deliberately checked in — CelesTrak is a third party we do not
# control, and a live demo is the worst possible time to discover it is blocked,
# rate-limited or behind venue wifi. Regenerate with
# `python scripts/refresh_tracked_set.py`.
#
# This is a SOURCE OF LAST RESORT. It is only consulted when there is nothing in
# memory, and the snapshot it produces is labelled `bundled`, never `live` or
# `cached`, and carries the capture epoch so the UI can state how stale it is.
_OFFLINE_SET_PATH = (
    pathlib.Path(__file__).resolve().parent.parent / "data" / "offline_tracked_set.json"
)


@dataclass(frozen=True)
class TrackedObject:
    """One catalogued object, with the element set it was built from."""

    object_id: str
    name: str
    norad_id: str
    line1: str
    line2: str
    satellite: EarthSatellite = field(repr=False)

    def as_wire(self) -> Dict[str, str]:
        """The shape the frontend needs to render and re-propagate this object."""
        return {
            "id": self.object_id,
            "name": self.name,
            "norad_id": self.norad_id,
            "line1": self.line1,
            "line2": self.line2,
        }


@dataclass(frozen=True)
class TrackedSetSnapshot:
    """An immutable view of the set, swapped in whole so readers never tear."""

    objects: List[TrackedObject]
    groups: List[str]
    source: str            # "live" | "cached" | "bundled" | "none"
    fetched_at: float
    rejected: List[Dict[str, str]]
    error: Optional[str] = None
    # Who actually served the element sets: "celestrak", "space-track", or for
    # a bundled snapshot whoever the offline file was captured from. Reported
    # alongside `source` so "live" never hides WHICH live feed it was.
    providers: Tuple[str, ...] = ()

    @property
    def count(self) -> int:
        return len(self.objects)


def _parse_tle_text(text: str, group: str) -> tuple[List[TrackedObject], List[Dict[str, str]]]:
    """
    Turn CelesTrak's 3-line format into tracked objects.

    A rejected element set is COLLECTED, not skipped silently. parse_tle_pair
    raises on a malformed TLE rather than handing back a phantom object at
    catalogue number 0, and the caller needs to be able to say how many objects
    did not make it — "we track 580 of 584" is a fact, "we track 580" when 584
    were offered is a quiet lie about coverage.
    """
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    objects: List[TrackedObject] = []
    rejected: List[Dict[str, str]] = []

    # CelesTrak's 3-line format: name, line 1, line 2. A trailing partial
    # block is dropped rather than guessed at.
    i = 0
    while i + 2 < len(lines):
        name = lines[i].strip()
        line1, line2 = lines[i + 1], lines[i + 2]
        i += 3

        if not line1.startswith("1 ") or not line2.startswith("2 "):
            rejected.append({"name": name, "reason": "not a 3-line TLE block"})
            continue

        try:
            sat = parse_tle_pair(line1, line2, name)
        except InvalidTLEError as exc:
            rejected.append({"name": name, "reason": str(exc)})
            continue

        norad = str(sat.model.satnum)
        objects.append(
            TrackedObject(
                object_id=norad,
                name=name,
                norad_id=norad,
                line1=line1,
                line2=line2,
                satellite=sat,
            )
        )

    if rejected:
        logger.warning(
            "tracked_set: %s — %d of %d element sets rejected",
            group, len(rejected), len(objects) + len(rejected),
        )
    return objects, rejected


class TrackedSet:
    """
    Fetches and holds the catalogue the console tracks.

    Thread-safe by whole-snapshot replacement: readers take the current
    snapshot reference and never see a half-updated set.
    """

    def __init__(self, groups: List[str], spacetrack: Optional[SpaceTrackClient] = None):
        self._groups = list(groups)
        # Second live source, used for any group CelesTrak cannot serve.
        self._spacetrack = spacetrack if spacetrack is not None else SpaceTrackClient()
        self._lock = threading.Lock()
        self._raw_by_group: Dict[str, str] = {}
        self._provider_by_group: Dict[str, str] = {}
        self._failed_at: Optional[float] = None
        self._bundled_cache: Optional[
            Tuple[List[TrackedObject], List[Dict[str, str]], float, List[str]]
        ] = None
        self._bundled_providers: Tuple[str, ...] = ()

        # Put the floor in place BEFORE the first request, not after the first
        # failure. A cold start with the live feed blocked otherwise leaves a
        # window (as long as the whole fetch budget) where the server has no
        # objects at all, which pushes the browser onto its own snapshot — a
        # DIFFERENT set from the one the server screens, and the one state where
        # the globe and the event list genuinely disagree. Reading a local file
        # is instant, so there is no reason to serve nothing in the meantime.
        bundled, bundled_rejected, captured_at, bundled_groups = self._load_bundled()
        if bundled:
            self._snapshot = TrackedSetSnapshot(
                objects=bundled,
                groups=bundled_groups or list(groups),
                source="bundled",
                fetched_at=captured_at,
                rejected=bundled_rejected,
                error="offline set; live feed not yet fetched",
                providers=self._bundled_providers,
            )
        else:
            self._snapshot = TrackedSetSnapshot(
                objects=[], groups=list(groups), source="none", fetched_at=0.0,
                rejected=[], error="not loaded yet",
            )

    @property
    def snapshot(self) -> TrackedSetSnapshot:
        return self._snapshot

    def load_for_request(self) -> TrackedSetSnapshot:
        """
        The read path for an HTTP handler. Serves what we have; never waits on
        a third-party fetch it does not have to make.

        A request thread must not block on CelesTrak. Two things went wrong when
        it did: a cold fetch could outlast the browser's own timeout, and a
        request arriving mid-refresh queued behind the monitor's fetch and paid
        for it twice over.

        Refreshing is the monitor thread's job (backend/api/monitoring.py) — it
        already calls load() on a timer. This only falls through to a fetch on a
        genuinely cold start with nothing cached and nobody else already
        fetching, which is the one case where returning an empty set would be
        indistinguishable from "nothing is up there".
        """
        snap = self._snapshot
        if snap.objects:
            return snap
        if self._lock.locked():
            # Someone is already fetching. Report what we have rather than
            # joining the queue; the caller retries.
            return snap
        return self.load()

    def _fetch_group(self, group: str, timeout_s: float = _FETCH_TIMEOUT_S) -> str:
        url = _CELESTRAK_GROUP_URL.format(group=group)
        req = urllib.request.Request(
            url, headers={"User-Agent": "OrbitalRiskAdvisor/1.0"},
        )
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return resp.read().decode("utf-8")

    def _load_bundled(self) -> Tuple[List[TrackedObject], List[Dict[str, str]], float, List[str]]:
        """
        Read the committed offline set. Never raises.

        Returns (objects, rejected, captured_at_unix, groups). An empty object
        list means the file is missing or unusable — which is a valid state, not
        an error: the fallback is optional and its absence simply leaves the set
        empty, exactly as before it existed.

        The capture epoch is read from the file and reported as `fetched_at`.
        Stamping this with time.time() would date decades-old elements as though
        they had just been fetched, which is the same class of dishonesty as
        labelling cached data live.
        """
        if self._bundled_cache is not None:
            return self._bundled_cache

        empty: Tuple[List[TrackedObject], List[Dict[str, str]], float, List[str]] = (
            [], [], 0.0, [],
        )
        try:
            raw = json.loads(_OFFLINE_SET_PATH.read_text(encoding="utf-8"))
            text = raw.get("tle_text") or ""
            captured = raw.get("captured_utc")
            groups = list(raw.get("groups") or [])
            provider = raw.get("provider")
            self._bundled_providers = (f"offline:{provider}",) if provider else ("offline",)
        except (OSError, ValueError) as exc:
            logger.warning("tracked_set: offline fallback unavailable: %s", exc)
            self._bundled_cache = empty
            return empty

        objects, rejected = _parse_tle_text(text, "offline-snapshot")
        if not objects:
            logger.warning("tracked_set: offline fallback held no usable element sets")
            self._bundled_cache = empty
            return empty

        try:
            captured_at = datetime.fromisoformat(
                str(captured).replace("Z", "+00:00")
            ).timestamp()
        except (TypeError, ValueError):
            # An unreadable epoch must not become "just now".
            captured_at = 0.0

        logger.info(
            "tracked_set: offline fallback holds %d objects captured %s",
            len(objects), captured,
        )
        self._bundled_cache = (objects, rejected, captured_at, groups)
        return self._bundled_cache

    def load(self, force_refresh: bool = False) -> TrackedSetSnapshot:
        """
        Populate the set from CelesTrak, then Space-Track for any group
        CelesTrak cannot serve, then replay the last successful fetch.

        A failed fetch NEVER empties an existing set. An empty globe is
        indistinguishable from "nothing is up there", so the previous snapshot
        is kept and marked with the reason it is stale.
        """
        with self._lock:
            fresh = (
                not force_refresh
                and self._snapshot.source == "live"
                and (time.time() - self._snapshot.fetched_at) < _CACHE_TTL_S
            )
            if fresh:
                return self._snapshot

            # A recent failure means the network is down, not that this call
            # will fare better. Return immediately instead of re-paying the
            # full fetch timeout on every request.
            if (
                not force_refresh
                and self._failed_at is not None
                and (time.time() - self._failed_at) < _FAIL_BACKOFF_S
            ):
                return self._snapshot

            objects: List[TrackedObject] = []
            rejected: List[Dict[str, str]] = []
            errors: List[str] = []
            seen: set[str] = set()

            deadline = time.time() + _TOTAL_FETCH_BUDGET_S
            replayed_from_cache = False

            texts: Dict[str, str] = {}
            providers: Dict[str, str] = {}
            missing: List[str] = []
            # A CelesTrak failure is only worth reporting if no other source
            # covered that group; otherwise a healthy live set reads as broken.
            celestrak_errors: Dict[str, str] = {}

            # 1. CelesTrak, per group, within the wall-clock budget.
            for group in self._groups:
                remaining = deadline - time.time()
                try:
                    if remaining <= 0:
                        raise TimeoutError(
                            f"fetch budget of {_TOTAL_FETCH_BUDGET_S}s exhausted"
                        )
                    texts[group] = self._fetch_group(group, min(_FETCH_TIMEOUT_S, remaining))
                    providers[group] = "celestrak"
                except (urllib.error.URLError, TimeoutError, OSError) as exc:
                    logger.warning("tracked_set: %s via CelesTrak failed: %s", group, exc)
                    celestrak_errors[group] = f"{group}: CelesTrak: {exc}"
                    missing.append(group)

            # 2. Space-Track for whatever CelesTrak could not serve, in ONE
            #    authenticated session (rate limits — see spacetrack.py).
            if missing:
                try:
                    fetched = self._spacetrack.fetch_groups(missing)
                except SpaceTrackError as exc:
                    logger.warning("tracked_set: Space-Track unavailable: %s", exc)
                    errors.append(f"Space-Track: {exc}")
                else:
                    for group, text in fetched.items():
                        texts[group] = text
                        providers[group] = "space-track"
                    missing = [g for g in missing if g not in fetched]
            errors.extend(celestrak_errors[g] for g in missing)

            # Only freshly fetched text becomes the new "last good" copy.
            for group, text in texts.items():
                self._raw_by_group[group] = text
                self._provider_by_group[group] = providers[group]

            # 3. The last good text for any group still missing.
            for group in missing:
                if group in self._raw_by_group:
                    logger.warning("tracked_set: %s replaying cached text", group)
                    texts[group] = self._raw_by_group[group]
                    providers[group] = self._provider_by_group.get(group, "unknown")
                    # Replayed bytes are not a live fetch, and the snapshot
                    # must not claim they are. Record WHY it is stale too —
                    # "cached" without a reason leaves the UI unable to say
                    # what went wrong.
                    replayed_from_cache = True
                    errors.append(f"{group}: replayed cached text")
                else:
                    logger.error("tracked_set: %s unavailable from every source", group)

            for group in self._groups:
                if group not in texts:
                    continue
                group_objects, group_rejected = _parse_tle_text(texts[group], group)
                rejected.extend(group_rejected)
                for obj in group_objects:
                    # The same object can appear in more than one group.
                    if obj.object_id in seen:
                        continue
                    seen.add(obj.object_id)
                    objects.append(obj)

            if not objects:
                self._failed_at = time.time()
                reason = "; ".join(errors) or "no usable element sets returned"

                # Priority below a live fetch: whatever this process already
                # holds, then the committed offline set, then nothing.
                stale = self._snapshot
                if stale.objects:
                    # Keep it; say why it is stale.
                    self._snapshot = TrackedSetSnapshot(
                        objects=stale.objects,
                        # The groups that describe the objects we are actually
                        # serving, NOT the ones we tried and failed to fetch.
                        # Reporting the configured groups here labelled a
                        # 4-object `stations` fallback as a debris cloud.
                        groups=list(stale.groups),
                        source="cached" if stale.source != "bundled" else "bundled",
                        fetched_at=stale.fetched_at,
                        rejected=stale.rejected,
                        error=reason,
                        providers=stale.providers,
                    )
                    return self._snapshot

                bundled, bundled_rejected, captured_at, bundled_groups = self._load_bundled()
                if bundled:
                    logger.warning(
                        "tracked_set: falling back to the committed offline set "
                        "(%d objects) because %s",
                        len(bundled), reason,
                    )
                    self._snapshot = TrackedSetSnapshot(
                        objects=bundled,
                        groups=bundled_groups or list(self._groups),
                        source="bundled",
                        fetched_at=captured_at,
                        rejected=bundled_rejected,
                        error=reason,
                        providers=self._bundled_providers,
                    )
                    return self._snapshot

                self._snapshot = TrackedSetSnapshot(
                    objects=[],
                    groups=list(self._groups),
                    source="none",
                    fetched_at=0.0,
                    rejected=[],
                    error=reason,
                )
                return self._snapshot

            self._failed_at = None if not replayed_from_cache else time.time()
            self._snapshot = TrackedSetSnapshot(
                objects=objects,
                groups=list(self._groups),
                source="cached" if replayed_from_cache else "live",
                fetched_at=time.time(),
                rejected=rejected,
                error="; ".join(errors) or None,
                providers=tuple(sorted(set(providers.values()))),
            )
            logger.info(
                "tracked_set: %d objects from %s via %s (%d rejected)",
                len(objects), ", ".join(self._groups),
                ", ".join(sorted(set(providers.values()))), len(rejected),
            )
            return self._snapshot
