"""
propagation.py — SGP4 orbit propagation via skyfield.

Thin wrapper around skyfield's EarthSatellite that:
  - accepts explicit skyfield Time objects (so callers control the epoch)
  - returns position and velocity in the TEME frame with units clearly labeled
  - logs intermediate values so a bad number is traceable to this stage

Do NOT reimplement SGP4. skyfield (built on Brandon Rhodes' sgp4 package)
is the propagator — this module is just a clean, unit-annotated interface.

Units used throughout:
  - Position: km (kilometers)
  - Velocity: km/s (kilometers per second)
  - Time: skyfield Time objects (UTC internally via TAI/TT)
"""

from dataclasses import dataclass

import numpy as np

from .trace import trace
from skyfield.api import EarthSatellite, Time


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class StateVectorTEME:
    """
    Position and velocity of a satellite at a single epoch, in the TEME frame.

    Attributes:
        epoch:        skyfield Time object for this state.
        pos_teme_km:  3-element numpy array, position in TEME frame [km].
        vel_teme_km_s: 3-element numpy array, velocity in TEME frame [km/s].
        satellite_name: human-readable label for logging/debugging.
    """
    epoch: Time
    pos_teme_km: np.ndarray   # shape (3,), units: km
    vel_teme_km_s: np.ndarray  # shape (3,), units: km/s
    satellite_name: str = ""

    def __repr__(self) -> str:
        r = np.linalg.norm(self.pos_teme_km)
        v = np.linalg.norm(self.vel_teme_km_s)
        return (
            f"StateVectorTEME(sat={self.satellite_name!r}, "
            f"|r|={r:.3f} km, |v|={v:.4f} km/s, epoch={self.epoch.utc_iso()})"
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def propagate(satellite: EarthSatellite, t: Time) -> StateVectorTEME:
    """
    Propagate *satellite* to a single epoch *t* via SGP4.

    Uses skyfield's `.TEME` property to get position/velocity directly in the
    TEME frame (True Equator Mean Equinox), which is SGP4's native output frame.
    No frame rotation is performed here — that lives in frames.py.

    Args:
        satellite: a skyfield EarthSatellite object (from tle_ingest.py).
        t:         a skyfield Time object for the desired epoch.

    Returns:
        StateVectorTEME with pos/vel in TEME frame [km, km/s].

    Raises:
        RuntimeError: if SGP4 propagation fails (e.g., decay, invalid epoch).
    """
    # skyfield's .at(t) runs SGP4 and returns an Astrometric position object.
    # .frame_xyz_and_velocity returns pos/vel in the requested frame.
    # We request the TEME frame explicitly.
    geocentric = satellite.at(t)

    # .frame_xyz_and_velocity(frame) — TEME is accessible via skyfield's
    # built-in TEME frame reference.
    from skyfield.framelib import true_equator_and_equinox_of_date as teme_frame
    pos_teme, vel_teme = geocentric.frame_xyz_and_velocity(teme_frame)

    # skyfield returns Distance and Velocity objects — extract km / km/s.
    pos_teme_km = pos_teme.km          # numpy array, shape (3,)
    vel_teme_km_s = vel_teme.km_per_s  # numpy array, shape (3,)

    state = StateVectorTEME(
        epoch=t,
        pos_teme_km=np.asarray(pos_teme_km, dtype=float),
        vel_teme_km_s=np.asarray(vel_teme_km_s, dtype=float),
        satellite_name=satellite.name,
    )

    # Log intermediate values so a bad number is traceable to this stage.
    r_km = np.linalg.norm(state.pos_teme_km)
    v_km_s = np.linalg.norm(state.vel_teme_km_s)
    trace(
        f"[propagation] {satellite.name} @ {t.utc_iso()} | "
        f"|r|={r_km:.3f} km  |v|={v_km_s:.4f} km/s  (TEME)"
    )

    return state


def propagate_sequence(
    satellite: EarthSatellite, times: list[Time] | Time,
) -> list[StateVectorTEME]:
    """
    Propagate *satellite* over a sequence of epochs using skyfield's
    vectorized batch API.

    Accepts either a list of scalar Time objects (backward-compatible) or a
    single array-valued Time (preferred — avoids Python-loop overhead).

    Internally converts a list of scalar Times into a single array-valued
    Time so that skyfield calls SGP4 in one vectorized batch rather than
    looping in Python.

    Args:
        satellite: a skyfield EarthSatellite object.
        times:     list of skyfield Time objects, or a single array-valued
                   Time (e.g. ``ts.utc(2004, 10, 22, 0, 0, np.arange(N))``).

    Returns:
        List of StateVectorTEME, one per epoch, in the same order as *times*.
    """
    from skyfield.api import load
    from skyfield.framelib import true_equator_and_equinox_of_date as teme_frame

    # --- Normalise input to a single array-valued Time ---
    if isinstance(times, list):
        if len(times) == 0:
            return []
        ts = load.timescale()
        jd_array = np.array([t.whole for t in times])
        fr_array = np.array([t.tai_fraction for t in times])
        # Reconstruct an array-valued Time from the TAI Julian-date pairs.
        t_array = ts.tai_jd(jd_array, fr_array)
    else:
        t_array = times  # already array-valued

    # --- Batch propagation ---
    geocentric = satellite.at(t_array)
    pos_teme, vel_teme = geocentric.frame_xyz_and_velocity(teme_frame)
    pos_km = np.asarray(pos_teme.km, dtype=float)      # shape (3, N)
    vel_km_s = np.asarray(vel_teme.km_per_s, dtype=float)  # shape (3, N)

    # Handle the edge case where skyfield returns 1-D (single epoch).
    if pos_km.ndim == 1:
        pos_km = pos_km[:, np.newaxis]
        vel_km_s = vel_km_s[:, np.newaxis]

    n = pos_km.shape[1]

    # --- Wrap each epoch into a StateVectorTEME ---
    # Build individual scalar Time objects for each state.
    results: list[StateVectorTEME] = []
    for i in range(n):
        # Extract scalar Time for this index.
        if isinstance(times, list):
            t_i = times[i]
        else:
            ts_local = load.timescale()
            t_i = ts_local.tai_jd(t_array.whole[i], t_array.tai_fraction[i])

        state = StateVectorTEME(
            epoch=t_i,
            pos_teme_km=pos_km[:, i].copy(),
            vel_teme_km_s=vel_km_s[:, i].copy(),
            satellite_name=satellite.name,
        )
        results.append(state)

    return results


def propagate_batch_teme(
    satellite: EarthSatellite, t_array: Time,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Propagate *satellite* over an array-valued Time and return raw numpy
    arrays — no per-timestep dataclass wrapping.

    This is the performance-critical path for screening's inner loop where
    we need positions for many timesteps but don't need individual
    StateVectorTEME objects.

    Args:
        satellite: a skyfield EarthSatellite object.
        t_array:   an array-valued skyfield Time (e.g. from
                   ``ts.utc(2004, 10, 22, 0, 0, np.arange(N))``).

    Returns:
        (pos_teme_km, vel_teme_km_s):
            pos_teme_km:   numpy array of shape (N, 3), positions in TEME [km].
            vel_teme_km_s: numpy array of shape (N, 3), velocities in TEME [km/s].
    """
    from skyfield.framelib import true_equator_and_equinox_of_date as teme_frame

    geocentric = satellite.at(t_array)
    pos_teme, vel_teme = geocentric.frame_xyz_and_velocity(teme_frame)

    # skyfield returns shape (3,) for scalar or (3, N) for array —
    # transpose to (N, 3) for natural row-per-timestep indexing.
    pos_km = np.asarray(pos_teme.km, dtype=float)
    vel_km_s = np.asarray(vel_teme.km_per_s, dtype=float)

    if pos_km.ndim == 1:
        # Single epoch → shape (1, 3)
        return pos_km[np.newaxis, :], vel_km_s[np.newaxis, :]

    return pos_km.T, vel_km_s.T  # (N, 3)
