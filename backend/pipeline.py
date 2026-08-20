"""
pipeline.py — Master End-to-End Orbital Risk Advisor Pipeline Runner.

Ties all 7 stages together into a single, unified pipeline function call:
  Stage 1: TLE Ingest & Parsing (tle_ingest.py)
  Stage 2: Coarse Conjunction Screening (screening.py)
  Stage 3: Fine Vectorized Propagation Scan (screening.py)
  Stage 4: Precise TCA Refinement & Frame Transforms (tca.py & frames.py)
  Stage 5: 2D Encounter-Plane Collision Probability (collision_probability.py)
  Stage 6: Impulsive Along-Track Maneuver Simulation (maneuver.py)
  Stage 7: AI Flight Dynamics Officer Decision Support (advisor.py)
"""

from datetime import datetime, timedelta
import logging
from typing import Any, Dict, List, Optional

from skyfield.api import EarthSatellite, load

from backend.ai.advisor import get_ai_advice
from backend.ai.schema import AIAdvisorRequest, ConjunctionContext, ManeuverOption
from backend.physics.collision_probability import _tle_covariance_rtn, compute_pc, covariance_rtn_to_eci
from backend.physics.maneuver import simulate_maneuver
from backend.physics.screening import _orbital_elements_from_tle
from backend.physics.tca import compute_tca_from_tles
from backend.physics.tle_ingest import fetch_envisat, parse_tle_pair
from tests.fixtures.envisat_tles import ENVISAT_TLES, ZENITH2_TLES

logger = logging.getLogger("orbital_pipeline")


def run_orbital_risk_pipeline(
    primary_sat: Optional[EarthSatellite] = None,
    candidate_sats: Optional[List[EarthSatellite]] = None,
    start_utc_iso: str = "2004-10-22T05:00:00Z",
    search_duration_hours: float = 0.5,
    delta_v_cm_s: float = -4.0,
    lead_time_minutes: float = 50.0,
    sat_mass_kg: float = 8200.0,
    hard_body_radius_km: float = 0.0145,
) -> Dict[str, Any]:
    """
    Execute the complete end-to-end orbital conjunction assessment & maneuver pipeline.

    Args:
        primary_sat: Primary satellite object (defaults to Envisat Oct 22, 2004).
        candidate_sats: List of candidate objects (defaults to Zenith-2 debris).
        start_utc_iso: ISO 8601 start time for analysis window.
        search_duration_hours: Window search duration [hours].
        delta_v_cm_s: Simulated along-track burn [cm/s].
        lead_time_minutes: Burn lead time before TCA [minutes].
        sat_mass_kg: Primary satellite mass [kg].
        hard_body_radius_km: Combined hard-body radius [km].

    Returns:
        Complete master dictionary with all stage outputs, telemetry, maneuver physics, and AI advice.
    """
    ts = load.timescale()

    # Default to ground-truth Envisat 2004 scenario if none provided
    if primary_sat is None or candidate_sats is None:
        env_l1, env_l2 = ENVISAT_TLES["oct_22"]
        zen_l1, zen_l2 = ZENITH2_TLES["oct_22"]
        primary_sat = parse_tle_pair(env_l1, env_l2, "ENVISAT")
        candidate_sats = [parse_tle_pair(zen_l1, zen_l2, "ZENITH-2 DEBRIS")]

    logger.info("Pipeline Stage 1-3: Screening %d candidates for %s", len(candidate_sats), primary_sat.name)

    dt_start = datetime.fromisoformat(start_utc_iso.replace("Z", "+00:00"))
    start_time = ts.from_datetime(dt_start)
    end_time = ts.from_datetime(dt_start + timedelta(hours=search_duration_hours))

    conjunction_results = []

    for cand in candidate_sats:
        logger.info("Pipeline Stage 4: Refining TCA for %s vs %s", primary_sat.name, cand.name)

        tca_res = compute_tca_from_tles(primary_sat, cand, start_time, end_time, threshold_km=500.0)

        if not tca_res:
            continue

        logger.info("Pipeline Stage 5: Computing 2D Encounter-Plane Pc")
        elem1 = _orbital_elements_from_tle(primary_sat)
        elem2 = _orbital_elements_from_tle(cand)

        cov1_rtn = _tle_covariance_rtn(elem1["inclination_deg"], elem1["perigee_alt_km"], elem1["eccentricity"])
        cov2_rtn = _tle_covariance_rtn(elem2["inclination_deg"], elem2["perigee_alt_km"], elem2["eccentricity"])

        cov1_eci = covariance_rtn_to_eci(cov1_rtn, tca_res.state1_eci.pos_eci_km, tca_res.state1_eci.vel_eci_km_s)
        cov2_eci = covariance_rtn_to_eci(cov2_rtn, tca_res.state2_eci.pos_eci_km, tca_res.state2_eci.vel_eci_km_s)

        pre_burn_pc = compute_pc(
            tca_res.state1_eci,
            tca_res.state2_eci,
            cov1_eci,
            cov2_eci,
            hard_body_radius_km=hard_body_radius_km,
        )

        logger.info("Pipeline Stage 6: Simulating Impulsive Maneuver (ΔV = %.1f cm/s)", delta_v_cm_s)
        man_res = simulate_maneuver(
            primary=primary_sat,
            secondary=cand,
            tca_result=tca_res,
            delta_v_cm_s=delta_v_cm_s,
            lead_time_minutes=lead_time_minutes,
            sat_mass_kg=sat_mass_kg,
            hard_body_radius_km=hard_body_radius_km,
        )

        logger.info("Pipeline Stage 7: Requesting AI Decision Support Advice")
        tca_iso_str = tca_res.tca_time.utc_strftime("%Y-%m-%dT%H:%M:%SZ")

        ai_req = AIAdvisorRequest(
            conjunction=ConjunctionContext(
                primary_name=primary_sat.name,
                secondary_name=cand.name,
                tca_iso=tca_iso_str,
                miss_distance_m=tca_res.miss_distance_km * 1000.0,
                pre_burn_pc=pre_burn_pc,
                relative_speed_km_s=tca_res.rel_velocity_km_s,
                primary_alt_km=float(elem1["perigee_alt_km"]),
                hard_body_radius_m=hard_body_radius_km * 1000.0,
            ),
            maneuvers=[
                ManeuverOption(
                    delta_v_cm_s=man_res.delta_v_cm_s,
                    lead_time_minutes=man_res.lead_time_minutes,
                    post_burn_miss_distance_m=man_res.post_burn_miss_distance_m,
                    post_burn_pc=man_res.post_burn_pc,
                    risk_reduction_pct=man_res.risk_reduction_pct,
                    fuel_consumed_kg=man_res.fuel_consumed_kg,
                    recommended=man_res.maneuver_recommended,
                )
            ],
            query_type="recommendation",
        )

        ai_res = get_ai_advice(ai_req)

        conjunction_results.append({
            "secondary_name": cand.name,
            "tca_utc_iso": tca_iso_str,
            "pre_burn": {
                "miss_distance_m": tca_res.miss_distance_km * 1000.0,
                "pc": pre_burn_pc,
                "relative_speed_km_s": tca_res.rel_velocity_km_s,
                "threat_level": "RED" if pre_burn_pc >= 1e-4 else ("YELLOW" if pre_burn_pc >= 1e-5 else "GREEN"),
                "primary_eci_pos_km": tca_res.state1_eci.pos_eci_km.tolist(),
                "secondary_eci_pos_km": tca_res.state2_eci.pos_eci_km.tolist(),
            },
            "post_burn_maneuver": {
                "delta_v_cm_s": man_res.delta_v_cm_s,
                "lead_time_minutes": man_res.lead_time_minutes,
                "miss_distance_m": man_res.post_burn_miss_distance_m,
                "pc": man_res.post_burn_pc,
                "risk_reduction_pct": man_res.risk_reduction_pct,
                "fuel_consumed_kg": man_res.fuel_consumed_kg,
                "recommended": man_res.maneuver_recommended,
            },
            "ai_advice": ai_res.model_dump(),
        })

    return {
        "status": "success",
        "primary_satellite": primary_sat.name,
        "candidates_screened": len(candidate_sats),
        "conjunctions_found": len(conjunction_results),
        "events": conjunction_results,
    }
