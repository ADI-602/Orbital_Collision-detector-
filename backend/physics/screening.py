"""
screening.py — Conjunction screening: coarse filter + fine propagation.

Given a primary satellite and a set of candidates — or a whole tracked set to
screen against itself — identifies pairs with close approaches within an
analysis window. Filtering is staged, cheapest first:

  Stage 1 (geometric): apogee/perigee altitude band overlap. Rules out pairs
                       that cannot possibly come close, with no propagation.
  Stage 2 (sampled):   propagate every object ONCE over the window, then take
                       pairwise separations on the cached ephemerides
                       (screen_all_pairs). Reduces N-squared propagations to N.
  Stage 3 (fine):      screen_pair on the survivors — de-aliased local-minimum
                       refinement, which is what actually produces a reported
                       minimum separation.

Stage 2 is a GATE, never an answer. Its sampled minimum is an upper bound on
the true minimum, and on a 60 s grid it has been measured to overstate a real
approach by up to 2.8x (7.301 km sampled against 2.643 km true). Only stage 3
output is a separation this module will report.

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
) -> bool:
    """
    Cheap geometric check: can these two objects' orbits possibly intersect?

    This is the apogee/perigee filter — the first of the three filters in
    Hoots, Crawford & Roehrich (1984), "An analytic method to determine future
    close approaches between satellites", Celestial Mechanics 33, 143-158. If
    the two [perigee, apogee] altitude bands do not overlap, the objects can
    never occupy the same point, so no propagation is needed to rule the pair
    out. That is a true necessary condition, which is what makes discarding
    the pair safe.

    ------------------------------------------------------------------
    THERE IS DELIBERATELY NO INCLINATION CHECK. An earlier version rejected
    pairs whose inclinations differed by more than 15 degrees. That is not a
    conservative filter, it is a wrong one: two orbits at different
    inclinations intersect at their relative nodes, and a large plane
    difference is precisely what produces a high relative velocity at
    encounter — i.e. the most dangerous conjunctions, not the least.

    It removed this project's own validation case. Envisat (i = 98.55 deg) and
    the Zenith-2 fragment (i = 71.33 deg) differ by 27.2 deg, so the pair was
    rejected before any propagation and the October 2004 conjunction — whose
    14.78 km/s closing speed comes from exactly that plane difference — was
    reported as no event at all.

    Do not reintroduce an inclination-proximity check. If a second filter
    stage is wanted, the sound one is Hoots' orbit-path filter, which computes
    the true minimum distance between the two orbit paths rather than
    comparing plane orientations.
    ------------------------------------------------------------------

    Args:
        primary:            the primary satellite.
        secondary:          the candidate object.
        altitude_margin_km: margin for altitude band overlap [km]. Widens both
                            bands, so a larger value rejects fewer pairs.

    Returns:
        True if the pair passes the coarse filter (may have a conjunction).
        False if the pair is geometrically ruled out.
    """
    elem1 = _orbital_elements_from_tle(primary)
    elem2 = _orbital_elements_from_tle(secondary)

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

    logger.debug(
        "Coarse filter PASS: %s vs %s (altitude bands overlap)",
        primary.name, secondary.name,
    )
    return True


# ---------------------------------------------------------------------------
# Stage 2 — Fine propagation scan
# ---------------------------------------------------------------------------

def _local_minima_indices(values: np.ndarray) -> list[int]:
    """
    Indices of every local minimum in a 1-D series, endpoints included.

    Each one brackets a true local minimum of the underlying continuous
    separation curve, which is why they — not just the single lowest sample —
    are the correct candidate set for a close-approach search. A sharp
    encounter that falls between samples still produces a dip at one of its
    bracketing samples, even when both are far up the sides of the V.

    Args:
        values: sampled separations [km].

    Returns:
        Sorted indices of local minima.
    """
    n = len(values)
    if n == 0:
        return []
    if n == 1:
        return [0]

    interior = np.flatnonzero(
        (values[1:-1] <= values[:-2]) & (values[1:-1] <= values[2:])
    ) + 1
    indices = set(int(i) for i in interior)

    # Endpoints: the minimum may lie at or beyond the window edge.
    if values[0] <= values[1]:
        indices.add(0)
    if values[-1] <= values[-2]:
        indices.add(n - 1)

    return sorted(indices)


def _fine_rescan_step_s(coarse_timestep_s: float) -> float:
    """
    Timestep for the local re-scan around a flagged coarse minimum.

    Fine enough to rank neighbouring encounters correctly, coarse enough that
    re-scanning several short windows stays cheap. Sub-second precision is not
    needed here — that is Stage 5's job (tca.refine_tca), which polishes the
    winner with a bounded numerical minimisation.
    """
    return float(np.clip(coarse_timestep_s / 60.0, 0.25, 2.0))


def _scan_min_separation(
    primary: EarthSatellite,
    secondary: EarthSatellite,
    tt_lo: float,
    tt_hi: float,
    step_s: float,
    ts,
) -> tuple[float, float]:
    """
    Minimum separation on a fine grid over [tt_lo, tt_hi].

    Args:
        primary:   primary satellite.
        secondary: candidate object.
        tt_lo:     window start [TT Julian date].
        tt_hi:     window end [TT Julian date].
        step_s:    sampling step [seconds].
        ts:        skyfield timescale.

    Returns:
        (tt_of_minimum, min_separation_km).
    """
    step_days = step_s / 86400.0
    n = max(int((tt_hi - tt_lo) / step_days) + 1, 2)
    tt_grid = tt_lo + np.arange(n) * step_days
    tt_grid = tt_grid[tt_grid <= tt_hi + 0.5 * step_days]

    t_array = ts.tt_jd(tt_grid)
    pos1, _ = propagate_batch_teme(primary, t_array)
    pos2, _ = propagate_batch_teme(secondary, t_array)

    seps = np.linalg.norm(pos2 - pos1, axis=1)
    i = int(np.argmin(seps))
    return float(tt_grid[i]), float(seps[i])


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
    pos1_teme, vel1_teme = propagate_batch_teme(primary, t_array)
    pos2_teme, vel2_teme = propagate_batch_teme(secondary, t_array)

    # Compute separation at each timestep.
    delta_r = pos2_teme - pos1_teme          # (N, 3) in TEME
    separations_km = np.linalg.norm(delta_r, axis=1)  # (N,)

    # Fastest relative closing speed anywhere in the window [km/s]. This bounds
    # how much separation can change between two adjacent samples, which is
    # what makes the de-aliasing gate below provably safe.
    rel_speeds = np.linalg.norm(vel2_teme - vel1_teme, axis=1)
    max_rel_speed_km_s = float(rel_speeds.max())

    # ------------------------------------------------------------------
    # De-alias the coarse grid.
    #
    # `argmin` over the sampled series is NOT the closest approach: a sharp
    # encounter can pass entirely between two samples. Envisat/Zenith-2 close
    # at ~14.8 km/s, so a 60 s step moves them ~890 km — the real 268 m event
    # is far narrower than the sampling interval, and every sample near it
    # lands hundreds of km up the sides of the V. A shallower pass elsewhere
    # then wins argmin and the true conjunction is reported as GREEN.
    #
    # docs/physics-notes.md Stage 4 names this directly: "too coarse a
    # timestep and you can miss a close approach that occurs between sample
    # points. This is a correctness risk, not just a performance knob."
    #
    # The fix is the standard one it prescribes — coarse scan, then refine
    # locally. Every local minimum of the sampled series brackets a true local
    # minimum, so we examine all of them rather than only the lowest sample.
    # ------------------------------------------------------------------
    candidate_indices = _local_minima_indices(separations_km)

    # A sampled local minimum of value m can hide a true minimum no lower than
    # m - v_max * dt/2, since |d/dt separation| <= relative speed. Anything
    # above this gate provably cannot dip below the threshold between samples,
    # so discarding it is safe; anything below it must be examined.
    alias_margin_km = max_rel_speed_km_s * timestep_s / 2.0
    gate_km = threshold_km + alias_margin_km
    candidate_indices = [i for i in candidate_indices if separations_km[i] < gate_km]

    logger.info(
        "screen_pair: %s vs %s  grid_min=%.3f km  max_rel_v=%.3f km/s  "
        "alias_margin=%.1f km  %d local minima under gate=%.1f km",
        primary.name, secondary.name, float(separations_km.min()),
        max_rel_speed_km_s, alias_margin_km, len(candidate_indices), gate_km,
    )

    if not candidate_indices:
        return None

    # Re-scan each surviving neighbourhood finely enough to rank them honestly.
    # Bounds are +/- one coarse step, which is guaranteed to contain the true
    # local minimum that the sampled minimum brackets.
    fine_step_s = _fine_rescan_step_s(timestep_s)
    best_tt: float | None = None
    best_sep_km = float("inf")

    for idx in candidate_indices:
        centre_tt = float(tt_epochs[idx])
        lo_tt = max(centre_tt - step_days, tt_start)
        hi_tt = min(centre_tt + step_days, tt_end)

        fine_tt, fine_sep_km = _scan_min_separation(
            primary, secondary, lo_tt, hi_tt, fine_step_s, ts,
        )
        if fine_sep_km < best_sep_km:
            best_sep_km = fine_sep_km
            best_tt = fine_tt

    if best_tt is None:
        return None

    min_idx = int(np.argmin(np.abs(tt_epochs - best_tt)))
    min_sep_km = best_sep_km

    logger.info(
        "screen_pair: %s vs %s  refined min_sep=%.3f km at %s "
        "(coarse grid reported %.3f km)",
        primary.name, secondary.name, min_sep_km,
        ts.tt_jd(best_tt).utc_iso(), float(separations_km.min()),
    )

    if min_sep_km >= threshold_km:
        return None

    # Build the flagged TCA window: +/-window_margin_s around min separation.
    margin_days = window_margin_s / 86400.0
    min_tt = best_tt
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
      1. Coarse geometric filter (apogee/perigee altitude band overlap) —
         cheap, rules out pairs that cannot possibly come close, with no
         propagation.
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


# ---------------------------------------------------------------------------
# All-pairs screening (cached ephemerides)
# ---------------------------------------------------------------------------

def _cache_ephemerides(
    objects: list[EarthSatellite], t_array: Time,
) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """
    Propagate every object once over the sample grid.

    This is the whole point of the all-pairs path. ``screen_pair`` propagates
    BOTH of its objects on every call, so screening one primary against N
    candidates propagates the primary N times, and screening a set against
    itself costs O(N^2) propagations for O(N) objects' worth of information.
    Propagating once and reusing the arrays makes the pairwise stage pure
    arithmetic.

    An object whose element set the propagator rejects is dropped and its index
    omitted, rather than being filled with zeros — a zero position is a point at
    the centre of the Earth, and would read as a spectacularly close approach
    with everything else in the set.

    Args:
        objects: catalogue objects to propagate.
        t_array: array-valued skyfield Time (the shared sample grid).

    Returns:
        (pos_teme_km, vel_teme_km_s, kept_indices), where the arrays have shape
        (len(kept_indices), len(t_array), 3) and kept_indices maps a row back to
        its position in `objects`.
    """
    n_steps = len(t_array.tt)
    pos = np.empty((len(objects), n_steps, 3), dtype=float)
    vel = np.empty((len(objects), n_steps, 3), dtype=float)
    kept: list[int] = []

    for i, sat in enumerate(objects):
        try:
            p, v = propagate_batch_teme(sat, t_array)
        except Exception as exc:
            logger.warning(
                "screen_all_pairs: dropping %s - propagation failed: %s",
                sat.name, exc,
            )
            continue
        if not (np.all(np.isfinite(p)) and np.all(np.isfinite(v))):
            logger.warning(
                "screen_all_pairs: dropping %s - propagation produced "
                "non-finite values (decayed or unusable element set)",
                sat.name,
            )
            continue
        row = len(kept)
        pos[row] = p
        vel[row] = v
        kept.append(i)

    return pos[: len(kept)], vel[: len(kept)], kept


def _gate_pairs(
    pos: np.ndarray,
    vel: np.ndarray,
    timestep_s: float,
    threshold_km: float,
    block: int = 40,
) -> list[tuple[float, int, int]]:
    """
    Every pair that could hide a close approach, from the cached ephemerides.

    THE SAMPLED MINIMUM IS NOT THE ANSWER. A sharp encounter passes entirely
    between two samples — the same aliasing ``screen_pair`` exists to de-alias.
    On a 60 s grid this has been measured overstating a real approach by 2.8x
    (7.301 km sampled against 2.643 km true). So this computes a rigorous LOWER
    BOUND on the true minimum and gates on that; the caller must still refine
    every survivor to get a number worth reporting.

    THE BOUND, PER SAMPLE INTERVAL. Over one interval [t_k, t_k+1] of length
    dt, separation s(t) obeys |s'| <= |dv|, so s is bounded below by the two
    one-sided cones from each endpoint. Their crossing point gives

        s_min(interval) >= (s_k + s_k+1 - V*dt) / 2

    where V bounds |dv| across the interval. |dv| itself moves no faster than
    the relative gravitational acceleration allows, so

        V = max(|dv_k|, |dv_k+1|) + A*dt/2,   A = mu/r1_min^2 + mu/r2_min^2

    with each r_min taken from that object's own cached track. Both steps are
    inequalities in the safe direction, so a pair discarded here provably
    cannot reach the threshold.

    WHY PER INTERVAL AND NOT GLOBALLY. An earlier version took the global
    minimum separation and the global maximum relative speed and combined them.
    Those occur at completely different instants — a pair's fastest crossing is
    usually nowhere near its closest pass — so the bound was wildly pessimistic
    and 30% of all pairs passed the gate, which put the expensive refinement
    stage hours away from finishing. Evaluating the bound interval by interval
    only ever pairs a separation with the speed actually in force at the same
    time.

    Blocked so the (block, block, n_steps, 3) temporary stays bounded however
    many objects were handed in.

    Args:
        pos:          (N, T, 3) cached positions [km], all in one frame.
        vel:          (N, T, 3) cached velocities [km/s], same frame.
        timestep_s:   spacing of the sample grid [seconds].
        threshold_km: separation of interest [km].
        block:        objects per block.

    Returns:
        [(lower_bound_km, i, j), ...] with i < j, ascending by bound. The bound
        may be negative — that means "could reach zero", not a real distance.
    """
    n = pos.shape[0]
    dt = timestep_s
    half_dt = dt / 2.0
    survivors: list[tuple[float, int, int]] = []

    if n < 2 or pos.shape[1] < 2:
        return survivors

    # Per-object bound on gravitational acceleration, from its own closest
    # approach to the geocentre over the window. Larger for a lower orbit,
    # which is the correct direction.
    r_min = np.linalg.norm(pos, axis=2).min(axis=1)          # (N,)
    accel_max = _MU_EARTH_KM3_S2 / np.square(r_min)          # (N,) [km/s^2]

    for a in range(0, n, block):
        pa, va = pos[a : a + block], vel[a : a + block]
        aa = accel_max[a : a + block]
        for b in range(a, n, block):
            pb, vb = pos[b : b + block], vel[b : b + block]
            ab = accel_max[b : b + block]

            # (ba, bb, T)
            sep = np.linalg.norm(pa[:, None, :, :] - pb[None, :, :, :], axis=-1)
            rel = np.linalg.norm(va[:, None, :, :] - vb[None, :, :, :], axis=-1)

            # Relative acceleration bound for each pair, (ba, bb, 1).
            accel_pair = (aa[:, None] + ab[None, :])[:, :, None]

            # Speed bound in force across each interval, (ba, bb, T-1).
            speed_bound = np.maximum(rel[:, :, :-1], rel[:, :, 1:]) + accel_pair * half_dt

            # Lower bound on the true minimum within each interval.
            interval_bound = (sep[:, :, :-1] + sep[:, :, 1:] - speed_bound * dt) / 2.0
            pair_bound = interval_bound.min(axis=2)

            for bi, bj in np.argwhere(pair_bound < threshold_km):
                i, j = a + int(bi), b + int(bj)
                # Each unordered pair once, and never an object with itself.
                if j <= i:
                    continue
                survivors.append((float(pair_bound[bi, bj]), i, j))

    survivors.sort()
    return survivors


def screen_all_pairs(
    objects: list[EarthSatellite],
    start_time: Time,
    end_time: Time,
    timestep_s: float = 60.0,
    threshold_km: float = 5.0,
    window_margin_s: float = 300.0,
    max_refine_pairs: int | None = None,
) -> tuple[list[ConjunctionCandidate], dict]:
    """
    Screen a tracked set against itself for close approaches.

    ``screen_candidates`` answers "what comes near THIS object". This answers
    "what comes near anything", which is both what an operator actually watches
    and what makes a populated event list possible: one primary against a few
    hundred candidates over 24 h typically finds nothing at all, because a
    sub-5 km approach to one specific object is rare. The same set screened
    against itself has N^2/2 chances instead of N.

    Staged so the expensive work only ever runs on a handful of pairs:

      1. ``_cache_ephemerides`` - one propagation per object, not per pair.
      2. ``_gate_pairs``        - vectorised sampled separations with a
                                  provably-safe gate. Fast, and never an answer.
      3. ``screen_pair``        - the validated de-aliasing refinement, run only
                                  on survivors. Every reported separation comes
                                  from here.

    Memory is O(N * T): two (N, T, 3) float64 arrays, about 48 MB for 700
    objects on a 24 h / 60 s grid. Scale the timestep rather than the object
    count if that becomes a problem — but note a coarser grid widens the
    stage-2 gate and so hands MORE pairs to stage 3, which is the expensive one.

    Args:
        objects:          the tracked set. Objects sharing a satnum are never
                          screened against each other.
        start_time:       start of the analysis window.
        end_time:         end of the analysis window.
        timestep_s:       sample grid spacing [seconds]. Default 60 s.
        threshold_km:     separation of interest [km]. Default 5 km.
        window_margin_s:  margin for the flagged TCA window [seconds].
        max_refine_pairs: cap on stage-3 refinements, closest-sampled first.
                          None refines every survivor. When set and hit, the
                          returned stats say so — a truncated screening must
                          never be presented as a complete one.

    Returns:
        (candidates, stats). `candidates` are real, de-aliased conjunctions
        sorted closest first. `stats` reports what the run actually did:
        objects_in, objects_propagated, pairs_evaluated, pairs_gated,
        pairs_refined, truncated.
    """
    ts = load.timescale()

    step_days = timestep_s / 86400.0
    n_steps = max(int((end_time.tt - start_time.tt) / step_days) + 1, 2)
    t_array = ts.tt_jd(start_time.tt + np.arange(n_steps) * step_days)

    pos, vel, kept = _cache_ephemerides(objects, t_array)
    n = len(kept)

    stats = {
        "objects_in": len(objects),
        "objects_propagated": n,
        "pairs_evaluated": n * (n - 1) // 2,
        "pairs_gated": 0,
        "pairs_refined": 0,
        "truncated": False,
    }

    if n < 2:
        logger.warning(
            "screen_all_pairs: %d propagatable object(s) - nothing to screen", n,
        )
        return [], stats

    logger.info(
        "screen_all_pairs: %d objects x %d steps, evaluating %d pairs",
        n, n_steps, stats["pairs_evaluated"],
    )

    gated = _gate_pairs(pos, vel, timestep_s, threshold_km)
    stats["pairs_gated"] = len(gated)

    if max_refine_pairs is not None and len(gated) > max_refine_pairs:
        # Surfaced, never silent: a truncated screening is a different claim
        # from a complete one, and the UI must be able to say which it got.
        logger.warning(
            "screen_all_pairs: %d pairs passed the gate, refining the closest "
            "%d - results are NOT a complete screening of the set",
            len(gated), max_refine_pairs,
        )
        gated = gated[:max_refine_pairs]
        stats["truncated"] = True

    results: list[ConjunctionCandidate] = []
    for _sampled_km, i, j in gated:
        primary = objects[kept[i]]
        secondary = objects[kept[j]]
        if primary.model.satnum == secondary.model.satnum:
            continue

        candidate = screen_pair(
            primary, secondary, start_time, end_time,
            timestep_s=timestep_s,
            threshold_km=threshold_km,
            window_margin_s=window_margin_s,
        )
        stats["pairs_refined"] += 1
        if candidate is not None:
            results.append(candidate)

    results.sort(key=lambda c: c.min_separation_km)

    logger.info(
        "screen_all_pairs: %d conjunction(s) from %d gated / %d evaluated pairs",
        len(results), stats["pairs_gated"], stats["pairs_evaluated"],
    )

    return results, stats
