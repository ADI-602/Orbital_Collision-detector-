"""
Screening in a worker process.

The monitor runs each pass in a separate process so a pass cannot starve API
requests of the GIL (measured: /health went from ~5 ms to seconds during a
pass over the live 700-object set, and AI advise calls timed out). Pinned here:
the process path produces the same result as the in-thread path — moving the
computation must not change a single number.
"""

import json
import pathlib
from types import SimpleNamespace

import pytest

from backend.api.monitoring import ScreeningMonitor, compute_pass

OFFLINE = pathlib.Path(__file__).resolve().parent.parent / "backend" / "data" / "offline_tracked_set.json"


def _element_sets(n):
    lines = json.loads(OFFLINE.read_text(encoding="utf-8"))["tle_text"].splitlines()
    out = []
    for i in range(0, min(len(lines), 3 * n), 3):
        name, l1, l2 = lines[i], lines[i + 1], lines[i + 2]
        out.append(SimpleNamespace(object_id=l1[2:7].strip(), name=name, line1=l1, line2=l2))
    return out


class FakeTracked:
    def __init__(self, objects):
        self._snap = SimpleNamespace(count=len(objects), objects=objects, error=None)

    def load(self):
        return self._snap


def _monitor(objects, use_process):
    return ScreeningMonitor(
        FakeTracked(objects), window_hours=2.0, max_refine_pairs=20, use_process=use_process,
    )


def test_process_pass_matches_thread_pass():
    objects = _element_sets(40)

    in_thread = _monitor(objects, use_process=False)
    in_thread._run_once()

    in_process = _monitor(objects, use_process=True)
    try:
        in_process._run_once()
    finally:
        in_process.stop()

    a, b = in_thread.current, in_process.current
    assert a.state == b.state == "ready"
    assert a.stats["pairs_evaluated"] == b.stats["pairs_evaluated"]
    assert len(a.events) == len(b.events)
    for x, y in zip(a.events, b.events):
        assert (x["primary_id"], x["secondary_id"]) == (y["primary_id"], y["secondary_id"])
        assert x.get("miss_distance_m") == pytest.approx(y.get("miss_distance_m"), rel=1e-6, abs=1e-3)
        assert x.get("pc") == pytest.approx(y.get("pc"), rel=1e-6, abs=1e-15)


def test_compute_pass_attaches_tracked_ids():
    objects = _element_sets(40)
    events, stats, window_start = compute_pass(
        [(o.object_id, o.name, o.line1, o.line2) for o in objects], 2.0, 60.0, 5.0, 20,
    )
    ids = {o.object_id for o in objects}
    for e in events:
        assert e["primary_id"] in ids and e["secondary_id"] in ids
    assert window_start.endswith("Z")
    assert stats["pairs_evaluated"] == 40 * 39 // 2
