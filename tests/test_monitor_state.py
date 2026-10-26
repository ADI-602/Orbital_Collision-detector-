"""
What the monitor reports while a screening pass is running.

The events served during a pass are the LAST COMPLETED pass's events, so the
timing served with them must be that pass's too. Before this was pinned, the
running state dropped `finished_at`, and the console — which reads a missing
`finished_at` as "nothing has completed yet" — told the audience no screening
had happened, directly above the previous pass's real detections.
"""

from types import SimpleNamespace

from backend.api import monitoring
from backend.api.monitoring import ScreeningMonitor


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
