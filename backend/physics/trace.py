"""
trace.py — per-stage tracing for the physics pipeline.

CLAUDE.md §1.5 asks that intermediate values be printed during development runs
so a bad number is traceable to a specific pipeline stage rather than only
being visible at the end. That guidance is right, and the traces it produced
have already earned their keep.

What changed is scale. Those traces were written when the pipeline handled one
pair at a time. All-pairs screening propagates hundreds of objects across
thousands of timesteps, so an unconditional print per propagation is tens of
thousands of lines per run — which is not merely noisy but actively harmful:
the I/O dominates the run, and genuine warnings (a dropped element set, a
refused Pc) are buried in the middle of it.

So tracing is retained and made switchable, defaulting to off:

    PHYSICS_TRACE=1 python -m pytest tests/test_envisat_replay.py -s
    PHYSICS_TRACE=1 uvicorn backend.api.main:app

Every trace is ALSO emitted at DEBUG level regardless, so anything that
configures logging can capture it without touching the environment.

This is a verbosity control and nothing else. It must never gate a validation
check, a raise, or a warning — those stay unconditional. If a trace is the only
thing standing between a wrong number and a demo, it should have been an
exception.
"""

import logging
import os

logger = logging.getLogger(__name__)

_TRUTHY = {"1", "true", "yes", "on"}


def _enabled() -> bool:
    """Read the switch on every call so tests can toggle it via monkeypatch."""
    return os.environ.get("PHYSICS_TRACE", "").strip().lower() in _TRUTHY


def trace(message: str) -> None:
    """
    Emit one pipeline-stage trace.

    Always logged at DEBUG; printed to stdout only when PHYSICS_TRACE is set.

    Args:
        message: preformatted line, conventionally prefixed with the stage in
                 brackets, e.g. "[propagation] ISS @ ... |r|=6790.123 km".
    """
    logger.debug(message)
    if _enabled():
        print(message)
