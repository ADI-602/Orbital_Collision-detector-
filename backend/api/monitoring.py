"""
monitoring.py — continuous conjunction screening on a timer.

WHY THIS IS A BACKGROUND JOB AND NOT A REQUEST HANDLER. All-pairs screening
over a few hundred objects evaluates a quarter of a million pairs. The
vectorised gate handles that in seconds, but every pair it cannot rule out
still needs the validated de-aliasing refinement, and a full pass measured at
roughly 1.6 hours. No amount of tuning turns that into a click: the cost is
inherent to resolving a 5 km encounter at 15 km/s on a sampled grid.

That is also how real conjunction assessment works. Operators do not press a
button and wait; screenings run on a schedule and results are published. So
this runs the physics on a timer and serves the last completed pass instantly,
which makes the UI feel immediate while the numbers stay entirely real.

============================== THE AI DOES NOT RUN THIS ======================
This module is physics only. No LLM is called from here, and nothing in this
tree consults one. The AI layer is handed completed results afterwards and
explains them.

The distinction is not cosmetic. The project's claim is "real physics computes
the risk, AI makes it understandable", and describing scheduled screening as
"AI monitoring" would invert exactly that. Do not name this feature after the
AI in code, in the API, or in the UI.
=============================================================================

WHAT A CONSUMER IS PROMISED. Results are served from a snapshot that is
replaced whole, so a reader never sees half a pass. Every snapshot carries the
stats of the run that produced it — including whether refinement was truncated
— because a partial screening is a different claim from a complete one and the
UI has to be able to say which it got.
"""

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from skyfield.api import load

from backend.api.assessment import assess_conjunction
from backend.api.tracked_set import TrackedSet
from backend.physics.screening import screen_all_pairs

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScreeningRun:
    """One completed (or failed) screening pass. Replaced whole, never edited."""

    state: str                      # "never_run" | "running" | "ready" | "failed"
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    duration_s: Optional[float] = None
    window_start_utc_iso: Optional[str] = None
    window_hours: Optional[float] = None
    events: List[Dict[str, Any]] = field(default_factory=list)
    stats: Dict[str, Any] = field(default_factory=dict)
    objects_tracked: int = 0
    error: Optional[str] = None

    @property
    def high_risk_count(self) -> int:
        return sum(1 for e in self.events if e.get("threat_level") == "RED")


class ScreeningMonitor:
    """
    Runs all-pairs screening over the tracked set, repeatedly, in the background.

    One worker thread. Screening is CPU-bound numpy and SGP4, so it must not
    run on the event loop — a request arriving mid-pass would otherwise wait
    for the whole pass.
    """

    def __init__(
        self,
        tracked_set: TrackedSet,
        interval_s: float = 900.0,
        window_hours: float = 24.0,
        threshold_km: float = 5.0,
        timestep_s: float = 60.0,
        max_refine_pairs: Optional[int] = 300,
    ):
        self._tracked = tracked_set
        self._interval_s = interval_s
        self._window_hours = window_hours
        self._threshold_km = threshold_km
        self._timestep_s = timestep_s
        self._max_refine_pairs = max_refine_pairs

        self._run = ScreeningRun(state="never_run")
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._run_lock = threading.Lock()

        # Keys of events already reported as high risk, so an alert fires once
        # per event rather than on every pass that still sees it.
        self._alerted: set[str] = set()
        self._new_high_risk: List[Dict[str, Any]] = []

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="screening-monitor", daemon=True,
        )
        self._thread.start()
        logger.info(
            "monitoring: started, every %.0f s over a %.0f h window",
            self._interval_s, self._window_hours,
        )

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=5.0)

    def trigger(self) -> None:
        """Ask for a pass now. Returns immediately; never blocks the caller."""
        self._wake.set()

    # -- state -------------------------------------------------------------

    @property
    def current(self) -> ScreeningRun:
        return self._run

    def take_new_high_risk(self) -> List[Dict[str, Any]]:
        """
        High-risk events first seen since the last call, then forget them.

        Drained rather than accumulated so a client that polls gets each alert
        once. A client that never polls does not build an unbounded backlog:
        the events themselves remain in the current run either way.
        """
        with self._run_lock:
            pending, self._new_high_risk = self._new_high_risk, []
            return pending

    # -- the work ----------------------------------------------------------

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._run_once()
            except Exception as exc:
                # A monitor thread that dies stops all screening silently,
                # which is worse than any single failed pass.
                logger.exception("monitoring: pass failed: %s", exc)
                self._run = ScreeningRun(
                    state="failed",
                    finished_at=time.time(),
                    error=str(exc),
                    events=self._run.events,
                    stats=self._run.stats,
                    objects_tracked=self._run.objects_tracked,
                )

            self._wake.wait(timeout=self._interval_s)
            self._wake.clear()

    def _run_once(self) -> None:
        started = time.time()
        snapshot = self._tracked.load()

        self._run = ScreeningRun(
            state="running",
            started_at=started,
            events=self._run.events,
            stats=self._run.stats,
            objects_tracked=snapshot.count,
        )

        if snapshot.count < 2:
            self._run = ScreeningRun(
                state="failed",
                started_at=started,
                finished_at=time.time(),
                objects_tracked=snapshot.count,
                error=snapshot.error or "fewer than two objects in the tracked set",
            )
            return

        ts = load.timescale()
        start_time = ts.now()
        end_time = ts.tt_jd(start_time.tt + self._window_hours / 24.0)

        candidates, stats = screen_all_pairs(
            [o.satellite for o in snapshot.objects],
            start_time,
            end_time,
            timestep_s=self._timestep_s,
            threshold_km=self._threshold_km,
            max_refine_pairs=self._max_refine_pairs,
        )

        by_norad = {}
        for obj in snapshot.objects:
            by_norad.setdefault(str(obj.satellite.model.satnum), obj)

        events: List[Dict[str, Any]] = []
        for candidate in candidates:
            record = assess_conjunction(candidate, ts)
            if record is None:
                continue
            # Attach the tracked-set ids so the globe can find both markers.
            primary = by_norad.get(str(candidate.primary.model.satnum))
            secondary = by_norad.get(str(candidate.secondary.model.satnum))
            record["primary_id"] = primary.object_id if primary else None
            record["secondary_id"] = secondary.object_id if secondary else None
            events.append(record)

        events.sort(key=_event_sort_key, reverse=True)

        finished = time.time()
        self._run = ScreeningRun(
            state="ready",
            started_at=started,
            finished_at=finished,
            duration_s=finished - started,
            window_start_utc_iso=start_time.utc_strftime("%Y-%m-%dT%H:%M:%SZ"),
            window_hours=self._window_hours,
            events=events,
            stats=stats,
            objects_tracked=snapshot.count,
            error=None,
        )
        self._record_new_high_risk(events)

        logger.info(
            "monitoring: pass complete in %.1fs — %d event(s), %d high risk",
            finished - started, len(events), self._run.high_risk_count,
        )

    def _record_new_high_risk(self, events: List[Dict[str, Any]]) -> None:
        """Queue an alert for each high-risk event not already reported."""
        with self._run_lock:
            for event in events:
                if event.get("threat_level") != "RED":
                    continue
                key = _event_key(event)
                if key in self._alerted:
                    continue
                self._alerted.add(key)
                self._new_high_risk.append(event)


def _event_key(event: Dict[str, Any]) -> str:
    return "|".join([
        str(event.get("primary_id") or event.get("primary_name")),
        str(event.get("secondary_id") or event.get("secondary_name")),
        str(event.get("tca_utc_iso")),
    ])


_THREAT_RANK = {"RED": 3, "YELLOW": 2, "GREEN": 1}


def _event_sort_key(event: Dict[str, Any]):
    """
    Ranking key, sorted DESCENDING so the most urgent event is first.

    Assessed events outrank refused ones, then threat band, then Pc. The
    screening stage sorts by minimum separation, which is not risk order — a
    fast, well-separated pass can carry a higher Pc than a slow close one.
    """
    if event.get("unassessable"):
        return (0, 0, 0.0)
    return (
        1,
        _THREAT_RANK.get(event.get("threat_level"), 0),
        event.get("pc") or 0.0,
    )
