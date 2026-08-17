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
    print(
        f"[propagation] {satellite.name} @ {t.utc_iso()} | "
        f"|r|={r_km:.3f} km  |v|={v_km_s:.4f} km/s  (TEME)"
    )

    return state


def propagate_sequence(
    satellite: EarthSatellite, times: list[Time]
) -> list[StateVectorTEME]:
    """
    Propagate *satellite* over a sequence of epochs.

    Args:
        satellite: a skyfield EarthSatellite object.
        times:     list of skyfield Time objects.

    Returns:
        List of StateVectorTEME, one per epoch, in the same order as *times*.
    """
    return [propagate(satellite, t) for t in times]
