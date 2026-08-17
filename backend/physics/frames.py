"""
frames.py — Reference frame transforms for orbital state vectors.

Converts between the three frames used in this pipeline:
  - TEME  (True Equator Mean Equinox)  — SGP4's native output frame
  - ECI   (Earth-Centred Inertial)     — GCRS/J2000-like; used for Pc math
  - ECEF  (Earth-Centred Earth-Fixed)  — ITRS; used for lat/long/alt and viz

All transforms use skyfield's built-in rotation machinery. Do NOT hand-roll
rotation matrices — that's where silent frame-mismatch bugs live.

Unit convention (enforced via variable naming throughout this module):
  - Positions:  km  (kilometres)
  - Velocities: km/s (kilometres per second)

Frame convention (enforced via variable naming):
  - _teme_  → TEME frame
  - _eci_   → ECI/GCRS frame (skyfield GCRS ≈ J2000 geocentric)
  - _ecef_  → ECEF/ITRS frame

See CLAUDE.md §1.5: "A variable holding position data should make its frame
unambiguous from its name or type."
"""

from dataclasses import dataclass

import numpy as np
from skyfield import framelib
from skyfield.api import EarthSatellite, Time, wgs84
from skyfield.positionlib import Geocentric

from .propagation import StateVectorTEME


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class StateVectorECI:
    """
    Position and velocity in the ECI (GCRS) frame.

    Attributes:
        epoch:         skyfield Time object for this state.
        pos_eci_km:    3-element numpy array, position in ECI/GCRS [km].
        vel_eci_km_s:  3-element numpy array, velocity in ECI/GCRS [km/s].
        satellite_name: human-readable label for logging/debugging.
    """
    epoch: Time
    pos_eci_km: np.ndarray    # shape (3,), units: km
    vel_eci_km_s: np.ndarray  # shape (3,), units: km/s
    satellite_name: str = ""

    def __repr__(self) -> str:
        r = np.linalg.norm(self.pos_eci_km)
        return (
            f"StateVectorECI(sat={self.satellite_name!r}, "
            f"|r|={r:.3f} km, epoch={self.epoch.utc_iso()})"
        )


@dataclass
class StateVectorECEF:
    """
    Position and velocity in the ECEF (ITRS) frame.

    Attributes:
        epoch:          skyfield Time object for this state.
        pos_ecef_km:    3-element numpy array, position in ECEF/ITRS [km].
        vel_ecef_km_s:  3-element numpy array, velocity in ECEF/ITRS [km/s].
        satellite_name: human-readable label for logging/debugging.
    """
    epoch: Time
    pos_ecef_km: np.ndarray    # shape (3,), units: km
    vel_ecef_km_s: np.ndarray  # shape (3,), units: km/s
    satellite_name: str = ""

    def __repr__(self) -> str:
        r = np.linalg.norm(self.pos_ecef_km)
        return (
            f"StateVectorECEF(sat={self.satellite_name!r}, "
            f"|r|={r:.3f} km, epoch={self.epoch.utc_iso()})"
        )


@dataclass
class GeodeticPosition:
    """
    Geodetic (geographic) position derived from ECEF.

    Attributes:
        epoch:           skyfield Time object.
        lat_deg:         geodetic latitude [degrees, +N].
        lon_deg:         geodetic longitude [degrees, +E].
        alt_km:          altitude above WGS-84 ellipsoid [km].
        satellite_name:  human-readable label.
    """
    epoch: Time
    lat_deg: float   # degrees, positive north
    lon_deg: float   # degrees, positive east
    alt_km: float    # km above WGS-84 ellipsoid
    satellite_name: str = ""

    def __repr__(self) -> str:
        return (
            f"GeodeticPosition(sat={self.satellite_name!r}, "
            f"lat={self.lat_deg:.4f}°, lon={self.lon_deg:.4f}°, "
            f"alt={self.alt_km:.2f} km, epoch={self.epoch.utc_iso()})"
        )


# ---------------------------------------------------------------------------
# Transform functions
# ---------------------------------------------------------------------------

def teme_to_eci(state_teme: StateVectorTEME, satellite: EarthSatellite) -> StateVectorECI:
    """
    Convert a TEME state vector to ECI (GCRS) frame.

    skyfield's .at(t) already computes position in GCRS internally; we re-use
    that path directly rather than doing a manual TEME→GCRS rotation.
    The .frame_xyz_and_velocity(ICRS) gives the geocentric ICRS/GCRS position,
    which is the ECI frame we use for Pc geometry calculations.

    Args:
        state_teme:  StateVectorTEME from propagation.py.
        satellite:   the same EarthSatellite object used to propagate.

    Returns:
        StateVectorECI with pos/vel in ECI/GCRS frame [km, km/s].
    """
    t = state_teme.epoch
    geocentric = satellite.at(t)

    # GCRS ≈ J2000 geocentric inertial — this is what we call "ECI" throughout.
    pos_eci, vel_eci = geocentric.frame_xyz_and_velocity(framelib.ICRS)

    pos_eci_km = np.asarray(pos_eci.km, dtype=float)
    vel_eci_km_s = np.asarray(vel_eci.km_per_s, dtype=float)

    result = StateVectorECI(
        epoch=t,
        pos_eci_km=pos_eci_km,
        vel_eci_km_s=vel_eci_km_s,
        satellite_name=state_teme.satellite_name,
    )

    r_km = np.linalg.norm(pos_eci_km)
    print(
        f"[frames] TEME->ECI  {state_teme.satellite_name!r} @ {t.utc_iso()} | "
        f"|r_eci|={r_km:.3f} km"
    )
    return result


def teme_to_ecef(state_teme: StateVectorTEME, satellite: EarthSatellite) -> StateVectorECEF:
    """
    Convert a TEME state vector to ECEF (ITRS) frame.

    Args:
        state_teme:  StateVectorTEME from propagation.py.
        satellite:   the same EarthSatellite object used to propagate.

    Returns:
        StateVectorECEF with pos/vel in ECEF/ITRS frame [km, km/s].
    """
    t = state_teme.epoch
    geocentric = satellite.at(t)

    # ITRS is skyfield's ECEF-equivalent frame.
    pos_ecef, vel_ecef = geocentric.frame_xyz_and_velocity(framelib.itrs)

    pos_ecef_km = np.asarray(pos_ecef.km, dtype=float)
    vel_ecef_km_s = np.asarray(vel_ecef.km_per_s, dtype=float)

    result = StateVectorECEF(
        epoch=t,
        pos_ecef_km=pos_ecef_km,
        vel_ecef_km_s=vel_ecef_km_s,
        satellite_name=state_teme.satellite_name,
    )

    r_km = np.linalg.norm(pos_ecef_km)
    print(
        f"[frames] TEME->ECEF {state_teme.satellite_name!r} @ {t.utc_iso()} | "
        f"|r_ecef|={r_km:.3f} km"
    )
    return result


def ecef_to_geodetic(state_ecef: StateVectorECEF, satellite: EarthSatellite) -> GeodeticPosition:
    """
    Convert an ECEF state vector to geodetic lat/long/altitude (WGS-84).

    Uses skyfield's wgs84.geographic_position_of() which correctly handles
    the WGS-84 ellipsoid — do not use a spherical approximation here.

    Args:
        state_ecef:  StateVectorECEF from teme_to_ecef().
        satellite:   the same EarthSatellite object used to propagate.

    Returns:
        GeodeticPosition with lat [deg +N], lon [deg +E], alt [km].
    """
    t = state_ecef.epoch
    geocentric = satellite.at(t)

    # wgs84.geographic_position_of returns a GeographicPosition with
    # .latitude, .longitude (Angle objects) and .elevation (Distance).
    geo_pos = wgs84.geographic_position_of(geocentric)

    lat_deg = float(geo_pos.latitude.degrees)
    lon_deg = float(geo_pos.longitude.degrees)
    alt_km = float(geo_pos.elevation.km)

    result = GeodeticPosition(
        epoch=t,
        lat_deg=lat_deg,
        lon_deg=lon_deg,
        alt_km=alt_km,
        satellite_name=state_ecef.satellite_name,
    )

    print(
        f"[frames] Geodetic   {state_ecef.satellite_name!r} @ {t.utc_iso()} | "
        f"lat={lat_deg:.4f}°  lon={lon_deg:.4f}°  alt={alt_km:.2f} km"
    )
    return result


def teme_to_geodetic(state_teme: StateVectorTEME, satellite: EarthSatellite) -> GeodeticPosition:
    """
    Convenience: TEME → ECEF → Geodetic in one call.

    Args:
        state_teme:  StateVectorTEME from propagation.py.
        satellite:   the same EarthSatellite object.

    Returns:
        GeodeticPosition with lat/lon/alt.
    """
    state_ecef = teme_to_ecef(state_teme, satellite)
    return ecef_to_geodetic(state_ecef, satellite)
