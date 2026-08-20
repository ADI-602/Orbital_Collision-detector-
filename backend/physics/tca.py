"""
tca.py — Time of Closest Approach (TCA) refinement.

Given a ConjunctionCandidate from screening.py (with a coarse TCA window),
refines the exact time of minimum separation using scipy's bounded
minimisation. Returns the refined TCA time plus full ECI state vectors
for both objects — ready for collision_probability.py's compute_pc().

This is a refinement on top of screening, not a separate physics concept.
It reuses propagation.py and frames.py at finer time resolution.

Reference: docs/physics-notes.md Stage 5.

Units: km, km/s, seconds.
"""

import logging
from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize_scalar
from skyfield.api import EarthSatellite, Time, load

from .frames import StateVectorECI, teme_to_eci
from .propagation import propagate
from .screening import ConjunctionCandidate

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class TCAResult:
    """
    Refined time of closest approach between two objects.

    Contains everything downstream modules need:
      - Exact TCA time
      - Miss distance and relative velocity at TCA
      - Full ECI state vectors for both objects at TCA (for Pc computation)

    Attributes:
        tca_time:           skyfield Time — refined TCA.
        miss_distance_km:   minimum separation at TCA [km].
        rel_velocity_km_s:  relative speed at TCA [km/s].
        state1_eci:         ECI state of object 1 at TCA.
        state2_eci:         ECI state of object 2 at TCA.
    """
    tca_time: Time
    miss_distance_km: float
    rel_velocity_km_s: float
    state1_eci: StateVectorECI
    state2_eci: StateVectorECI

    def __repr__(self) -> str:
        return (
            f"TCAResult("
            f"tca={self.tca_time.utc_iso()}, "
            f"miss={self.miss_distance_km:.4f} km ({self.miss_distance_km * 1000:.1f} m), "
            f"rel_v={self.rel_velocity_km_s:.4f} km/s, "
            f"obj1={self.state1_eci.satellite_name!r}, "
            f"obj2={self.state2_eci.satellite_name!r})"
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def refine_tca(
    candidate: ConjunctionCandidate,
    xtol_s: float = 0.01,
) -> TCAResult:
    """
    Refine the time of closest approach within a flagged window.

    Uses scipy.optimize.minimize_scalar (bounded method) to find the time
    that minimises the relative distance between the two objects. The
    search is bounded to the coarse TCA window from screening.

    At the converged TCA time, both objects are propagated to ECI for
    downstream Pc computation.

    Args:
        candidate: a ConjunctionCandidate from screening.py with a
                   flagged coarse TCA window.
        xtol_s:    convergence tolerance in seconds. Default 0.01s
                   (10 ms — well below the encounter timescale).

    Returns:
        TCAResult with refined TCA time, miss distance, relative velocity,
        and ECI state vectors.

    Raises:
        RuntimeError: if the optimiser fails to converge.
    """
    ts = load.timescale()
    primary = candidate.primary
    secondary = candidate.secondary

    # Center optimization around coarse minimum separation time.
    # Optimizing dt_sec in seconds relative to t_center avoids float64 loss
    # of precision when operating on large Julian date numbers (~2.45e6).
    t_center = candidate.min_separation_time
    tt_center = float(t_center.tt)

    ws = candidate.coarse_tca_window_start
    we = candidate.coarse_tca_window_end
    tt_start = float(ws.tt)
    tt_end = float(we.tt)

    # Bound in seconds relative to t_center.
    dt_min_s = (tt_start - tt_center) * 86400.0
    dt_max_s = (tt_end - tt_center) * 86400.0

    logger.info(
        "refine_tca: %s vs %s  center=%s  window=[%.1fs, %.1fs]",
        primary.name, secondary.name,
        t_center.utc_iso(), dt_min_s, dt_max_s,
    )

    # Objective function: relative distance at offset dt_sec from t_center.
    from skyfield.framelib import true_equator_and_equinox_of_date as teme_frame

    def _distance_at_dt_sec(dt_sec: float) -> float:
        """Return |r1 - r2| in TEME at t_center + dt_sec seconds."""
        t = ts.tt_jd(tt_center + dt_sec / 86400.0)

        geo1 = primary.at(t)
        pos1, _ = geo1.frame_xyz_and_velocity(teme_frame)
        pos1_km = np.asarray(pos1.km, dtype=float)

        geo2 = secondary.at(t)
        pos2, _ = geo2.frame_xyz_and_velocity(teme_frame)
        pos2_km = np.asarray(pos2.km, dtype=float)

        return float(np.linalg.norm(pos2_km - pos1_km))

    # Bounded minimisation over seconds offset.
    result = minimize_scalar(
        _distance_at_dt_sec,
        bounds=(dt_min_s, dt_max_s),
        method="bounded",
        options={"xatol": xtol_s, "maxiter": 500},
    )

    if not result.success:
        raise RuntimeError(
            f"TCA refinement failed for {primary.name} vs {secondary.name}: "
            f"{result.message}"
        )

    tca_tt = tt_center + float(result.x) / 86400.0
    tca_time = ts.tt_jd(tca_tt)
    miss_distance_km = float(result.fun)

    logger.info(
        "refine_tca: converged at %s  miss=%.4f km (%.1f m)  "
        "iterations=%d",
        tca_time.utc_iso(), miss_distance_km, miss_distance_km * 1000.0,
        result.nfev,
    )

    # --- Compute full ECI states at TCA ---
    state1_teme = propagate(primary, tca_time)
    state2_teme = propagate(secondary, tca_time)

    state1_eci = teme_to_eci(state1_teme, primary)
    state2_eci = teme_to_eci(state2_teme, secondary)

    # Relative velocity at TCA.
    rel_vel = state2_eci.vel_eci_km_s - state1_eci.vel_eci_km_s
    rel_velocity_km_s = float(np.linalg.norm(rel_vel))

    tca_result = TCAResult(
        tca_time=tca_time,
        miss_distance_km=miss_distance_km,
        rel_velocity_km_s=rel_velocity_km_s,
        state1_eci=state1_eci,
        state2_eci=state2_eci,
    )

    logger.info(
        "refine_tca: RESULT  %s vs %s  TCA=%s  miss=%.4f km (%.1f m)  "
        "rel_v=%.4f km/s",
        primary.name, secondary.name,
        tca_time.utc_iso(), miss_distance_km, miss_distance_km * 1000.0,
        rel_velocity_km_s,
    )

    return tca_result


def compute_tca_from_tles(
    primary: EarthSatellite,
    secondary: EarthSatellite,
    start_time: Time,
    end_time: Time,
    coarse_timestep_s: float = 60.0,
    threshold_km: float = 5.0,
    window_margin_s: float = 300.0,
    xtol_s: float = 0.01,
) -> TCAResult | None:
    """
    Convenience: screen a single pair and refine TCA in one call.

    Runs fine-propagation screening (skip coarse filter since we already
    know the pair) and, if a conjunction is found, refines TCA.

    Args:
        primary:           primary satellite.
        secondary:         candidate object.
        start_time:        start of the analysis window.
        end_time:          end of the analysis window.
        coarse_timestep_s: screening timestep [seconds].
        threshold_km:      screening separation threshold [km].
        window_margin_s:   margin for flagged TCA window [seconds].
        xtol_s:            TCA refinement tolerance [seconds].

    Returns:
        TCAResult if a conjunction is found and TCA is refined, else None.
    """
    from .screening import screen_pair

    candidate = screen_pair(
        primary, secondary,
        start_time, end_time,
        timestep_s=coarse_timestep_s,
        threshold_km=threshold_km,
        window_margin_s=window_margin_s,
    )

    if candidate is None:
        logger.info(
            "compute_tca_from_tles: no conjunction found for %s vs %s",
            primary.name, secondary.name,
        )
        return None

    return refine_tca(candidate, xtol_s=xtol_s)
