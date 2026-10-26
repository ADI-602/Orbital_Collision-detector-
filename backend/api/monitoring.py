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

SURVIVING A RESTART. A completed pass is saved to disk, and on start the
monitor serves it again — marked `restored` — until a fresh pass replaces it,
instead of showing nothing for the minutes a new pass takes. Only while its
screening window is still open: a pass whose window has ended describes
encounters that are all in the past, and is discarded rather than served as
current. A corrupt or foreign file is ignored, never guessed at.
"""

import json
import logging
import multiprocessing
import os
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass, field, fields, replace
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from skyfield.api import load

from backend.api.assessment import assess_conjunction
from backend.api.tracked_set import TrackedSet
from backend.physics.screening import screen_all_pairs
from backend.physics.tle_ingest import parse_tle_pair

logger = logging.getLogger(__name__)


# (object_id, name, line1, line2) — plain strings, so it crosses a process
# boundary without pickling Skyfield objects.
ElementSet = Tuple[str, str, str, str]


def compute_pass(
    element_sets: List[ElementSet],
    window_hours: float,
    timestep_s: float,
    threshold_km: float,
    max_refine_pairs: Optional[int],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], str]:
    """
    One full screening pass: element sets in, ranked events and stats out.

    Top-level and free of shared state so it can run in a worker PROCESS. It
    is the same pipeline either way — screen_all_pairs, then assess_conjunction
    per candidate — only where it executes changes.

    Returns (events, stats, window_start_utc_iso).
    """
    by_norad: Dict[str, str] = {}
    satellites = []
    for object_id, name, line1, line2 in element_sets:
        sat = parse_tle_pair(line1, line2, name)
        by_norad.setdefault(str(sat.model.satnum), object_id)
        satellites.append(sat)

    ts = load.timescale()
    start_time = ts.now()
    end_time = ts.tt_jd(start_time.tt + window_hours / 24.0)

    candidates, stats = screen_all_pairs(
        satellites,
        start_time,
        end_time,
        timestep_s=timestep_s,
        threshold_km=threshold_km,
        max_refine_pairs=max_refine_pairs,
    )

    events: List[Dict[str, Any]] = []
    for candidate in candidates:
        record = assess_conjunction(candidate, ts)
        if record is None:
            continue
        # Attach the tracked-set ids so the globe can find both markers.
        record["primary_id"] = by_norad.get(str(candidate.primary.model.satnum))
        record["secondary_id"] = by_norad.get(str(candidate.secondary.model.satnum))
        events.append(record)

    events.sort(key=_event_sort_key, reverse=True)
    return events, stats, start_time.utc_strftime("%Y-%m-%dT%H:%M:%SZ")


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
    # True while the events are a pass saved before the last restart, until a
    # fresh pass completes. Their timing (finished_at) is that pass's own.
    restored: bool = False

    @property
    def high_risk_count(self) -> int:
        return sum(1 for e in self.events if e.get("threat_level") == "RED")


# Bumped whenever the saved shape changes; any other version is ignored.
PERSIST_VERSION = 1


def _window_end_unix(run: ScreeningRun) -> Optional[float]:
    """When a pass's screening window closes, or None if it cannot be read."""
    if not run.window_start_utc_iso or not run.window_hours:
        return None
    try:
        start = datetime.strptime(run.window_start_utc_iso, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None
    end = start.replace(tzinfo=timezone.utc) + timedelta(hours=float(run.window_hours))
    return end.timestamp()


def save_run(path: str, run: ScreeningRun) -> bool:
    """
    Write a completed pass to disk, atomically. Anything but a completed pass
    is not saved. Returns whether it wrote; a failure is logged, never raised —
    persistence is a convenience and must not fail a pass.
    """
    if run.state != "ready":
        return False
    payload = {
        "version": PERSIST_VERSION,
        "saved_at_unix": time.time(),
        "run": asdict(replace(run, restored=False)),
    }
    tmp = f"{path}.tmp"
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        os.replace(tmp, path)
        return True
    except OSError as exc:
        logger.warning("monitoring: could not save the last pass to %s: %s", path, exc)
        return False


def load_run(path: str, now_unix: Optional[float] = None) -> Optional[ScreeningRun]:
    """
    The saved pass, marked restored — or None if there is none, it cannot be
    read, it is from another version, or its screening window has ended.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        logger.warning("monitoring: ignoring unreadable saved pass %s: %s", path, exc)
        return None

    if not isinstance(payload, dict) or payload.get("version") != PERSIST_VERSION:
        logger.info("monitoring: ignoring saved pass %s from another version", path)
        return None
    data = payload.get("run")
    if not isinstance(data, dict) or data.get("state") != "ready":
        return None

    known = {f.name for f in fields(ScreeningRun)}
    try:
        run = ScreeningRun(**{k: v for k, v in data.items() if k in known})
    except TypeError as exc:
        logger.warning("monitoring: ignoring malformed saved pass %s: %s", path, exc)
        return None

    end = _window_end_unix(run)
    now = time.time() if now_unix is None else now_unix
    if end is None or end <= now:
        logger.info("monitoring: saved pass %s has an ended window; not restoring it", path)
        return None
    return replace(run, restored=True)


class ScreeningMonitor:
    """
    Runs all-pairs screening over the tracked set, repeatedly, in the background.

    One scheduler thread. Screening is CPU-bound numpy and SGP4, so it must not
    run on the event loop — a request arriving mid-pass would otherwise wait
    for the whole pass.

    WHY `use_process`. A thread is not enough on its own. Much of a pass is
    pure-Python SGP4 holding the GIL, and measured against the live 700-object
    set, every API request crawled while a pass ran (/health went from ~5 ms to
    seconds; an AI advise call queued for over a minute and timed out). With
    `use_process=True` the computation runs in a separate worker process with
    its own GIL, and this thread only waits on it, so the API stays responsive
    throughout. The server enables it; tests leave it off so they can patch
    the pipeline in-process.
    """

    def __init__(
        self,
        tracked_set: TrackedSet,
        interval_s: float = 900.0,
        window_hours: float = 24.0,
        threshold_km: float = 5.0,
        timestep_s: float = 60.0,
        max_refine_pairs: Optional[int] = 300,
        use_process: bool = False,
        persist_path: Optional[str] = None,
    ):
        self._tracked = tracked_set
        # Where the last completed pass is saved, and restored from on start.
        self._persist_path = persist_path
        self._interval_s = interval_s
        self._window_hours = window_hours
        self._threshold_km = threshold_km
        self._timestep_s = timestep_s
        self._max_refine_pairs = max_refine_pairs
        self._use_process = use_process
        # One long-lived worker, so its imports (Skyfield, SGP4, SciPy) are
        # paid once rather than on every pass.
        self._executor: Optional[ProcessPoolExecutor] = None

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
        # Restored here rather than in __init__, so importing the app (as the
        # tests do) never picks up a pass saved on this machine.
        self._restore_saved_run()
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="screening-monitor", daemon=True,
        )
        self._thread.start()
        logger.info(
            "monitoring: started, every %.0f s over a %.0f h window",
            self._interval_s, self._window_hours,
        )

    def _restore_saved_run(self) -> bool:
        """Serve the saved pass until a fresh one completes. Returns whether it did."""
        if not self._persist_path or self._run.state != "never_run":
            return False
        restored = load_run(self._persist_path)
        if restored is None:
            return False
        self._run = restored
        # Already reported before the restart; not news now.
        with self._run_lock:
            self._alerted.update(
                _event_key(e) for e in restored.events if e.get("threat_level") == "RED"
            )
        logger.info(
            "monitoring: restored the saved pass (%d event(s)) until a fresh one completes",
            len(restored.events),
        )
        return True

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=5.0)
        executor, self._executor = self._executor, None
        if executor is not None:
            # Don't wait for an in-flight pass; its result is no longer wanted.
            executor.shutdown(wait=False, cancel_futures=True)

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
                    restored=self._run.restored,
                )

            self._wake.wait(timeout=self._interval_s)
            self._wake.clear()

    def _run_once(self) -> None:
        started = time.time()
        snapshot = self._tracked.load()

        # While this pass runs, the events served are still the last completed
        # pass's, so its timing goes with them. Dropping finished_at here made
        # a running pass look like "nothing has ever completed".
        previous = self._run
        self._run = ScreeningRun(
            state="running",
            started_at=started,
            finished_at=previous.finished_at,
            duration_s=previous.duration_s,
            window_start_utc_iso=previous.window_start_utc_iso,
            window_hours=previous.window_hours,
            events=previous.events,
            stats=previous.stats,
            objects_tracked=snapshot.count,
            restored=previous.restored,
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

        element_sets: List[ElementSet] = [
            (o.object_id, o.name, o.line1, o.line2) for o in snapshot.objects
        ]
        args = (
            element_sets,
            self._window_hours,
            self._timestep_s,
            self._threshold_km,
            self._max_refine_pairs,
        )
        if self._use_process:
            if self._executor is None:
                # spawn, explicitly: a forked child would inherit the API's
                # threads and locks in whatever state they were in.
                self._executor = ProcessPoolExecutor(
                    max_workers=1, mp_context=multiprocessing.get_context("spawn"),
                )
            events, stats, window_start_iso = self._executor.submit(compute_pass, *args).result()
        else:
            events, stats, window_start_iso = compute_pass(*args)

        finished = time.time()
        self._run = ScreeningRun(
            state="ready",
            started_at=started,
            finished_at=finished,
            duration_s=finished - started,
            window_start_utc_iso=window_start_iso,
            window_hours=self._window_hours,
            events=events,
            stats=stats,
            objects_tracked=snapshot.count,
            error=None,
        )
        self._record_new_high_risk(events)
        if self._persist_path:
            save_run(self._persist_path, self._run)

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
