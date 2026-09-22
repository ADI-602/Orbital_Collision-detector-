"""
main.py — FastAPI REST API server for Orbital Risk Advisor.

Exposes RESTful endpoints for satellite orbit propagation, conjunction screening,
Time of Closest Approach (TCA) refinement, collision avoidance burn simulation,
historical Envisat 2004 replay event data, and AI decision support recommendations.
"""

from datetime import datetime, timedelta, timezone
import logging
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from skyfield.api import load

from backend.ai.advisor import get_ai_advice
from backend.ai.schema import AIAdvisorRequest, AIAdvisorResponse, ConjunctionContext, ManeuverOption
from backend.physics.collision_probability import _tle_covariance_rtn, compute_pc, covariance_rtn_to_eci
from backend.physics.maneuver import simulate_maneuver
from backend.physics.propagation import propagate
from backend.physics.screening import _orbital_elements_from_tle, screen_candidates
from backend.physics.tca import compute_tca_from_tles
from backend.physics.tle_ingest import parse_tle_pair
from tests.fixtures.envisat_tles import ENVISAT_TLES, ZENITH2_TLES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("orbital_risk_api")

app = FastAPI(
    title="Orbital Risk Advisor API",
    description="Space Domain Awareness & Conjunction Risk Assessment API",
    version="1.0.0",
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request/Response Models for Physics Endpoints ---

class TLEInput(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "ENVISAT"})
    line1: str = Field(..., json_schema_extra={"example": "1 27386U 02009A   04293.45678901 ..."})
    line2: str = Field(..., json_schema_extra={"example": "2 27386  98.5432 ..."})


class TCAPhysicsRequest(BaseModel):
    primary: TLEInput
    secondary: TLEInput
    start_utc_iso: str = Field(..., json_schema_extra={"example": "2004-10-21T00:00:00Z"})
    search_duration_hours: float = Field(default=48.0, json_schema_extra={"example": 48.0})


class ScreeningPhysicsRequest(BaseModel):
    primary: TLEInput
    candidates: List[TLEInput]
    start_utc_iso: str = Field(..., json_schema_extra={"example": "2004-10-21T00:00:00Z"})
    search_duration_hours: float = Field(default=48.0, json_schema_extra={"example": 48.0})
    coarse_threshold_km: float = Field(default=50.0, json_schema_extra={"example": 50.0})


class ManeuverPhysicsRequest(BaseModel):
    primary: TLEInput
    secondary: TLEInput
    tca_utc_iso: str = Field(..., json_schema_extra={"example": "2004-10-22T08:12:34Z"})
    delta_v_cm_s: float = Field(default=-4.0, json_schema_extra={"example": -4.0})
    lead_time_minutes: float = Field(default=50.0, json_schema_extra={"example": 50.0})
    sat_mass_kg: float = Field(default=8200.0, json_schema_extra={"example": 8200.0})


# --- API Routes ---

@app.get("/health", tags=["Health"])
def health_check() -> Dict[str, str]:
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "Orbital Risk Advisor API",
        "version": "1.0.0",
    }


@app.get("/api/conjunctions/envisat", tags=["Replay Scenarios"])
def get_envisat_replay_data() -> Dict[str, Any]:
    """
    Get ground-truth dataset for the historical October 2004 Envisat vs Zenith-2 debris conjunction.
    Includes prediction days Oct 19, Oct 20, Oct 21, and Oct 22 with TLEs, miss distances, and pre-burn Pc.
    """
    days_map = {
        "oct_19": "2004-10-19",
        "oct_20": "2004-10-20",
        "oct_21": "2004-10-21",
        "oct_22": "2004-10-22",
    }
    days_data = []

    for day_key, date_str in days_map.items():
        env_l1, env_l2 = ENVISAT_TLES[day_key]
        zen_l1, zen_l2 = ZENITH2_TLES[day_key]

        days_data.append({
            "day": day_key,
            "prediction_date": date_str,
            "tca_target_iso": "2004-10-22T05:10:35Z",
            "envisat_tle": {
                "name": "ENVISAT",
                "line1": env_l1,
                "line2": env_l2,
            },
            "secondary_tle": {
                "name": "ZENITH-2 DEBRIS",
                "line1": zen_l1,
                "line2": zen_l2,
            },
        })

    return {
        "event_name": "Envisat vs Zenith-2 Debris (October 2004)",
        "primary_satellite": "ENVISAT",
        "secondary_object": "ZENITH-2 DEBRIS",
        "primary_norad_id": 27386,
        "secondary_norad_id": 22437,
        "tca_utc": "2004-10-22T05:10:35Z",
        "prediction_days": days_data,
    }


@app.post("/api/physics/tca", tags=["Physics Pipeline"])
def compute_tca_endpoint(req: TCAPhysicsRequest) -> Dict[str, Any]:
    """
    Compute precise Time of Closest Approach (TCA) and miss distance between primary and secondary objects.
    """
    try:
        ts = load.timescale()
        sat1 = parse_tle_pair(req.primary.line1, req.primary.line2, req.primary.name)
        sat2 = parse_tle_pair(req.secondary.line1, req.secondary.line2, req.secondary.name)

        dt_start = datetime.fromisoformat(req.start_utc_iso.replace("Z", "+00:00"))
        start_time = ts.from_datetime(dt_start)
        end_time = ts.from_datetime(dt_start + timedelta(hours=req.search_duration_hours))

        tca_res = compute_tca_from_tles(sat1, sat2, start_time, end_time, threshold_km=500.0)

        if not tca_res:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No close approach found within search duration window.",
            )

        return {
            "tca_utc_iso": tca_res.tca_time.utc_strftime("%Y-%m-%dT%H:%M:%SZ"),
            "miss_distance_m": tca_res.miss_distance_km * 1000.0,
            "miss_distance_km": tca_res.miss_distance_km,
            "relative_speed_km_s": tca_res.rel_velocity_km_s,
            "primary_pos_eci_km": tca_res.state1_eci.pos_eci_km.tolist(),
            "secondary_pos_eci_km": tca_res.state2_eci.pos_eci_km.tolist(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("compute_tca_endpoint failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"TCA calculation failed: {str(e)}",
        )


@app.post("/api/physics/screening", tags=["Physics Pipeline"])
def screening_endpoint(req: ScreeningPhysicsRequest) -> Dict[str, Any]:
    """
    Screen candidate objects against a primary satellite for conjunction threats.
    """
    try:
        primary_sat = parse_tle_pair(req.primary.line1, req.primary.line2, req.primary.name)
        candidate_sats = [
            parse_tle_pair(c.line1, c.line2, c.name) for c in req.candidates
        ]

        ts = load.timescale()
        dt_start = datetime.fromisoformat(req.start_utc_iso.replace("Z", "+00:00"))
        start_time = ts.from_datetime(dt_start)
        end_time = ts.from_datetime(dt_start + timedelta(hours=req.search_duration_hours))

        flagged_candidates = screen_candidates(
            primary=primary_sat,
            candidates=candidate_sats,
            start_time=start_time,
            end_time=end_time,
            threshold_km=req.coarse_threshold_km,
            skip_coarse_filter=True,
        )

        events_out = []
        # Pairs the pipeline legitimately cannot assess. Reported rather than
        # dropped: "we did not assess this pair" and "this pair is safe" are
        # very different statements, and a screening result that silently
        # omits the difference is misleading.
        unassessable = []

        for c in flagged_candidates:
            # One candidate must never take down the batch. Screening a live
            # catalog reliably turns up pairs that cannot be assessed — two
            # objects sharing an element set, for instance, have zero relative
            # velocity at TCA, for which no encounter plane exists. Before this
            # guard a single such pair returned HTTP 500 and discarded the
            # results for every other candidate in the request.
            try:
                w_start = ts.tt_jd(float(c.min_separation_time.tt) - (7200.0 / 86400.0))
                w_end = ts.tt_jd(float(c.min_separation_time.tt) + (7200.0 / 86400.0))
                tca_res = compute_tca_from_tles(c.primary, c.secondary, w_start, w_end, threshold_km=500.0)

                if not tca_res:
                    continue

                elem1 = _orbital_elements_from_tle(c.primary)
                elem2 = _orbital_elements_from_tle(c.secondary)

                cov1_rtn = _tle_covariance_rtn(elem1["inclination_deg"], elem1["perigee_alt_km"], elem1["eccentricity"])
                cov2_rtn = _tle_covariance_rtn(elem2["inclination_deg"], elem2["perigee_alt_km"], elem2["eccentricity"])

                cov1_eci = covariance_rtn_to_eci(cov1_rtn, tca_res.state1_eci.pos_eci_km, tca_res.state1_eci.vel_eci_km_s)
                cov2_eci = covariance_rtn_to_eci(cov2_rtn, tca_res.state2_eci.pos_eci_km, tca_res.state2_eci.vel_eci_km_s)

                pc = compute_pc(
                    tca_res.state1_eci,
                    tca_res.state2_eci,
                    cov1_eci,
                    cov2_eci,
                    hard_body_radius_km=0.0145,
                )

                events_out.append({
                    "secondary_name": c.secondary.name,
                    "tca_utc_iso": tca_res.tca_time.utc_strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "miss_distance_m": tca_res.miss_distance_km * 1000.0,
                    "pc": pc,
                    "relative_speed_km_s": tca_res.rel_velocity_km_s,
                    "threat_level": "RED" if pc >= 1e-4 else ("YELLOW" if pc >= 1e-5 else "GREEN"),
                })
            except Exception as pair_error:
                # The physics raising here is correct behaviour, not a bug to
                # paper over: compute_pc refuses rather than inventing a Pc it
                # cannot define. The endpoint's job is to carry that refusal
                # through as data instead of as a 500.
                logger.warning(
                    "screening_endpoint: could not assess %s vs %s: %s",
                    primary_sat.name, c.secondary.name, pair_error,
                )
                unassessable.append({
                    "secondary_name": c.secondary.name,
                    "reason": str(pair_error),
                })

        return {
            "primary_name": primary_sat.name,
            "candidates_screened": len(candidate_sats),
            "events": events_out,
            "unassessable": unassessable,
        }
    except Exception as e:
        logger.error("screening_endpoint failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Screening failed: {str(e)}",
        )


@app.post("/api/physics/maneuver", tags=["Physics Pipeline"])
def maneuver_endpoint(req: ManeuverPhysicsRequest) -> Dict[str, Any]:
    """
    Simulate impulsive collision-avoidance maneuver (ΔV) and evaluate pre/post burn miss distance and Pc.
    """
    try:
        ts = load.timescale()
        sat1 = parse_tle_pair(req.primary.line1, req.primary.line2, req.primary.name)
        sat2 = parse_tle_pair(req.secondary.line1, req.secondary.line2, req.secondary.name)

        dt_tca = datetime.fromisoformat(req.tca_utc_iso.replace("Z", "+00:00"))
        start_time = ts.from_datetime(dt_tca - timedelta(hours=2.0))
        end_time = ts.from_datetime(dt_tca + timedelta(hours=2.0))

        tca_res = compute_tca_from_tles(sat1, sat2, start_time, end_time, threshold_km=500.0)

        if not tca_res:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Could not compute TCA for maneuver simulation.",
            )

        man_res = simulate_maneuver(
            primary=sat1,
            secondary=sat2,
            tca_result=tca_res,
            delta_v_cm_s=req.delta_v_cm_s,
            lead_time_minutes=req.lead_time_minutes,
            sat_mass_kg=req.sat_mass_kg,
        )

        return {
            "primary_name": man_res.primary_name,
            "secondary_name": man_res.secondary_name,
            "delta_v_cm_s": man_res.delta_v_cm_s,
            "lead_time_minutes": man_res.lead_time_minutes,
            "pre_burn_miss_distance_m": man_res.pre_burn_miss_distance_m,
            # Separation at the pre-burn TCA, kept for continuity. The number
            # that says what the burn achieved is post_burn_min_distance_m.
            "post_burn_miss_distance_m": man_res.post_burn_miss_distance_m,
            "post_burn_min_distance_m": man_res.post_burn_min_distance_m,
            "post_burn_tca_offset_s": man_res.post_burn_tca_offset_s,
            "pre_burn_pc": man_res.pre_burn_pc,
            "post_burn_pc": man_res.post_burn_pc,
            "risk_reduction_pct": man_res.risk_reduction_pct,
            "fuel_consumed_kg": man_res.fuel_consumed_kg,
            # Two distinct facts: does the burn help, and does it finish the
            # job. Collapsing them would either call the burn ESA actually
            # flew "not recommended" or call a token nudge sufficient.
            "maneuver_recommended": man_res.maneuver_recommended,
            "post_burn_below_threshold": man_res.post_burn_below_threshold,
            "risk_threshold_pc": man_res.risk_threshold_pc,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("maneuver_endpoint failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Maneuver simulation failed: {str(e)}",
        )


@app.post("/api/ai/advise", tags=["AI Decision Support"], response_model=AIAdvisorResponse)
def ai_advise_endpoint(req: AIAdvisorRequest) -> AIAdvisorResponse:
    """
    Generate AI decision support analysis for a conjunction event.
    Automatically degrades to pure-Python rule-based advisor if GEMINI_API_KEY
    (or GOOGLE_API_KEY) is missing or the API call fails. This description is
    served publicly at /docs, so the key name here must match advisor.py.
    """
    return get_ai_advice(req)
