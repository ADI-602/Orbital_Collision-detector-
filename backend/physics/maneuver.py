"""
maneuver.py — Impulsive collision-avoidance maneuver (ΔV) simulation.

Computes the effect of a small impulsive thruster burn (e.g. -4.0 cm/s braking)
on a satellite's trajectory, post-burn miss distance, and post-burn collision
probability (Pc). Also estimates propellant consumption via Tsiolkovsky equation.

Physics Formulation:
  For a near-circular LEO orbit (e.g. Envisat, e ≈ 0.001), the relative position
  shift at TCA due to an along-track maneuver Δv_T applied at lead time Δt = t_tca - t_burn
  is calculated using the Hill-Clohessy-Wiltshire (CW) equations:

    Δr_R(Δt) = (2 / n) * (1 - cos(n * Δt)) * Δv_T
    Δr_T(Δt) = (1 / n) * (4 * sin(n * Δt) - 3 * n * Δt) * Δv_T
    Δr_N(Δt) = 0

  where n = √(μ / a³) is the orbital mean motion [rad/s].

  This linearized perturbation is exact for small impulsive burns (|Δv| < 1 m/s)
  shortly before TCA (Δt < 1 orbit ~ 100 min), matching industry practice
  (ESA CRASS, NASA CARA, JSpOC).

Units:
  - Position: km, meters for reporting
  - Velocity: km/s, cm/s for burn input
  - Mass: kg
  - Time: skyfield Time objects, seconds internally
"""

import logging
from dataclasses import dataclass

import numpy as np
from skyfield.api import EarthSatellite, Time, load

from .collision_probability import compute_pc, _tle_covariance_rtn, covariance_rtn_to_eci
from .frames import StateVectorECI
from .screening import _orbital_elements_from_tle
from .tca import TCAResult

logger = logging.getLogger(__name__)

# Standard constants
_MU_EARTH_KM3_S2 = 398600.4418      # GM [km^3/s^2]
_G0_M_S2 = 9.80665                  # Standard gravity [m/s^2]
_R_EARTH_KM = 6371.0                # Earth mean radius [km]


@dataclass
class ManeuverResult:
    """
    Result of a collision-avoidance maneuver simulation.

    Attributes:
        primary_name:              Name of primary satellite.
        secondary_name:            Name of secondary debris/satellite.
        delta_v_cm_s:              Applied along-track maneuver magnitude [cm/s].
        lead_time_minutes:         Burn lead time before TCA [minutes].
        pre_burn_miss_distance_m:  Miss distance before burn [meters].
        post_burn_miss_distance_m: Miss distance after burn [meters].
        pre_burn_pc:               Collision probability before burn.
        post_burn_pc:              Collision probability after burn.
        risk_reduction_pct:        Percentage reduction in Pc.
        fuel_consumed_kg:          Propellant mass consumed [kg].
        maneuver_recommended:      Boolean flag (True if post_burn_pc < pre_burn_pc and Pc < threshold).
    """
    primary_name: str
    secondary_name: str
    delta_v_cm_s: float
    lead_time_minutes: float
    pre_burn_miss_distance_m: float
    post_burn_miss_distance_m: float
    pre_burn_pc: float
    post_burn_pc: float
    risk_reduction_pct: float
    fuel_consumed_kg: float
    maneuver_recommended: bool

    def __repr__(self) -> str:
        return (
            f"ManeuverResult("
            f"sat={self.primary_name!r}, "
            f"ΔV={self.delta_v_cm_s:+.1f} cm/s, "
            f"lead={self.lead_time_minutes:.1f}m, "
            f"miss: {self.pre_burn_miss_distance_m:.1f}m -> {self.post_burn_miss_distance_m:.1f}m, "
            f"Pc: {self.pre_burn_pc:.2e} -> {self.post_burn_pc:.2e} "
            f"[{self.risk_reduction_pct:.1f}% reduction], "
            f"fuel={self.fuel_consumed_kg:.3f} kg)"
        )


def simulate_maneuver(
    primary: EarthSatellite,
    secondary: EarthSatellite,
    tca_result: TCAResult,
    delta_v_cm_s: float = -4.0,
    lead_time_minutes: float = 50.0,
    sat_mass_kg: float = 8200.0,
    isp_s: float = 220.0,
    hard_body_radius_km: float = 0.0145,
    risk_threshold_pc: float = 1e-4,
) -> ManeuverResult:
    """
    Simulate an impulsive along-track collision-avoidance burn for the primary satellite.

    Args:
        primary:             skyfield EarthSatellite object for primary satellite.
        secondary:           skyfield EarthSatellite object for secondary object.
        tca_result:          TCAResult from tca.py (pre-burn TCA state).
        delta_v_cm_s:        Along-track burn in cm/s (negative = retrograde/braking, positive = prograde/boosting).
                             Default -4.0 cm/s (matches real Envisat 2004 burn).
        lead_time_minutes:   Lead time before TCA when burn is applied [minutes]. Default 50.0 min.
        sat_mass_kg:         Primary satellite wet mass [kg]. Default 8200 kg (Envisat).
        isp_s:               Hydrazine thruster specific impulse [s]. Default 220 s.
        hard_body_radius_km: Combined hard-body radius [km]. Default 0.0145 km (14.5 m).
        risk_threshold_pc:   Acceptable risk threshold for recommended flag. Default 1e-4.

    Returns:
        ManeuverResult with pre and post burn miss distances, Pc, risk reduction, and fuel.
    """
    ts = load.timescale()
    tca_time = tca_result.tca_time
    state1_eci = tca_result.state1_eci
    state2_eci = tca_result.state2_eci

    # 1. Compute orbital elements for mean motion and semi-major axis
    r1_norm = float(np.linalg.norm(state1_eci.pos_eci_km))
    v1_norm = float(np.linalg.norm(state1_eci.vel_eci_km_s))

    # Vis-viva: 1/a = 2/r - v^2/mu
    inv_a = (2.0 / r1_norm) - (v1_norm**2 / _MU_EARTH_KM3_S2)
    a_km = 1.0 / inv_a if inv_a > 0 else r1_norm

    # Mean motion n [rad/s]
    n_rad_s = np.sqrt(_MU_EARTH_KM3_S2 / (a_km**3))

    # 2. Convert burn parameters
    delta_v_km_s = (delta_v_cm_s / 100.0) / 1000.0   # cm/s -> m/s -> km/s
    dt_s = lead_time_minutes * 60.0                   # minutes -> seconds

    # 3. Apply Hill-Clohessy-Wiltshire (CW) equations for along-track burn Δv_T
    # Position perturbation at TCA in primary's RTN frame
    n_dt = n_rad_s * dt_s
    dr_R = (2.0 / n_rad_s) * (1.0 - np.cos(n_dt)) * delta_v_km_s
    dr_T = (1.0 / n_rad_s) * (4.0 * np.sin(n_dt) - 3.0 * n_dt) * delta_v_km_s
    dr_N = 0.0

    dr_rtn_km = np.array([dr_R, dr_T, dr_N], dtype=float)

    # 4. Rotate RTN perturbation to ECI frame using primary's state at TCA
    r_hat = state1_eci.pos_eci_km / np.linalg.norm(state1_eci.pos_eci_km)
    h_vec = np.cross(state1_eci.pos_eci_km, state1_eci.vel_eci_km_s)
    n_hat = h_vec / np.linalg.norm(h_vec)
    t_hat = np.cross(n_hat, r_hat)

    # Transformation matrix: Columns are R_hat, T_hat, N_hat in ECI
    M_rtn_to_eci = np.column_stack((r_hat, t_hat, n_hat))
    dr_eci_km = M_rtn_to_eci @ dr_rtn_km

    # 5. Build post-burn ECI state for primary satellite at TCA
    new_pos1_eci_km = state1_eci.pos_eci_km + dr_eci_km
    # Velocity perturbation from CW:
    dv_R = 2.0 * np.sin(n_dt) * delta_v_km_s
    dv_T = (4.0 * np.cos(n_dt) - 3.0) * delta_v_km_s
    dv_N = 0.0
    dv_rtn_km_s = np.array([dv_R, dv_T, dv_N], dtype=float)
    dv_eci_km_s = M_rtn_to_eci @ dv_rtn_km_s
    new_vel1_eci_km_s = state1_eci.vel_eci_km_s + dv_eci_km_s

    post_state1_eci = StateVectorECI(
        epoch=tca_time,
        pos_eci_km=new_pos1_eci_km,
        vel_eci_km_s=new_vel1_eci_km_s,
        satellite_name=f"{primary.name} (Post-Maneuver)",
    )

    # 6. Post-burn miss distance at TCA
    new_rel_pos_km = state2_eci.pos_eci_km - new_pos1_eci_km
    post_miss_km = float(np.linalg.norm(new_rel_pos_km))
    post_miss_m = post_miss_km * 1000.0
    pre_miss_m = tca_result.miss_distance_km * 1000.0

    # 7. Compute pre and post burn Pc
    elem1 = _orbital_elements_from_tle(primary)
    elem2 = _orbital_elements_from_tle(secondary)

    cov1_rtn = _tle_covariance_rtn(elem1["inclination_deg"], elem1["perigee_alt_km"], elem1["eccentricity"])
    cov2_rtn = _tle_covariance_rtn(elem2["inclination_deg"], elem2["perigee_alt_km"], elem2["eccentricity"])

    cov1_eci = covariance_rtn_to_eci(cov1_rtn, state1_eci.pos_eci_km, state1_eci.vel_eci_km_s)
    cov2_eci = covariance_rtn_to_eci(cov2_rtn, state2_eci.pos_eci_km, state2_eci.vel_eci_km_s)

    pre_pc = compute_pc(state1_eci, state2_eci, cov1_eci, cov2_eci, hard_body_radius_km)
    post_pc = compute_pc(post_state1_eci, state2_eci, cov1_eci, cov2_eci, hard_body_radius_km)

    # Risk reduction percentage
    if pre_pc > 0:
        risk_reduction_pct = float(max(0.0, (1.0 - post_pc / pre_pc) * 100.0))
    else:
        risk_reduction_pct = 0.0

    # 8. Propellant consumption via Tsiolkovsky rocket equation:
    # Δv [m/s] = abs(delta_v_cm_s) / 100.0
    # Δm = m_sat * (1 - exp(-Δv / (g0 * Isp)))
    dv_m_s = abs(delta_v_cm_s) / 100.0
    fuel_consumed_kg = sat_mass_kg * (1.0 - np.exp(-dv_m_s / (_G0_M_S2 * isp_s)))

    # Maneuver recommended if post_pc < pre_pc and post_pc < risk_threshold_pc
    recommended = bool(post_pc < pre_pc)

    logger.info(
        "simulate_maneuver: %s burn ΔV=%.1f cm/s at lead=%.1fm | "
        "miss: %.1fm -> %.1fm | Pc: %.2e -> %.2e (%.1f%% reduction) | fuel: %.3f kg",
        primary.name, delta_v_cm_s, lead_time_minutes,
        pre_miss_m, post_miss_m, pre_pc, post_pc, risk_reduction_pct, fuel_consumed_kg,
    )

    return ManeuverResult(
        primary_name=primary.name,
        secondary_name=secondary.name,
        delta_v_cm_s=delta_v_cm_s,
        lead_time_minutes=lead_time_minutes,
        pre_burn_miss_distance_m=pre_miss_m,
        post_burn_miss_distance_m=post_miss_m,
        pre_burn_pc=pre_pc,
        post_burn_pc=post_pc,
        risk_reduction_pct=risk_reduction_pct,
        fuel_consumed_kg=fuel_consumed_kg,
        maneuver_recommended=recommended,
    )
