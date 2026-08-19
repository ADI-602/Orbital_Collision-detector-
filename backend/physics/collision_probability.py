"""
collision_probability.py — Collision probability (Pc) via the 2D/encounter-plane
(B-plane) method.

Method reference:
  Foster, J. (1992). "A Parametric Analysis of Orbital Debris Collision
    Probability and Maneuver Rate for Space Vehicles." NASA JSC-25898.
  Alfriend, K. & Akella, M. et al. (1999). "Probability of Collision Error
    Analysis." Space Debris, vol.1, no.1:21-35.
  Klinkrad, H. et al. (2005). "Collision Avoidance for Operational ESA
    Satellites." ESA SP-587 (SDC4-paper49), Equations 4-6.

The 2D method is valid because:
  - LEO conjunction encounter windows are very short (seconds)
  - Over that window, relative motion is approximately rectilinear
  - This collapses the 3D probability integral to 2D in the B-plane
    (the plane perpendicular to relative velocity at TCA)

Covariance source for TLE-based objects:
  - TLEs carry no covariance. This module provides _tle_covariance_rtn()
    which assigns a diagonal 3x3 covariance in the RTN (Radial/Transversal/
    Normal) frame from the ESA SDC4 Table 1 lookup, based on the object's
    orbital class (inclination, perigee altitude, eccentricity).
  - The RTN covariance is then rotated to ECI at TCA using the object's
    own state vector. No hardcoding of specific satellite values.

Conservative-bias principle (per bob.md §1.4):
  - Diagonal-only covariance (off-diagonals omitted) slightly overestimates
    uncertainty, biasing Pc upward.
  - Hard-body radius is passed by caller; use larger estimate when uncertain.
  - When covariance class is ambiguous, use the most conservative row.

Unit convention throughout: km, km/s, km^2.
"""

import logging

import numpy as np
from scipy.integrate import dblquad

from .frames import StateVectorECI

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# SDC4 Table 1 — TLE covariance lookup (near-circular LEO, e < 0.1)
#
# Source: Klinkrad et al. 2005 (SDC4-paper49), Table 1.
# 1-sigma position uncertainties in RTN frame (Radial, Transversal, Normal).
# Units: metres (converted to km at use time).
#
# Partitioned by inclination class for H_pe <= 800 km, e <= 0.1.
# For H_pe > 800 km or e > 0.1, we use the most conservative row with a log
# warning — better than silently returning wrong numbers.
# ---------------------------------------------------------------------------

# (sigma_R_m, sigma_T_m, sigma_N_m) for each inclination band
_SDC4_TABLE1_LEO = {
    # inclination class: (sigma_R m, sigma_T m, sigma_N m)
    "i_lt_30":  (102.0, 419.0, 122.0),   # i < 30 deg
    "i_30_60":  (129.0, 434.0, 163.0),   # 30 <= i <= 60 deg
    "i_gt_60":  (104.0, 556.0, 139.0),   # i > 60 deg
}

# Perigee altitude threshold for the Table 1 coverage [km]
_SDC4_LEO_HMAX_KM = 800.0
# Eccentricity threshold
_SDC4_LEO_EMAX = 0.1


def _tle_covariance_rtn(
    inclination_deg: float,
    perigee_alt_km: float,
    eccentricity: float,
) -> np.ndarray:
    """
    Return a 3x3 diagonal position covariance matrix in the RTN frame [km^2]
    for a TLE-catalogued object, using the ESA SDC4 Table 1 lookup.

    The lookup is based solely on orbital class — no hardcoding of specific
    satellite identities. Any two objects in the same orbital class receive
    the same covariance. This is the standard approach for TLE-based Pc
    when no tracked covariance is available.

    Args:
        inclination_deg: orbital inclination [degrees].
        perigee_alt_km:  perigee altitude above Earth surface [km].
        eccentricity:    orbital eccentricity (dimensionless).

    Returns:
        3x3 numpy array, diagonal, units km^2.
        Order of axes: [R (radial), T (transversal/along-track), N (normal)].

    Conservative-bias note:
        If the object falls outside the Table 1 coverage (H_pe > 800 km or
        e > 0.1), the i > 60 deg row is used as a conservative fallback —
        it has the largest along-track uncertainty (556 m) and thus the
        largest B-plane covariance, biasing Pc upward.
    """
    # Select inclination class
    outside_table = False

    if perigee_alt_km > _SDC4_LEO_HMAX_KM or eccentricity > _SDC4_LEO_EMAX:
        outside_table = True
        # Conservative fallback: largest uncertainty class
        sigma_R_m, sigma_T_m, sigma_N_m = _SDC4_TABLE1_LEO["i_gt_60"]
        logger.warning(
            "_tle_covariance_rtn: object outside Table 1 coverage "
            "(H_pe=%.1f km, e=%.4f) — using conservative i>60 row as fallback.",
            perigee_alt_km, eccentricity,
        )
    else:
        if inclination_deg < 30.0:
            key = "i_lt_30"
        elif inclination_deg <= 60.0:
            key = "i_30_60"
        else:
            key = "i_gt_60"
        sigma_R_m, sigma_T_m, sigma_N_m = _SDC4_TABLE1_LEO[key]

    # Convert m -> km, then square for variance
    sigma_R_km = sigma_R_m / 1000.0
    sigma_T_km = sigma_T_m / 1000.0
    sigma_N_km = sigma_N_m / 1000.0

    C_rtn_km2 = np.diag([sigma_R_km**2, sigma_T_km**2, sigma_N_km**2])

    logger.debug(
        "_tle_covariance_rtn: i=%.2f deg, H_pe=%.1f km, e=%.4f -> "
        "sigma_RTN=(%.1f, %.1f, %.1f) m%s",
        inclination_deg, perigee_alt_km, eccentricity,
        sigma_R_m, sigma_T_m, sigma_N_m,
        " [EXTRAPOLATED]" if outside_table else "",
    )

    return C_rtn_km2


def _rtn_to_eci_rotation(pos_eci_km: np.ndarray, vel_eci_km_s: np.ndarray) -> np.ndarray:
    """
    Compute the 3x3 rotation matrix from RTN (Radial/Transversal/Normal) to ECI.

    RTN axes:
      R-hat = pos_eci / |pos_eci|               (radial outward)
      N-hat = (pos_eci x vel_eci) / |...|       (orbit normal)
      T-hat = N-hat x R-hat                      (along-track, completes RH system)

    Args:
        pos_eci_km:   position in ECI [km], shape (3,).
        vel_eci_km_s: velocity in ECI [km/s], shape (3,).

    Returns:
        3x3 rotation matrix M such that v_eci = M @ v_rtn.
    """
    R_hat = pos_eci_km / np.linalg.norm(pos_eci_km)
    h = np.cross(pos_eci_km, vel_eci_km_s)
    N_hat = h / np.linalg.norm(h)
    T_hat = np.cross(N_hat, R_hat)

    # Columns are the RTN basis vectors expressed in ECI
    M = np.column_stack([R_hat, T_hat, N_hat])
    return M


def covariance_rtn_to_eci(
    C_rtn_km2: np.ndarray,
    pos_eci_km: np.ndarray,
    vel_eci_km_s: np.ndarray,
) -> np.ndarray:
    """
    Rotate a 3x3 covariance matrix from RTN frame to ECI frame.

    C_eci = M @ C_rtn @ M^T

    Args:
        C_rtn_km2:    3x3 covariance in RTN frame [km^2].
        pos_eci_km:   object position in ECI at the epoch of interest [km].
        vel_eci_km_s: object velocity in ECI at the epoch of interest [km/s].

    Returns:
        3x3 covariance in ECI frame [km^2].
    """
    M = _rtn_to_eci_rotation(pos_eci_km, vel_eci_km_s)
    return M @ C_rtn_km2 @ M.T


def compute_pc(
    state1: StateVectorECI,
    state2: StateVectorECI,
    cov1_eci_km2: np.ndarray,
    cov2_eci_km2: np.ndarray,
    hard_body_radius_km: float,
    epsabs: float = 1e-8,
    epsrel: float = 1e-8,
) -> float:
    """
    Compute collision probability Pc using the 2D/B-plane encounter-plane method.

    Both state vectors must be at the same epoch (TCA). The combined position
    covariance is projected onto the B-plane (perpendicular to relative velocity)
    and the 2D Gaussian is integrated over the circular hard-body cross-section.

    Reference: Klinkrad et al. 2005 (SDC4-paper49) Equations 4-6;
               Alfriend & Akella 1999.

    Args:
        state1:              ECI state vector of object 1 at TCA.
        state2:              ECI state vector of object 2 at TCA.
        cov1_eci_km2:        3x3 position covariance of object 1 in ECI [km^2].
        cov2_eci_km2:        3x3 position covariance of object 2 in ECI [km^2].
        hard_body_radius_km: combined hard-body radius R_c = R_1 + R_2 [km].
        epsabs:              absolute tolerance for numerical integration.
        epsrel:              relative tolerance for numerical integration.

    Returns:
        Pc as a float in [0, 1].

    Raises:
        ValueError: if the relative velocity at TCA is zero (degenerate case).
    """
    pos1 = state1.pos_eci_km
    vel1 = state1.vel_eci_km_s
    pos2 = state2.pos_eci_km
    vel2 = state2.vel_eci_km_s

    # -----------------------------------------------------------------------
    # Step 1: Relative geometry at TCA
    # -----------------------------------------------------------------------
    delta_r = pos2 - pos1          # miss vector [km]
    delta_v = vel2 - vel1          # relative velocity [km/s]
    miss_dist_km = np.linalg.norm(delta_r)
    rel_speed_km_s = np.linalg.norm(delta_v)

    if rel_speed_km_s < 1e-9:
        raise ValueError(
            f"Relative velocity at TCA is effectively zero ({rel_speed_km_s:.2e} km/s). "
            "Cannot define a B-plane for a stationary conjunction."
        )

    logger.debug(
        "compute_pc: miss_dist=%.4f km, rel_speed=%.4f km/s, R_c=%.6f km",
        miss_dist_km, rel_speed_km_s, hard_body_radius_km,
    )

    # -----------------------------------------------------------------------
    # Step 2: Combined covariance (SDC4 Eq. 4)
    #   C = C1 + C2   (uncorrelated position errors — standard assumption)
    # -----------------------------------------------------------------------
    C_combined = cov1_eci_km2 + cov2_eci_km2

    # -----------------------------------------------------------------------
    # Step 3: Project combined covariance onto B-plane (SDC4 Eq. 5 setup)
    #   B-plane is perpendicular to relative velocity at TCA.
    #   Projection matrix: P = I - v_hat * v_hat^T
    # -----------------------------------------------------------------------
    v_hat = delta_v / rel_speed_km_s
    P = np.eye(3) - np.outer(v_hat, v_hat)          # 3x3 B-plane projector
    C_B_3x3 = P @ C_combined @ P.T                  # rank-2, still 3x3

    # -----------------------------------------------------------------------
    # Step 4: Build an orthonormal 2D basis for the B-plane
    #   Choose b1 perpendicular to v_hat; b2 = v_hat x b1 (right-handed)
    # -----------------------------------------------------------------------
    # Find a vector not parallel to v_hat for Gram-Schmidt
    reference = np.array([0.0, 0.0, 1.0])
    if abs(np.dot(v_hat, reference)) > 0.9:
        reference = np.array([0.0, 1.0, 0.0])

    b1 = reference - np.dot(reference, v_hat) * v_hat
    b1 /= np.linalg.norm(b1)
    b2 = np.cross(v_hat, b1)
    b2 /= np.linalg.norm(b2)

    # 2x2 covariance in B-plane basis
    C_B = np.array([
        [b1 @ C_B_3x3 @ b1, b1 @ C_B_3x3 @ b2],
        [b2 @ C_B_3x3 @ b1, b2 @ C_B_3x3 @ b2],
    ])

    # 2D miss vector in B-plane (project delta_r, then remove velocity component)
    delta_r_bplane = P @ delta_r
    mu_B = np.array([b1 @ delta_r_bplane, b2 @ delta_r_bplane])

    logger.debug(
        "compute_pc: C_B eigenvalues=%.4f,%.4f km^2, mu_B=(%.4f,%.4f) km",
        *np.linalg.eigvalsh(C_B), *mu_B,
    )

    # -----------------------------------------------------------------------
    # Step 5: Numerical 2D Gaussian integral over hard-body disk (SDC4 Eq. 5)
    #
    #   Pc = (1 / (2*pi*sqrt(det(C_B))))
    #        * int int_{|r|<=R_c}
    #          exp(-0.5 * (r - mu_B)^T C_B^{-1} (r - mu_B)) dx dy
    #
    #   Integration domain: disk of radius R_c centred at origin.
    #   The Gaussian is centred at the miss vector mu_B.
    # -----------------------------------------------------------------------
    det_C_B = np.linalg.det(C_B)
    if det_C_B <= 0:
        raise ValueError(
            f"B-plane covariance determinant is non-positive ({det_C_B:.2e}). "
            "Check that the combined covariance matrix is positive definite."
        )

    C_B_inv = np.linalg.inv(C_B)
    prefactor = 1.0 / (2.0 * np.pi * np.sqrt(det_C_B))
    Rc = hard_body_radius_km

    def _integrand(y: float, x: float) -> float:
        dr = np.array([x, y]) - mu_B
        return prefactor * np.exp(-0.5 * (dr @ C_B_inv @ dr))

    Pc, integration_err = dblquad(
        _integrand,
        -Rc, Rc,
        lambda x: -np.sqrt(max(Rc**2 - x**2, 0.0)),
        lambda x:  np.sqrt(max(Rc**2 - x**2, 0.0)),
        epsabs=epsabs,
        epsrel=epsrel,
    )

    logger.info(
        "compute_pc: Pc=%.6e  (integration_err=%.2e, miss=%.4f km, "
        "R_c=%.6f km, sat1=%r, sat2=%r)",
        Pc, integration_err, miss_dist_km, hard_body_radius_km,
        state1.satellite_name, state2.satellite_name,
    )

    return float(Pc)
