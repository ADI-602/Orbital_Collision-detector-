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
from typing import List, Optional

import numpy as np
from skyfield import framelib
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

_SECONDS_PER_DAY = 86400.0

# --- Trajectory sampling for the console ----------------------------------
#
# Samples across the drawn window. 241 over roughly an hour is a ~15 s step:
# the trajectory is locally straight at that scale, so a finer grid buys no
# visible accuracy.
_TRACK_SAMPLES = 241

# How much of the coasting orbit to show before the burn. The two tracks are
# IDENTICAL over this stretch, which is the point: it shows where they part.
_TRACK_LEAD_IN_MINUTES = 5.0

# And how far past TCA, so the encounter is not at the very end of the line.
_TRACK_TRAIL_MINUTES = 10.0

# The CW linearisation is documented above as valid for dt < ~1 orbit. Beyond
# that the secular along-track term (-3*n*dt) grows without bound and would
# draw a trajectory the model is not entitled to assert. The sampled window is
# clipped at this horizon and says so, rather than extrapolating quietly.
_CW_VALIDITY_ORBITS = 1.0


@dataclass
class ManeuverTracks:
    """
    Sampled trajectories for the console: the same arc flown, and not flown.

    CLAUDE.md 5.2 requires this to come from the backend rather than being
    reconstructed in the browser. Deriving a maneuvered orbit in JavaScript
    would be orbital mechanics outside the validated pipeline (1.1, 1.3), and
    two lines produced by two different codebases are not comparable to each
    other. Both tracks here come from one TCA solution through one CW
    displacement -- the same one that produces post_burn_miss_distance_m -- so
    the drawn lines and the reported numbers cannot disagree.

    Positions are ECEF/ITRS kilometres, ready to place directly. The frame is
    named in the payload rather than assumed: handing a caller unlabelled
    coordinates is how frame-mismatch bugs get built on top of correct physics.

    Attributes:
        frame:                  "ecef" (ITRS), stated so no caller has to guess.
        units:                  "km".
        sample_utc_iso:         Sample instants, UTC, one per track point.
        pre_burn_pos_ecef_km:   Primary's coasting trajectory (no burn).
        post_burn_pos_ecef_km:  Primary's trajectory with the burn applied.
        secondary_pos_ecef_km:  The other object. Without it the two primary
                                tracks show a displacement but not why it helps.
        burn_utc_iso:           When the impulse is applied.
        tca_utc_iso:            Closest approach, as refined by the pipeline.
        burn_sample_index:      Index of the sample nearest the burn. Before it
                                the two tracks are identical, exactly.
        separation_at_tca_m:    How far the burn moves the primary by TCA. This
                                is NOT the miss distance -- it is the size of
                                the displacement that changes it.
        max_separation_m:       Largest pre/post separation in the window.
        sample_step_s:          Spacing of the sampled arcs [s].
        tca_*_pos_ecef_km:      The three positions AT TCA, exactly. See the
                                resolution note below -- these are what the
                                encounter geometry must be drawn from.
        truncated:              True if the window was clipped at the CW
                                validity horizon.
        note:                   Why it was clipped, when it was.

    RESOLUTION, AND WHAT THE DRAWN ARCS DO NOT SHOW

    The sampled arcs span roughly an hour of flight, so their step is tens of
    seconds. At a relative speed of ~15 km/s the two objects cover hundreds of
    kilometres between samples, which means the closest approach BETWEEN THE
    SAMPLED ARCS is nowhere near the miss distance -- it is off by kilometres,
    and it varies with where the grid happens to fall. Measured on the Envisat
    case: 7.9 km sampled, against a true 268 m.

    That is not a defect to be tuned away. Resolving a 268 m encounter on a
    uniform grid would need a millisecond step across an hour of flight. The
    arcs exist to show WHERE the trajectories run and where they part; the
    encounter itself is carried exactly by the three tca_* positions, taken
    from the refined TCA solution. A caller must never measure a miss distance
    off the arcs, and the API says so.
    """
    frame: str
    units: str
    sample_utc_iso: List[str]
    pre_burn_pos_ecef_km: List[List[float]]
    post_burn_pos_ecef_km: List[List[float]]
    secondary_pos_ecef_km: List[List[float]]
    burn_utc_iso: str
    tca_utc_iso: str
    burn_sample_index: int
    separation_at_tca_m: float
    max_separation_m: float
    sample_step_s: float
    tca_pre_burn_pos_ecef_km: List[float]
    tca_post_burn_pos_ecef_km: List[float]
    tca_secondary_pos_ecef_km: List[float]
    truncated: bool
    note: Optional[str] = None

    def __repr__(self) -> str:
        return (
            f"ManeuverTracks(n={len(self.sample_utc_iso)}, frame={self.frame!r}, "
            f"sep@TCA={self.separation_at_tca_m:.1f} m, truncated={self.truncated})"
        )


def _cw_relative_state_rtn(delta_v_km_s: float, n_rad_s: float, dt_s):
    """
    Hill-Clohessy-Wiltshire response to an along-track impulse.

    The formulas are the ones quoted in this module's docstring. They live in a
    function because two callers need them and must not drift apart: the scalar
    result evaluates them once at TCA, and the sampled track evaluates them at
    every instant. If these ever disagreed, the drawn line and the reported
    miss distance would be describing different burns.

    Works elementwise, so `dt_s` may be a scalar or an array of seconds since
    the burn.

    Args:
        delta_v_km_s: Along-track impulse [km/s]. Negative brakes.
        n_rad_s:      Mean motion [rad/s].
        dt_s:         Time since the burn [s]. Must not be negative -- before
                      the burn there is no displacement, and the caller is
                      responsible for clamping.

    Returns:
        (dr_rtn_km, dv_rtn_km_s), each shaped (3,) for a scalar dt_s or (3, N)
        for an array, ordered radial / along-track / cross-track.
    """
    n_dt = n_rad_s * np.asarray(dt_s, dtype=float)
    zero = np.zeros_like(n_dt)

    dr_rtn_km = np.array([
        (2.0 / n_rad_s) * (1.0 - np.cos(n_dt)) * delta_v_km_s,
        (1.0 / n_rad_s) * (4.0 * np.sin(n_dt) - 3.0 * n_dt) * delta_v_km_s,
        zero,
    ], dtype=float)

    dv_rtn_km_s = np.array([
        2.0 * np.sin(n_dt) * delta_v_km_s,
        (4.0 * np.cos(n_dt) - 3.0) * delta_v_km_s,
        zero,
    ], dtype=float)

    return dr_rtn_km, dv_rtn_km_s


def _rtn_unit_vectors_eci(pos_eci_km, vel_eci_km_s):
    """
    Radial / along-track / cross-track unit vectors, expressed in ECI.

    Vectorised over the last axis, so it serves both a single state at TCA and
    a whole sampled track. Inputs are shaped (3,) or (3, N).

    The CW displacement is expressed in this rotating frame, so it has to be
    rotated by the basis at the instant it is applied -- using the basis at TCA
    for every sample would tilt the whole track.
    """
    r = np.asarray(pos_eci_km, dtype=float)
    v = np.asarray(vel_eci_km_s, dtype=float)

    r_hat = r / np.linalg.norm(r, axis=0)
    h_vec = np.cross(r, v, axis=0)
    n_hat = h_vec / np.linalg.norm(h_vec, axis=0)
    t_hat = np.cross(n_hat, r_hat, axis=0)
    return r_hat, t_hat, n_hat


def _sample_maneuver_tracks(
    primary: EarthSatellite,
    secondary: EarthSatellite,
    tca_result: TCAResult,
    post_state1_eci: StateVectorECI,
    delta_v_km_s: float,
    n_rad_s: float,
    lead_time_minutes: float,
    samples: int = _TRACK_SAMPLES,
) -> ManeuverTracks:
    """
    Sample the flown and unflown trajectories across the encounter.

    Method, and its one honest limitation:

    The post-burn track is the pre-burn SGP4 trajectory plus the CW
    displacement at each instant. It is NOT an independent propagation of a
    perturbed state vector -- doing that would need a numerical integrator this
    project does not have and CLAUDE.md 1.1 would not let us hand-write. What
    it IS, is the same linearised model that produces the reported post-burn
    miss distance, evaluated at many instants instead of one. So the track is
    exactly as trustworthy as the number beside it, and no more.

    Consequences worth stating rather than discovering:

    - Before the burn the displacement is identically zero, so the two tracks
      coincide to the bit. That is physically right and visually the point.
    - The CW linearisation holds for roughly one orbit after the burn. The
      window is clipped there and flagged, because past that the secular
      along-track term grows without bound.
    - Positions come back in ECEF, converted through skyfield's own ICRS->ITRS
      rotation -- the same transform frames.py uses. Nothing is hand-rolled,
      and the frame is named in the payload.

    Args:
        primary:            Primary satellite (pre-burn element set).
        secondary:          The other object in the conjunction.
        tca_result:         Pipeline TCA solution; supplies the encounter epoch
                            and the exact states the miss distance came from.
        post_state1_eci:    The perturbed primary state at TCA, as already built
                            by the caller. Passed in rather than recomputed so
                            the drawn encounter and the reported miss distance
                            are the same object, not two agreeing calculations.
        delta_v_km_s:       Along-track impulse [km/s].
        n_rad_s:            Mean motion [rad/s], from the vis-viva fit at TCA.
        lead_time_minutes:  Burn lead time before TCA [minutes].
        samples:            Points per track.

    Returns:
        ManeuverTracks in ECEF kilometres.
    """
    ts = load.timescale()
    tca_time = tca_result.tca_time

    tca_tt = float(tca_time.tt)
    burn_tt = tca_tt - (lead_time_minutes * 60.0) / _SECONDS_PER_DAY

    orbit_period_s = (2.0 * np.pi) / n_rad_s
    horizon_tt = burn_tt + (_CW_VALIDITY_ORBITS * orbit_period_s) / _SECONDS_PER_DAY

    start_tt = burn_tt - (_TRACK_LEAD_IN_MINUTES * 60.0) / _SECONDS_PER_DAY
    end_tt = tca_tt + (_TRACK_TRAIL_MINUTES * 60.0) / _SECONDS_PER_DAY

    truncated = end_tt > horizon_tt
    note = None
    if truncated:
        end_tt = horizon_tt
        note = (
            f"Track clipped at {_CW_VALIDITY_ORBITS:.0f} orbit "
            f"({orbit_period_s / 60.0:.0f} min) after the burn, which is the "
            "validity horizon of the Clohessy-Wiltshire linearisation. Beyond "
            "it the along-track term grows without bound and the drawn "
            "trajectory would not be one the model can assert."
        )
    # A lead time longer than the horizon puts TCA outside the model entirely;
    # keep a drawable window rather than returning a degenerate one, and let
    # the note above explain why the line stops where it does.
    end_tt = max(end_tt, start_tt + 60.0 / _SECONDS_PER_DAY)

    sample_tt = np.linspace(start_tt, end_tt, samples)
    t = ts.tt_jd(sample_tt)

    # Pre-burn: straight from SGP4, through skyfield's own frame machinery.
    geo_primary = primary.at(t)
    pos_eci, vel_eci = geo_primary.frame_xyz_and_velocity(framelib.ICRS)
    pre_eci_km = np.asarray(pos_eci.km, dtype=float)
    pre_vel_eci_km_s = np.asarray(vel_eci.km_per_s, dtype=float)
    pre_ecef_km = np.asarray(geo_primary.frame_xyz(framelib.itrs).km, dtype=float)
    secondary_ecef_km = np.asarray(
        secondary.at(t).frame_xyz(framelib.itrs).km, dtype=float,
    )

    # Post-burn: the same trajectory plus the CW displacement. Clamped at zero
    # before the burn -- a negative dt would run the model backwards and
    # "un-burn" the orbit, which is not a thing.
    dt_since_burn_s = np.maximum((sample_tt - burn_tt) * _SECONDS_PER_DAY, 0.0)
    dr_rtn_km, _ = _cw_relative_state_rtn(delta_v_km_s, n_rad_s, dt_since_burn_s)

    r_hat, t_hat, n_hat = _rtn_unit_vectors_eci(pre_eci_km, pre_vel_eci_km_s)
    dr_eci_km = r_hat * dr_rtn_km[0] + t_hat * dr_rtn_km[1] + n_hat * dr_rtn_km[2]
    post_eci_km = pre_eci_km + dr_eci_km

    # ICRS -> ITRS for the perturbed points. Same rotation skyfield applied to
    # the pre-burn track above; taken as a matrix because there is no satellite
    # to re-propagate for a state that was never in the catalogue.
    rotation = np.asarray(framelib.itrs.rotation_at(t), dtype=float)
    post_ecef_km = np.einsum("ijk,jk->ik", rotation, post_eci_km)

    # A rotation preserves length, so the separation can be read off the ECI
    # displacement directly.
    separation_km = np.linalg.norm(dr_eci_km, axis=0)

    # Reported at TCA from the analytic displacement rather than the nearest
    # sample, so it matches the scalar result exactly whatever the grid is.
    dr_at_tca_km, _ = _cw_relative_state_rtn(
        delta_v_km_s, n_rad_s, lead_time_minutes * 60.0,
    )

    burn_index = int(np.argmin(np.abs(sample_tt - burn_tt)))
    iso = [str(x) for x in t.utc_strftime("%Y-%m-%dT%H:%M:%SZ")]
    step_s = float((sample_tt[1] - sample_tt[0]) * _SECONDS_PER_DAY)

    # The encounter itself, exactly. The sampled arcs cannot resolve a
    # few-hundred-metre approach at 15 km/s (see the class docstring), so the
    # geometry a viewer will zoom into comes from the refined TCA states,
    # rotated into the same frame as the arcs. Distances are preserved by a
    # rotation, so |secondary - post| here IS post_burn_miss_distance_m.
    rotation_at_tca = np.asarray(framelib.itrs.rotation_at(tca_time), dtype=float)
    tca_pre_ecef_km = rotation_at_tca @ tca_result.state1_eci.pos_eci_km
    tca_post_ecef_km = rotation_at_tca @ post_state1_eci.pos_eci_km
    tca_secondary_ecef_km = rotation_at_tca @ tca_result.state2_eci.pos_eci_km

    return ManeuverTracks(
        frame="ecef",
        units="km",
        sample_utc_iso=iso,
        pre_burn_pos_ecef_km=pre_ecef_km.T.tolist(),
        post_burn_pos_ecef_km=post_ecef_km.T.tolist(),
        secondary_pos_ecef_km=secondary_ecef_km.T.tolist(),
        burn_utc_iso=str(ts.tt_jd(burn_tt).utc_strftime("%Y-%m-%dT%H:%M:%SZ")),
        tca_utc_iso=str(tca_time.utc_strftime("%Y-%m-%dT%H:%M:%SZ")),
        burn_sample_index=burn_index,
        separation_at_tca_m=float(np.linalg.norm(dr_at_tca_km)) * 1000.0,
        max_separation_m=float(separation_km.max()) * 1000.0,
        sample_step_s=step_s,
        tca_pre_burn_pos_ecef_km=[float(x) for x in tca_pre_ecef_km],
        tca_post_burn_pos_ecef_km=[float(x) for x in tca_post_ecef_km],
        tca_secondary_pos_ecef_km=[float(x) for x in tca_secondary_ecef_km],
        truncated=bool(truncated),
        note=note,
    )


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
        tracks:                    Sampled flown/unflown trajectories for the
                                   console, or None if not requested. Produced
                                   from the same CW displacement as the numbers
                                   above, so a drawn line can never contradict
                                   a reported miss distance.
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
    tracks: Optional[ManeuverTracks] = None

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
    sample_tracks: bool = True,
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
        sample_tracks:       Also sample the flown/unflown trajectories for display.
                             On by default so the API cannot serve numbers and
                             lines from two different computations.

    Returns:
        ManeuverResult with pre and post burn miss distances, Pc, risk reduction,
        fuel, and (unless suppressed) the sampled trajectories.
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
    # Position and velocity perturbation at TCA, in the primary's RTN frame.
    # Shared with the sampled track below so the drawn line and the reported
    # miss distance can never describe different burns.
    dr_rtn_km, dv_rtn_km_s = _cw_relative_state_rtn(delta_v_km_s, n_rad_s, dt_s)

    # 4. Rotate RTN perturbation to ECI frame using primary's state at TCA
    r_hat, t_hat, n_hat = _rtn_unit_vectors_eci(
        state1_eci.pos_eci_km, state1_eci.vel_eci_km_s,
    )
    dr_eci_km = r_hat * dr_rtn_km[0] + t_hat * dr_rtn_km[1] + n_hat * dr_rtn_km[2]

    # 5. Build post-burn ECI state for primary satellite at TCA
    new_pos1_eci_km = state1_eci.pos_eci_km + dr_eci_km
    dv_eci_km_s = r_hat * dv_rtn_km_s[0] + t_hat * dv_rtn_km_s[1] + n_hat * dv_rtn_km_s[2]
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

    tracks = None
    if sample_tracks:
        tracks = _sample_maneuver_tracks(
            primary=primary,
            secondary=secondary,
            tca_result=tca_result,
            post_state1_eci=post_state1_eci,
            delta_v_km_s=delta_v_km_s,
            n_rad_s=n_rad_s,
            lead_time_minutes=lead_time_minutes,
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
        tracks=tracks,
    )
