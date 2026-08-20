"""
screening.py — Conjunction screening: coarse filter + fine propagation.

Given a primary satellite and a set of candidates, identifies pairs with
close approaches within an analysis window. Implements a two-stage filter:

  Stage 1 (coarse):  Cheap TLE-parameter checks (altitude bands, inclination)
                     to rule out geometrically impossible conjunctions.
  Stage 2 (fine):    Vectorized propagation at 60-second timesteps across the
                     analysis window; flag pairs with separation < threshold.

This module does NOT compute Pc — it identifies *candidates* for deeper
analysis by tca.py and collision_probability.py.

Scope reduction (per CLAUDE.md §1.4, architecture.md §5):
  Screening is scoped to a defined candidate set, not the full ~40,000-object
  catalog. This is stated explicitly and is a deliberate, defensible choice.

Units: km, km/s, seconds.
Frame note: separations are computed in TEME (both objects in the same frame),
  which is valid since we only need |Δr| (magnitude is frame-invariant for
  rotation-only transforms). ECI conversion is deferred to TCA refinement.
"""

import logging
from dataclasses import dataclass

import numpy as np
from skyfield.api import EarthSatellite, Time, load

from .propagation import propagate_batch_teme

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Earth radius [km] — used to convert mean motion to altitude estimates.
_R_EARTH_KM = 6371.0

# Gravitational parameter [km^3/s^2] — for semi-major axis from mean motion.
_MU_EARTH_KM3_S2 = 398600.4418


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ConjunctionCandidate:
    """
    A flagged close approach between two catalogued objects.

    Produced by the fine-propagation stage of screening. Consumed by
    tca.py for TCA refinement, then by collision_probability.py for Pc.

    Attributes:
        primary:                   the primary satellite (e.g. Envisat).
        secondary:                 the candidate object.
        coarse_tca_window_start:   skyfield Time — start of the flagged window.
        coarse_tca_window_end:     skyfield Time — end of the flagged window.
        min_separation_km:         minimum separation found in fine scan [km].
        min_separation_time:       skyfield Time of minimum separation.
    """
    primary: EarthSatellite
    secondary: EarthSatellite
    coarse_tca_window_start: Time
    coarse_tca_window_end: Time
    min_separation_km: float
    min_separation_time: Time

    def __repr__(self) -> str:
        return (
            f"ConjunctionCandidate("
            f"primary={self.primary.name!r}, "
            f"secondary={self.secondary.name!r}, "
            f"min_sep={self.min_separation_km:.3f} km, "
            f"time={self.min_separation_time.utc_iso()})"
        )


# ---------------------------------------------------------------------------
# Stage 1 — Coarse geometric filter
# ---------------------------------------------------------------------------

def _orbital_elements_from_tle(sat: EarthSatellite) -> dict:
    """
    Extract key orbital elements from a TLE for coarse filtering.

    Returns a dict with:
        inclination_deg:  orbital inclination [degrees]
        perigee_alt_km:   perigee altitude above Earth surface [km]
        apogee_alt_km:    apogee altitude above Earth surface [km]
        eccentricity:     orbital eccentricity
        mean_motion_revs_per_day: mean motion [revs/day]
    """
    # skyfield's EarthSatellite exposes the sgp4 model attributes.
    model = sat.model
    incl_rad = model.inclo        # inclination [radians]
    ecc = model.ecco              # eccentricity
    # Mean motion in radians/minute → convert to revs/day for altitude calc.
    n_rad_min = model.no_kozai    # radians per minute
    n_revs_day = n_rad_min * (60.0 * 24.0) / (2.0 * np.pi)

    # Semi-major axis from mean motion:  a = (mu / n^2)^(1/3)
    n_rad_s = n_rad_min / 60.0    # radians per second
    a_km = (_MU_EARTH_KM3_S2 / (n_rad_s ** 2)) ** (1.0 / 3.0)

    perigee_alt_km = a_km * (1.0 - ecc) - _R_EARTH_KM
    apogee_alt_km = a_km * (1.0 + ecc) - _R_EARTH_KM

    return {
        "inclination_deg": np.degrees(incl_rad),
        "perigee_alt_km": perigee_alt_km,
        "apogee_alt_km": apogee_alt_km,
        "eccentricity": ecc,
        "mean_motion_revs_per_day": n_revs_day,
    }


def _passes_coarse_filter(
    primary: EarthSatellite,
    secondary: EarthSatellite,
    altitude_margin_km: float = 100.0,
    inclination_margin_deg: float = 15.0,
) -> bool:
    """
    Cheap geometric check: can these two objects' orbits possibly intersect?

    Checks:
      1. Altitude band overlap: do the [perigee, apogee] bands overlap
         within a margin? If not, the orbits can never come close.
      2. Inclination proximity: if inclinations differ by more than a margin,
         the orbital planes are too different for a conjunction.

    Args:
        primary:                the primary satellite.
        secondary:              the candidate object.
        altitude_margin_km:     margin for altitude band overlap [km].
        inclination_margin_deg: maximum inclination difference [degrees].

    Returns:
        True if the pair passes the coarse filter (may have a conjunction).
        False if the pair is geometrically ruled out.
    """
    elem1 = _orbital_elements_from_tle(primary)
    elem2 = _orbital_elements_from_tle(secondary)

    # Check 1: altitude band overlap
    band1_lo = elem1["perigee_alt_km"] - altitude_margin_km
    band1_hi = elem1["apogee_alt_km"] + altitude_margin_km
    band2_lo = elem2["perigee_alt_km"] - altitude_margin_km
    band2_hi = elem2["apogee_alt_km"] + altitude_margin_km

    if band1_hi < band2_lo or band2_hi < band1_lo:
        logger.debug(
            "Coarse filter REJECT (altitude): %s [%.0f–%.0f km] vs %s [%.0f–%.0f km]",
            primary.name, elem1["perigee_alt_km"], elem1["apogee_alt_km"],
            secondary.name, elem2["perigee_alt_km"], elem2["apogee_alt_km"],
        )
        return False

    # Check 2: inclination proximity
    incl_diff = abs(elem1["inclination_deg"] - elem2["inclination_deg"])
    if incl_diff > inclination_margin_deg:
        logger.debug(
            "Coarse filter REJECT (inclination): %s (%.2f°) vs %s (%.2f°), diff=%.2f°",
            primary.name, elem1["inclination_deg"],
            secondary.name, elem2["inclination_deg"], incl_diff,
        )
        return False

    logger.debug(
        "Coarse filter PASS: %s vs %s  (alt overlap, incl diff=%.2f°)",
        primary.name, secondary.name, incl_diff,
    )
    return True


# ---------------------------------------------------------------------------
# Stage 2 — Fine propagation scan
# ---------------------------------------------------------------------------

def screen_pair(
    primary: EarthSatellite,
    secondary: EarthSatellite,
    start_time: Time,
    end_time: Time,
    timestep_s: float = 60.0,
    threshold_km: float = 5.0,
    window_margin_s: float = 300.0,
) -> ConjunctionCandidate | None:
    """
    Fine-propagation screening for a single pair of objects.

    Propagates both objects at `timestep_s`-second intervals across
    [start_time, end_time] and checks for separation below `threshold_km`.

    If a close approach is found, returns a ConjunctionCandidate with a
    flagged window of ±window_margin_s seconds around the point of
    minimum separation.

    Args:
        primary:        primary satellite.
        secondary:      candidate object.
        start_time:     start of the analysis window (skyfield Time).
        end_time:       end of the analysis window (skyfield Time).
        timestep_s:     propagation timestep [seconds]. Default 60s.
        threshold_km:   separation threshold [km]. Default 5 km.
        window_margin_s: margin around min-separation for the flagged
                        TCA window [seconds]. Default 300s (5 min).

    Returns:
        ConjunctionCandidate if min separation < threshold_km, else None.
    """
    ts = load.timescale()

    # Use TT (Terrestrial Time) Julian dates for uniform time arithmetic.
    # TT is a uniform timescale without leap seconds — safe for interval math.
    tt_start = float(start_time.tt)
    tt_end = float(end_time.tt)
    step_days = timestep_s / 86400.0
    n_steps = int((tt_end - tt_start) / step_days) + 1

    if n_steps < 2:
        logger.warning(
            "screen_pair: window too short for timestep (%.1fs, %.1f days)",
            timestep_s, tt_end - tt_start,
        )
        return None

    # Create array-valued Time for vectorized propagation.
    tt_epochs = tt_start + np.arange(n_steps) * step_days
    t_array = ts.tt_jd(tt_epochs)

    # Batch propagate both objects — returns (N, 3) arrays in TEME.
    pos1_teme, _ = propagate_batch_teme(primary, t_array)
    pos2_teme, _ = propagate_batch_teme(secondary, t_array)

    # Compute separation at each timestep.
    delta_r = pos2_teme - pos1_teme          # (N, 3) in TEME
    separations_km = np.linalg.norm(delta_r, axis=1)  # (N,)

    min_idx = int(np.argmin(separations_km))
    min_sep_km = float(separations_km[min_idx])

    logger.info(
        "screen_pair: %s vs %s  min_sep=%.3f km at step %d/%d",
        primary.name, secondary.name, min_sep_km, min_idx, n_steps,
    )

    if min_sep_km >= threshold_km:
        return None

    # Build the flagged TCA window: +/-window_margin_s around min separation.
    margin_days = window_margin_s / 86400.0
    min_tt = float(tt_epochs[min_idx])
    window_start = ts.tt_jd(max(min_tt - margin_days, tt_start))
    window_end = ts.tt_jd(min(min_tt + margin_days, tt_end))
    min_sep_time = ts.tt_jd(min_tt)

    candidate = ConjunctionCandidate(
        primary=primary,
        secondary=secondary,
        coarse_tca_window_start=window_start,
        coarse_tca_window_end=window_end,
        min_separation_km=min_sep_km,
        min_separation_time=min_sep_time,
    )

    logger.info(
        "screen_pair: CONJUNCTION FLAGGED  %s vs %s  "
        "min_sep=%.3f km  window=[%s, %s]",
        primary.name, secondary.name, min_sep_km,
        window_start.utc_iso(), window_end.utc_iso(),
    )

    return candidate


def screen_candidates(
    primary: EarthSatellite,
    candidates: list[EarthSatellite],
    start_time: Time,
    end_time: Time,
    timestep_s: float = 60.0,
    threshold_km: float = 5.0,
    window_margin_s: float = 300.0,
    skip_coarse_filter: bool = False,
) -> list[ConjunctionCandidate]:
    """
    Screen a primary object against a list of candidates for conjunctions.

    Two-stage process:
      1. Coarse geometric filter (altitude/inclination) — cheap, rules out
         most pairs without propagation.
      2. Fine propagation scan — vectorized SGP4 at 60s timesteps for
         surviving pairs.

    Args:
        primary:            the primary satellite (e.g. Envisat).
        candidates:         list of candidate EarthSatellite objects.
        start_time:         start of the analysis window.
        end_time:           end of the analysis window.
        timestep_s:         fine-scan timestep [seconds]. Default 60s.
        threshold_km:       separation threshold [km]. Default 5 km.
        window_margin_s:    margin for flagged TCA window [seconds].
        skip_coarse_filter: if True, skip the coarse filter (useful when
                            the candidate set is already pre-filtered or
                            for testing with known close-approach pairs).

    Returns:
        List of ConjunctionCandidate objects, sorted by min separation
        (closest first). Empty list if no conjunctions found.
    """
    results: list[ConjunctionCandidate] = []

    for i, secondary in enumerate(candidates):
        # Don't screen an object against itself.
        if secondary.model.satnum == primary.model.satnum:
            logger.debug(
                "screen_candidates: skipping self-pair %s", primary.name,
            )
            continue

        # Stage 1: coarse filter
        if not skip_coarse_filter:
            if not _passes_coarse_filter(primary, secondary):
                continue

        logger.info(
            "screen_candidates: fine scan %d/%d — %s vs %s",
            i + 1, len(candidates), primary.name, secondary.name,
        )

        # Stage 2: fine propagation
        candidate = screen_pair(
            primary, secondary, start_time, end_time,
            timestep_s=timestep_s,
            threshold_km=threshold_km,
            window_margin_s=window_margin_s,
        )
        if candidate is not None:
            results.append(candidate)

    # Sort by minimum separation (closest first).
    results.sort(key=lambda c: c.min_separation_km)

    logger.info(
        "screen_candidates: %d conjunction(s) found for %s "
        "across %d candidates",
        len(results), primary.name, len(candidates),
    )

    return results
