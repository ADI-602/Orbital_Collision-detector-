"""
What the monitor reports while a pass runs, and across a restart.

The events served during a pass are the LAST COMPLETED pass's events, so the
timing served with them must be that pass's too. Before this was pinned, the
running state dropped `finished_at`, and the console — which reads a missing
`finished_at` as "nothing has completed yet" — told the audience no screening
had happened, directly above the previous pass's real detections.

Across a restart the last completed pass is served again, marked restored,
with every figure and its own timing unchanged — and never once its screening
window has ended, because then every encounter in it is in the past.
"""

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from backend.api import monitoring
from backend.api.monitoring import PERSIST_VERSION, ScreeningMonitor, ScreeningRun, load_run, save_run


class FakeTracked:
    """Two placeholder objects; compute_pass is replaced, so they are never propagated."""

    def __init__(self):
        objects = [
            SimpleNamespace(object_id=str(i), name=f"OBJ {i}", line1="", line2="") for i in (1, 2)
        ]
        self._snap = SimpleNamespace(count=len(objects), objects=objects, error=None)

    def load(self):
        return self._snap


def test_running_state_keeps_the_last_completed_pass_timing(monkeypatch):
    monitor = ScreeningMonitor(FakeTracked(), window_hours=24.0, use_process=False)
    seen_while_running = []
    event = {"primary_name": "A", "secondary_name": "B", "threat_level": "GREEN", "pc": 1e-9}

    def fake_compute_pass(*_args):
        seen_while_running.append(monitor.current)
        return [dict(event)], {"pairs_evaluated": 1}, "2026-10-26T00:00:00Z"

    monkeypatch.setattr(monitoring, "compute_pass", fake_compute_pass)

    monitor._run_once()
    first = monitor.current
    assert first.state == "ready" and first.finished_at is not None

    monitor._run_once()
    running = seen_while_running[1]
    assert running.state == "running"
    assert running.finished_at == first.finished_at
    assert running.duration_s == first.duration_s
    assert running.window_start_utc_iso == first.window_start_utc_iso
    assert running.window_hours == first.window_hours
    assert running.events == first.events


def test_first_pass_reports_no_completion_while_running(monkeypatch):
    monitor = ScreeningMonitor(FakeTracked(), use_process=False)
    seen_while_running = []

    def fake_compute_pass(*_args):
        seen_while_running.append(monitor.current)
        return [], {"pairs_evaluated": 1}, "2026-10-26T00:00:00Z"

    monkeypatch.setattr(monitoring, "compute_pass", fake_compute_pass)
    monitor._run_once()

    running = seen_while_running[0]
    assert running.state == "running"
    assert running.finished_at is None
    assert running.events == []


# ---------------------------------------------------------------------------
# Surviving a restart
# ---------------------------------------------------------------------------

RED_EVENT = {
    "primary_name": "COSMOS 2251 DEB", "secondary_name": "COSMOS 2251 DEB",
    "primary_id": "33760", "secondary_id": "33932",
    "tca_utc_iso": "2026-10-26T23:01:11Z", "miss_distance_m": 103.9,
    "pc": 7.86e-4, "relative_speed_km_s": 3.85, "threat_level": "RED",
}


def _completed_run(window_start: datetime, hours: float = 24.0) -> ScreeningRun:
    return ScreeningRun(
        state="ready",
        started_at=1000.0,
        finished_at=1600.0,
        duration_s=600.0,
        window_start_utc_iso=window_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        window_hours=hours,
        events=[dict(RED_EVENT)],
        stats={"pairs_evaluated": 241165, "truncated": True},
        objects_tracked=710,
    )


def _now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0)


def test_saved_pass_comes_back_unchanged_and_marked_restored(tmp_path):
    path = str(tmp_path / "pass.json")
    run = _completed_run(_now_utc() - timedelta(hours=1))
    assert save_run(path, run) is True

    restored = load_run(path)
    assert restored is not None
    assert restored.restored is True
    assert restored.state == "ready"
    # Every figure exactly as computed, and the pass's own timing — not "now".
    assert restored.events == run.events
    assert restored.finished_at == run.finished_at
    assert restored.stats == run.stats
    assert restored.window_start_utc_iso == run.window_start_utc_iso


def test_a_pass_whose_window_has_ended_is_not_restored(tmp_path):
    path = str(tmp_path / "pass.json")
    save_run(path, _completed_run(_now_utc() - timedelta(hours=25), hours=24.0))
    assert load_run(path) is None


def test_only_completed_passes_are_saved(tmp_path):
    path = tmp_path / "pass.json"
    for state in ("never_run", "running", "failed"):
        assert save_run(str(path), ScreeningRun(state=state)) is False
    assert not path.exists()


def test_unreadable_or_foreign_files_are_ignored(tmp_path):
    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{ not json", encoding="utf-8")
    assert load_run(str(corrupt)) is None

    foreign = tmp_path / "foreign.json"
    run = monitoring.asdict(_completed_run(_now_utc()))
    foreign.write_text(json.dumps({"version": PERSIST_VERSION + 1, "run": run}), encoding="utf-8")
    assert load_run(str(foreign)) is None

    assert load_run(str(tmp_path / "missing.json")) is None


def test_monitor_serves_the_saved_pass_then_replaces_it(tmp_path, monkeypatch):
    path = str(tmp_path / "pass.json")
    save_run(path, _completed_run(_now_utc() - timedelta(hours=1)))

    monitor = ScreeningMonitor(FakeTracked(), use_process=False, persist_path=path)
    assert monitor._restore_saved_run() is True
    assert monitor.current.restored is True
    assert monitor.current.events[0]["pc"] == RED_EVENT["pc"]
    # Reported before the restart: the drain-on-read alert queue stays empty.
    monitor._record_new_high_risk(monitor.current.events)
    assert monitor.take_new_high_risk() == []

    fresh = {**RED_EVENT, "tca_utc_iso": "2026-10-27T01:00:00Z", "pc": 2e-4}
    monkeypatch.setattr(
        monitoring, "compute_pass",
        lambda *_a: ([fresh], {"pairs_evaluated": 1}, _now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")),
    )
    monitor._run_once()
    assert monitor.current.restored is False
    assert monitor.current.events == [fresh]
    # And the fresh pass is what is on disk now.
    assert load_run(path).events == [fresh]


def test_restore_never_overrides_a_pass_this_process_already_has(tmp_path, monkeypatch):
    path = str(tmp_path / "pass.json")
    save_run(path, _completed_run(_now_utc() - timedelta(hours=1)))
    monitor = ScreeningMonitor(FakeTracked(), use_process=False, persist_path=path)
    monkeypatch.setattr(
        monitoring, "compute_pass",
        lambda *_a: ([], {"pairs_evaluated": 1}, _now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")),
    )
    monitor._run_once()
    assert monitor._restore_saved_run() is False
    assert monitor.current.events == []
